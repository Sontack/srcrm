import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncBusinessKnowledgeToDatabase } from './business-knowledge';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./knowledge', () => ({
  ingestDocument: vi.fn().mockResolvedValue({ keywordOnly: true, embedError: null }),
}));

describe('syncBusinessKnowledgeToDatabase', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts structured knowledge documents for business profile and pricing', async () => {
    const insertedRows: Array<Record<string, unknown>> = [];
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
        insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
          insertedRows.push(row);
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: `doc-${insertedRows.length}` }, error: null }),
            }),
          };
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await syncBusinessKnowledgeToDatabase(
      mockSupabase,
      'acc-1',
      'user-1',
      {
        businessName: 'FitZone Gym',
        servicesAndPricing: 'Monthly: $50\nAnnual: $500',
        policies: 'No cancellation fee within 7 days',
        faqs: 'Q: Open on weekends? A: Yes 8am-8pm',
      }
    );

    expect(res.documentsCreated).toBe(4);
    expect(insertedRows.some((r) => String(r.title).includes('[Services & Pricing]'))).toBe(true);
    expect(insertedRows.some((r) => String(r.title).includes('[Policies & Terms]'))).toBe(true);
    expect(insertedRows.some((r) => String(r.title).includes('[Frequently Asked Questions]'))).toBe(true);
  });
});
