import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

export type N8nEvent =
  | 'message.received'
  | 'contact.created'
  | 'broadcast.completed'
  | 'conversation.handoff';

export interface N8nPayload {
  event: N8nEvent;
  accountId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export async function dispatchToN8n(
  supabase: SupabaseClient,
  accountId: string,
  event: N8nEvent,
  data: Record<string, unknown>
): Promise<{ dispatched: boolean; status?: number; error?: string }> {
  try {
    const { data: integration, error } = await supabase
      .from('n8n_integrations')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    const envWebhookUrl = (
      process.env.N8N_WEBHOOK_URL ||
      (process.env.N8N_INSTANCE_URL ? `${process.env.N8N_INSTANCE_URL}/webhook/crm-events` : '')
    ).trim();
    const envApiKey = (process.env.N8N_API_KEY || '').trim();

    if ((error || !integration) && !envWebhookUrl) {
      return { dispatched: false };
    }

    if (integration && integration.status === 'disconnected') {
      return { dispatched: false };
    }

    const enabledEvents: string[] = integration?.events || [
      'message.received',
      'contact.created',
      'broadcast.completed',
      'conversation.handoff',
    ];
    if (!enabledEvents.includes(event)) {
      return { dispatched: false };
    }

    // Determine target URL: check event-specific mapping first, fallback to DB webhook_url, then env
    let targetWebhookUrl: string | null = null;
    if (integration?.workflow_mappings && typeof integration.workflow_mappings === 'object') {
      const mapped = (integration.workflow_mappings as Record<string, string>)[event];
      if (mapped && typeof mapped === 'string' && mapped.startsWith('http')) {
        targetWebhookUrl = mapped.trim();
      }
    }

    if (!targetWebhookUrl) {
      targetWebhookUrl = integration?.webhook_url || envWebhookUrl || null;
    }

    if (!targetWebhookUrl) {
      return { dispatched: false };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'WACRM-n8n-Integration/1.0',
      'X-WACRM-Event': event,
      'X-WACRM-Account-ID': accountId,
    };

    let resolvedApiKey = envApiKey;
    if (integration?.api_key_encrypted) {
      try {
        resolvedApiKey = decrypt(integration.api_key_encrypted);
      } catch (decErr) {
        console.error('[n8n dispatch] Failed to decrypt API key:', decErr);
      }
    } else if (integration?.api_key) {
      resolvedApiKey = integration.api_key;
    }

    if (resolvedApiKey) {
      headers['Authorization'] = `Bearer ${resolvedApiKey}`;
      headers['X-N8N-API-KEY'] = resolvedApiKey;
    }

    if (integration?.auth_header_name && integration?.auth_header_value_encrypted) {
      try {
        const headerVal = decrypt(integration.auth_header_value_encrypted);
        headers[integration.auth_header_name] = headerVal;
      } catch (decErr) {
        console.error('[n8n dispatch] Failed to decrypt custom auth header:', decErr);
      }
    }

    const payload: N8nPayload = {
      event,
      accountId,
      timestamp: new Date().toISOString(),
      data,
    };

    const res = await fetch(targetWebhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      console.warn(`[n8n dispatch] Webhook returned HTTP ${res.status}: ${errText}`);
      return { dispatched: true, status: res.status, error: errText };
    }

    return { dispatched: true, status: res.status };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[n8n dispatch] Error dispatching event to n8n:', msg);
    return { dispatched: false, error: msg };
  }
}
