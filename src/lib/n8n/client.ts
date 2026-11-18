import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  nodes?: N8nNode[];
  connections?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: unknown;
  tags?: Array<{ id: string; name: string }>;
}

export interface N8nExecution {
  id: string;
  finished: boolean;
  mode: string;
  retryOf?: string;
  retrySuccessId?: string;
  status: 'success' | 'error' | 'running' | 'waiting' | 'new' | 'crashed' | 'unknown';
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  workflowName?: string;
  data?: unknown;
}

export interface N8nCredentialSummary {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface N8nVariable {
  id: string;
  key: string;
  value: string;
}

export interface N8nClientOptions {
  instanceUrl: string;
  apiKey?: string;
  authHeaderName?: string;
  authHeaderValue?: string;
  timeoutMs?: number;
}

export class N8nClient {
  private baseUrl: string;
  private apiKey?: string;
  private authHeaderName?: string;
  private authHeaderValue?: string;
  private timeoutMs: number;

  constructor(options: N8nClientOptions) {
    // Normalize base URL, removing trailing slashes
    let url = options.instanceUrl.trim();
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    this.apiKey = options.apiKey?.trim();
    this.authHeaderName = options.authHeaderName?.trim();
    this.authHeaderValue = options.authHeaderValue?.trim();
    this.timeoutMs = options.timeoutMs || 15000;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'WACRM-n8n-Client/1.0',
    };

    if (this.apiKey) {
      // Standard n8n API key header is X-N8N-API-KEY
      headers['X-N8N-API-KEY'] = this.apiKey;
    }

    if (this.authHeaderName && this.authHeaderValue) {
      headers[this.authHeaderName] = this.authHeaderValue;
    }

    return headers;
  }

  private async request<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ data?: T; status: number; headers: Headers; error?: string }> {
    const fullUrl = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(fullUrl, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...(options.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      });

      let parsedData: unknown = null;
      try {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json') || (!contentType && typeof res.json === 'function')) {
          parsedData = await res.json();
        } else if (typeof res.text === 'function') {
          const text = await res.text();
          try {
            parsedData = JSON.parse(text);
          } catch {
            parsedData = { text };
          }
        }
      } catch {
        parsedData = null;
      }

      if (!res.ok) {
        const errMsg =
          (parsedData as { message?: string })?.message ||
          (parsedData as { error?: string })?.error ||
          res.statusText ||
          `HTTP ${res.status}`;
        return {
          status: res.status,
          headers: res.headers,
          error: errMsg,
          data: parsedData as T,
        };
      }

      return {
        data: parsedData as T,
        status: res.status,
        headers: res.headers,
      };
    } catch (err: unknown) {
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const msg = isAbort ? `Request timed out after ${this.timeoutMs}ms` : (err instanceof Error ? err.message : String(err));
      return {
        status: 0,
        headers: new Headers(),
        error: msg,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Test connection to n8n instance and retrieve version/metadata
   */
  async testConnection(): Promise<{
    ok: boolean;
    status: number;
    version?: string;
    features?: Record<string, unknown>;
    error?: string;
  }> {
    // Try /api/v1/workflows?limit=1 first (requires auth)
    const apiRes = await this.request<{ data: unknown[] }>('/api/v1/workflows?limit=1', { method: 'GET' });
    const version = apiRes.headers.get('x-n8n-version') || undefined;

    if (apiRes.status >= 200 && apiRes.status < 300) {
      return {
        ok: true,
        status: apiRes.status,
        version: version || 'Connected',
      };
    }

    // If 401/403, credentials are wrong
    if (apiRes.status === 401 || apiRes.status === 403) {
      return {
        ok: false,
        status: apiRes.status,
        version,
        error: 'Authentication failed. Please verify your n8n API Key.',
      };
    }

    // Try healthz endpoint
    const healthRes = await this.request<{ status?: string }>('/healthz', { method: 'GET' });
    if (healthRes.status === 200) {
      return {
        ok: false,
        status: apiRes.status,
        version,
        error: `n8n server reached at /healthz, but API request failed (${apiRes.error || apiRes.status}). Verify API Key.`,
      };
    }

    return {
      ok: false,
      status: apiRes.status || healthRes.status,
      version,
      error: apiRes.error || healthRes.error || 'Could not reach n8n instance. Check your instance URL.',
    };
  }

  /**
   * List workflows
   */
  async getWorkflows(params?: { active?: boolean; tags?: string; limit?: number; cursor?: string }): Promise<{
    workflows: N8nWorkflow[];
    nextCursor?: string;
    error?: string;
  }> {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.active !== undefined) q.set('active', String(params.active));
    if (params?.tags) q.set('tags', params.tags);
    if (params?.cursor) q.set('cursor', params.cursor);

    const queryStr = q.toString() ? `?${q.toString()}` : '';
    const res = await this.request<{ data: N8nWorkflow[]; nextCursor?: string }>(`/api/v1/workflows${queryStr}`);

    if (res.error) {
      return { workflows: [], error: res.error };
    }

    const workflows = Array.isArray(res.data?.data) ? res.data.data : [];
    return { workflows, nextCursor: res.data?.nextCursor };
  }

  /**
   * Get single workflow details
   */
  async getWorkflow(id: string): Promise<{ workflow?: N8nWorkflow; error?: string }> {
    const res = await this.request<N8nWorkflow>(`/api/v1/workflows/${encodeURIComponent(id)}`);
    if (res.error) {
      return { error: res.error };
    }
    return { workflow: res.data };
  }

  /**
   * Create workflow
   */
  async createWorkflow(payload: {
    name: string;
    nodes: unknown[];
    connections: Record<string, unknown>;
    settings?: Record<string, unknown>;
    staticData?: unknown;
    tags?: string[];
  }): Promise<{ workflow?: N8nWorkflow; error?: string }> {
    const res = await this.request<N8nWorkflow>('/api/v1/workflows', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.error) {
      return { error: res.error };
    }
    return { workflow: res.data };
  }

  /**
   * Update workflow
   */
  async updateWorkflow(id: string, payload: Partial<N8nWorkflow>): Promise<{ workflow?: N8nWorkflow; error?: string }> {
    const res = await this.request<N8nWorkflow>(`/api/v1/workflows/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (res.error) {
      return { error: res.error };
    }
    return { workflow: res.data };
  }

  /**
   * Delete workflow
   */
  async deleteWorkflow(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await this.request(`/api/v1/workflows/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.error) {
      return { success: false, error: res.error };
    }
    return { success: true };
  }

  /**
   * Activate workflow
   */
  async activateWorkflow(id: string): Promise<{ workflow?: N8nWorkflow; error?: string }> {
    const res = await this.request<N8nWorkflow>(`/api/v1/workflows/${encodeURIComponent(id)}/activate`, {
      method: 'POST',
    });
    if (res.error) {
      return { error: res.error };
    }
    return { workflow: res.data };
  }

  /**
   * Deactivate workflow
   */
  async deactivateWorkflow(id: string): Promise<{ workflow?: N8nWorkflow; error?: string }> {
    const res = await this.request<N8nWorkflow>(`/api/v1/workflows/${encodeURIComponent(id)}/deactivate`, {
      method: 'POST',
    });
    if (res.error) {
      return { error: res.error };
    }
    return { workflow: res.data };
  }

  /**
   * List executions
   */
  async getExecutions(params?: {
    limit?: number;
    status?: string;
    workflowId?: string;
    cursor?: string;
  }): Promise<{
    executions: N8nExecution[];
    nextCursor?: string;
    error?: string;
  }> {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.status) q.set('status', params.status);
    if (params?.workflowId) q.set('workflowId', params.workflowId);
    if (params?.cursor) q.set('cursor', params.cursor);

    const queryStr = q.toString() ? `?${q.toString()}` : '';
    const res = await this.request<{ data: N8nExecution[]; nextCursor?: string }>(`/api/v1/executions${queryStr}`);

    if (res.error) {
      return { executions: [], error: res.error };
    }

    const executions = Array.isArray(res.data?.data) ? res.data.data : [];
    return { executions, nextCursor: res.data?.nextCursor };
  }

  /**
   * Get single execution details
   */
  async getExecution(id: string): Promise<{ execution?: N8nExecution; error?: string }> {
    const res = await this.request<N8nExecution>(`/api/v1/executions/${encodeURIComponent(id)}`);
    if (res.error) {
      return { error: res.error };
    }
    return { execution: res.data };
  }

  /**
   * Retry failed execution
   */
  async retryExecution(id: string): Promise<{ execution?: N8nExecution; error?: string }> {
    const res = await this.request<N8nExecution>(`/api/v1/executions/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    });
    if (res.error) {
      return { error: res.error };
    }
    return { execution: res.data };
  }

  /**
   * Stop running execution
   */
  async stopExecution(id: string): Promise<{ success: boolean; error?: string }> {
    const res = await this.request(`/api/v1/executions/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
    });
    if (res.error) {
      return { success: false, error: res.error };
    }
    return { success: true };
  }

  /**
   * List credentials
   */
  async getCredentials(): Promise<{ credentials: N8nCredentialSummary[]; error?: string }> {
    const res = await this.request<{ data: N8nCredentialSummary[] }>('/api/v1/credentials');
    if (res.error) {
      return { credentials: [], error: res.error };
    }
    const credentials = Array.isArray(res.data?.data) ? res.data.data : [];
    return { credentials };
  }

  /**
   * List variables
   */
  async getVariables(): Promise<{ variables: N8nVariable[]; error?: string }> {
    const res = await this.request<{ data: N8nVariable[] }>('/api/v1/variables');
    if (res.error) {
      return { variables: [], error: res.error };
    }
    const variables = Array.isArray(res.data?.data) ? res.data.data : [];
    return { variables };
  }
}

/**
 * Retrieve n8n configuration and initialize N8nClient for a tenant account
 */
export async function getN8nClientForAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<{
  client: N8nClient | null;
  config: {
    id?: string;
    instanceUrl: string;
    editorUrl: string;
    webhookUrl: string;
    hasApiKey: boolean;
    status: string;
    events: string[];
    workflowMappings: Record<string, string>;
    lastTestedAt?: string;
    lastError?: string;
  };
  error?: string;
}> {
  const { data, error } = await supabase
    .from('n8n_integrations')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    return {
      client: null,
      config: {
        instanceUrl: '',
        editorUrl: '',
        webhookUrl: '',
        hasApiKey: false,
        status: 'disconnected',
        events: ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
        workflowMappings: {},
      },
      error: error.message,
    };
  }

  if (!data) {
    return {
      client: null,
      config: {
        instanceUrl: '',
        editorUrl: '',
        webhookUrl: '',
        hasApiKey: false,
        status: 'disconnected',
        events: ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
        workflowMappings: {},
      },
    };
  }

  let decryptedApiKey = '';
  if (data.api_key_encrypted) {
    try {
      decryptedApiKey = decrypt(data.api_key_encrypted);
    } catch (e) {
      console.error('[n8n] Failed to decrypt api_key_encrypted:', e);
    }
  } else if (data.api_key) {
    // Legacy plaintext support if any
    decryptedApiKey = data.api_key;
  }

  let decryptedAuthHeaderVal = '';
  if (data.auth_header_value_encrypted) {
    try {
      decryptedAuthHeaderVal = decrypt(data.auth_header_value_encrypted);
    } catch (e) {
      console.error('[n8n] Failed to decrypt auth_header_value_encrypted:', e);
    }
  }

  const instanceUrl = data.instance_url || '';
  const editorUrl = data.editor_url || instanceUrl;
  const webhookUrl = data.webhook_url || '';

  const client = instanceUrl
    ? new N8nClient({
        instanceUrl,
        apiKey: decryptedApiKey || undefined,
        authHeaderName: data.auth_header_name || undefined,
        authHeaderValue: decryptedAuthHeaderVal || undefined,
      })
    : null;

  return {
    client,
    config: {
      id: data.id,
      instanceUrl,
      editorUrl,
      webhookUrl,
      hasApiKey: !!decryptedApiKey,
      status: data.status || 'disconnected',
      events: data.events || ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
      workflowMappings: (data.workflow_mappings as Record<string, string>) || {},
      lastTestedAt: data.last_tested_at,
      lastError: data.last_error,
    },
  };
}
