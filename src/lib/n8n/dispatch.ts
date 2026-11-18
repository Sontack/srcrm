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

    if (error || !integration) {
      return { dispatched: false };
    }

    if (integration.status === 'disconnected') {
      return { dispatched: false };
    }

    const enabledEvents: string[] = integration.events || [];
    if (!enabledEvents.includes(event)) {
      return { dispatched: false };
    }

    // Determine target URL: check event-specific mapping first, fallback to default webhook_url
    let targetWebhookUrl: string | null = integration.webhook_url;
    if (integration.workflow_mappings && typeof integration.workflow_mappings === 'object') {
      const mapped = (integration.workflow_mappings as Record<string, string>)[event];
      if (mapped && typeof mapped === 'string' && mapped.startsWith('http')) {
        targetWebhookUrl = mapped.trim();
      }
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

    if (integration.api_key_encrypted) {
      try {
        const apiKey = decrypt(integration.api_key_encrypted);
        headers['Authorization'] = `Bearer ${apiKey}`;
        headers['X-N8N-API-KEY'] = apiKey;
      } catch (decErr) {
        console.error('[n8n dispatch] Failed to decrypt API key:', decErr);
      }
    }

    if (integration.auth_header_name && integration.auth_header_value_encrypted) {
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
