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

    if (!data) {
      return NextResponse.json({
        configured: false,
        instance_url: '',
        editor_url: '',
        webhook_url: '',
        events: ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
        workflow_mappings: {},
        status: 'disconnected',
        has_api_key: false,
        has_auth_header_value: false,
      });
    }

    return NextResponse.json({
      configured: true,
      id: data.id,
      instance_url: data.instance_url || '',
      editor_url: data.editor_url || data.instance_url || '',
      webhook_url: data.webhook_url || '',
      events: data.events || ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
      workflow_mappings: data.workflow_mappings || {},
      status: data.status || 'disconnected',
      has_api_key: !!(data.api_key_encrypted || data.api_key),
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
