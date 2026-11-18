import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dispatchToN8n } from './dispatch';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('n8n dispatch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns dispatched: false when integration is not configured', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await dispatchToN8n(mockSupabase, 'acct-1', 'message.received', { text: 'hello' });
    expect(res.dispatched).toBe(false);
  });

  it('returns dispatched: false when event is not enabled', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://example.com/webhook',
                events: ['contact.created'],
                status: 'connected',
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await dispatchToN8n(mockSupabase, 'acct-1', 'message.received', { text: 'hello' });
    expect(res.dispatched).toBe(false);
  });

  it('dispatches HTTP POST when event is enabled and integration is connected', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', mockFetch);

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://example.com/webhook',
                events: ['message.received', 'contact.created'],
                status: 'connected',
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await dispatchToN8n(mockSupabase, 'acct-1', 'message.received', {
      text: 'hello from customer',
    });

    expect(res.dispatched).toBe(true);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-WACRM-Event': 'message.received',
          'X-WACRM-Account-ID': 'acct-1',
        }),
      })
    );
  });

  it('dispatches to event-specific workflow mapping URL when configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', mockFetch);

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://example.com/default-webhook',
                workflow_mappings: {
                  'message.received': 'https://example.com/custom-message-workflow',
                },
                events: ['message.received'],
                status: 'connected',
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const res = await dispatchToN8n(mockSupabase, 'acct-1', 'message.received', {
      text: 'hello custom',
    });

    expect(res.dispatched).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/custom-message-workflow',
      expect.anything()
    );
  });
});
