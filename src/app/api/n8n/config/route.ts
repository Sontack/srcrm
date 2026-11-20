import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('n8n_integrations')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    if (error) {
      console.error('[n8n/config GET] fetch error:', error);
      return NextResponse.json({ error: 'Failed to load n8n integration' }, { status: 500 });
    }

    const envInstanceUrl = process.env.N8N_INSTANCE_URL || '';
    const envApiKey = process.env.N8N_API_KEY || '';
    const envWebhookUrl = process.env.N8N_WEBHOOK_URL || (envInstanceUrl ? `${envInstanceUrl}/webhook/crm-events` : '');

    if (!data) {
      return NextResponse.json({
        configured: !!envInstanceUrl,
        instance_url: envInstanceUrl,
        editor_url: process.env.N8N_EDITOR_URL || envInstanceUrl,
        webhook_url: envWebhookUrl,
        events: ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
        workflow_mappings: {},
        status: envInstanceUrl ? 'connected' : 'disconnected',
        has_api_key: !!envApiKey,
        has_auth_header_value: false,
      });
    }

    const instanceUrl = data.instance_url || envInstanceUrl || '';
    const editorUrl = data.editor_url || data.instance_url || process.env.N8N_EDITOR_URL || instanceUrl;
    const webhookUrl = data.webhook_url || envWebhookUrl || '';

    return NextResponse.json({
      configured: !!(instanceUrl || data.webhook_url),
      id: data.id,
      instance_url: instanceUrl,
      editor_url: editorUrl,
      webhook_url: webhookUrl,
      events: data.events || ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
      workflow_mappings: data.workflow_mappings || {},
      status: data.status || (instanceUrl ? 'connected' : 'disconnected'),
      has_api_key: !!(data.api_key_encrypted || data.api_key || envApiKey),
      auth_header_name: data.auth_header_name || '',
      has_auth_header_value: !!data.auth_header_value_encrypted,
      last_tested_at: data.last_tested_at,
      last_error: data.last_error,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const body = await req.json();
    const {
      instance_url,
      editor_url,
      webhook_url,
      api_key,
      auth_header_name,
      auth_header_value,
      events,
      workflow_mappings,
      status,
    } = body;

    // Fetch existing integration to retain keys if not changed
    const { data: existing } = await supabase
      .from('n8n_integrations')
      .select('api_key_encrypted, auth_header_value_encrypted')
      .eq('account_id', accountId)
      .maybeSingle();

    let apiKeyEncrypted = existing?.api_key_encrypted || null;
    if (api_key) {
      apiKeyEncrypted = encrypt(api_key.trim());
    } else if (api_key === '') {
      apiKeyEncrypted = null;
    }

    let authHeaderValueEncrypted = existing?.auth_header_value_encrypted || null;
    if (auth_header_value) {
      authHeaderValueEncrypted = encrypt(auth_header_value.trim());
    } else if (auth_header_value === '') {
      authHeaderValueEncrypted = null;
    }

    const payload = {
      account_id: accountId,
      instance_url: instance_url !== undefined ? (instance_url ? instance_url.trim() : null) : undefined,
      editor_url: editor_url !== undefined ? (editor_url ? editor_url.trim() : null) : undefined,
      webhook_url: webhook_url !== undefined ? (webhook_url ? webhook_url.trim() : null) : undefined,
      api_key_encrypted: apiKeyEncrypted,
      auth_header_name: auth_header_name !== undefined ? (auth_header_name ? auth_header_name.trim() : null) : undefined,
      auth_header_value_encrypted: authHeaderValueEncrypted,
      events: Array.isArray(events) ? events : ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
      workflow_mappings: workflow_mappings && typeof workflow_mappings === 'object' ? workflow_mappings : {},
      status: status || (instance_url || webhook_url ? 'connected' : 'disconnected'),
      updated_at: new Date().toISOString(),
    };

    // Filter out undefined keys
    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).filter(([_, v]) => v !== undefined)
    );

    const { error: upsertErr } = await supabase
      .from('n8n_integrations')
      .upsert(sanitizedPayload, { onConflict: 'account_id' });

    if (upsertErr) {
      console.error('[n8n/config POST] upsert error:', upsertErr);
      return NextResponse.json({ error: 'Failed to save n8n configuration' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
