import { describe, expect, it, vi, beforeEach } from 'vitest';
import { N8nClient, getN8nClientForAccount } from './client';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('N8nClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes base url by removing trailing slash', () => {
    const client = new N8nClient({
      instanceUrl: 'http://localhost:5678/',
      apiKey: 'test-key',
    });
    // @ts-expect-error accessing private property for test
    expect(client.baseUrl).toBe('http://localhost:5678');
  });

  it('testConnection returns ok: true when status is 200', async () => {
    const mockHeaders = new Headers();
    mockHeaders.set('x-n8n-version', '1.65.1');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: mockHeaders,
      json: async () => ({ data: [] }),
    }));

    const client = new N8nClient({
      instanceUrl: 'http://localhost:5678',
      apiKey: 'my-api-key',
    });

    const res = await client.testConnection();
    expect(res.ok).toBe(true);
    expect(res.version).toBe('1.65.1');
  });

  it('testConnection reports authentication error when 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ message: 'Unauthorized' }),
    }));

    const client = new N8nClient({
      instanceUrl: 'http://localhost:5678',
      apiKey: 'bad-key',
    });

    const res = await client.testConnection();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error).toContain('Authentication failed');
  });

  it('getWorkflows queries /api/v1/workflows and returns array', async () => {
    const mockWorkflows = [
      { id: '1', name: 'Workflow A', active: true, createdAt: '2026-01-01', updatedAt: '2026-01-02' },
      { id: '2', name: 'Workflow B', active: false, createdAt: '2026-01-01', updatedAt: '2026-01-02' },
    ];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ data: mockWorkflows }),
    }));

    const client = new N8nClient({ instanceUrl: 'http://localhost:5678' });
    const res = await client.getWorkflows({ active: true, limit: 10 });

    expect(res.workflows).toHaveLength(2);
    expect(res.workflows[0].name).toBe('Workflow A');
  });

  it('createWorkflow posts workflow json to /api/v1/workflows', async () => {
    const mockCreated = { id: 'wf-100', name: 'New AI Bot', active: false, createdAt: 'now', updatedAt: 'now' };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => mockCreated,
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new N8nClient({ instanceUrl: 'http://localhost:5678', apiKey: 'secret' });
    const res = await client.createWorkflow({
      name: 'New AI Bot',
      nodes: [],
      connections: {},
    });

    expect(res.workflow?.id).toBe('wf-100');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5678/api/v1/workflows',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-N8N-API-KEY': 'secret',
        }),
      })
    );
  });

  it('activateWorkflow and deactivateWorkflow call proper endpoints', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: 'wf-1', active: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new N8nClient({ instanceUrl: 'http://localhost:5678' });
    await client.activateWorkflow('wf-1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5678/api/v1/workflows/wf-1/activate',
      expect.objectContaining({ method: 'POST' })
    );

    await client.deactivateWorkflow('wf-1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5678/api/v1/workflows/wf-1/deactivate',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('retryExecution posts to /api/v1/executions/:id/retry', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: 'exec-retry-1', status: 'running' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new N8nClient({ instanceUrl: 'http://localhost:5678' });
    const res = await client.retryExecution('exec-1');
    expect(res.execution?.id).toBe('exec-retry-1');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:5678/api/v1/executions/exec-1/retry',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('getN8nClientForAccount', () => {
  it('returns null client when account has no instance_url', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { account_id: 'acc-1', instance_url: null },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const { client, config } = await getN8nClientForAccount(mockSupabase, 'acc-1');
    expect(client).toBeNull();
    expect(config.instanceUrl).toBe('');
  });

  it('returns initialized client when instance_url exists', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                account_id: 'acc-1',
                instance_url: 'http://localhost:5678',
                status: 'connected',
                workflow_mappings: { 'message.received': 'http://localhost:5678/webhook/msg' },
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const { client, config } = await getN8nClientForAccount(mockSupabase, 'acc-1');
    expect(client).not.toBeNull();
    expect(config.instanceUrl).toBe('http://localhost:5678');
    expect(config.workflowMappings['message.received']).toBe('http://localhost:5678/webhook/msg');
  });
});
