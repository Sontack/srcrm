import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const h = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
    supabase: {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: h.stored, error: null }),
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            h.updates.push(patch);
            return { error: null };
          },
        }),
        insert: (row: Record<string, unknown>) => {
          h.inserts.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: 'doc-1' }, error: null }),
            }),
            error: null,
          };
        },
      }),
    },
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 403,
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => `plain:${value}`,
  encrypt: (value: string) => `enc:${value}`,
}));

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: async () => {},
}));

vi.mock('@/lib/ai/knowledge', () => ({
  ingestDocument: async () => ({ keywordOnly: true, embedError: null }),
}));

describe('POST /api/ai/smart-setup', () => {
  beforeEach(() => {
    h.stored = null;
    h.updates = [];
    h.inserts = [];
    vi.restoreAllMocks();
  });

  it('rejects when no API key is provided and none stored', async () => {
    const req = new Request('http://localhost/api/ai/smart-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('configures and activates AI agent with business knowledge', async () => {
    const req = new Request('http://localhost/api/ai/smart-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'sk-proj-test-1234567890',
        provider: 'openai',
        model: 'gpt-4o-mini',
        businessInfo: {
          businessName: 'Glow Spa',
          servicesAndPricing: 'Massage: $60',
        },
        autoReplyEnabled: true,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.is_active).toBe(true);
    expect(data.auto_reply_enabled).toBe(true);
  });
});
