import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { normalizeSmartPhone } from '@/lib/phone-smart-normalize';

// Server-side service client for inbound webhooks
function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const customApiKey = req.headers.get('x-api-key') || '';
    const accountHeader = req.headers.get('x-wacrm-account-id') || '';

    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const token = bearerToken || customApiKey;

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const accountId = accountHeader || body.account_id || body.accountId;
    if (!accountId) {
      return NextResponse.json({ error: 'Account ID is required (header X-WACRM-Account-ID or body account_id)' }, { status: 400 });
    }

    const supabase = getAdminSupabase();

    // Verify account integration
    const { data: integration, error: intErr } = await supabase
      .from('n8n_integrations')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    if (intErr || !integration) {
      return NextResponse.json({ error: 'n8n integration not configured for this account' }, { status: 404 });
    }

    // Verify API key if one is configured
    if (integration.api_key_encrypted) {
      try {
        const expectedKey = decrypt(integration.api_key_encrypted);
        if (token !== expectedKey) {
          return NextResponse.json({ error: 'Unauthorized: Invalid API key' }, { status: 401 });
        }
      } catch {
        return NextResponse.json({ error: 'Security verification failed' }, { status: 500 });
      }
    }

    const action = String(body.action || body.event || '').toLowerCase();

    // Action 1: Template import / sync from n8n
    if (action.includes('template')) {
      const templateData = body.template || body.data || body;
      const rawName = String(templateData.name || templateData.template_name || '').trim();
      const bodyText = String(templateData.body_text || templateData.text || templateData.body || '').trim();

      if (!rawName || !bodyText) {
        return NextResponse.json({ error: 'Template name and body_text are required' }, { status: 400 });
      }

      const cleanName = rawName.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 512);

      const templateRecord = {
        account_id: accountId,
        name: cleanName,
        category: ['Marketing', 'Utility', 'Authentication'].includes(templateData.category)
          ? templateData.category
          : 'Utility',
        language: templateData.language || 'en_US',
        header_type: ['text', 'image', 'video', 'document'].includes(templateData.header_type)
          ? templateData.header_type
          : null,
        header_content: templateData.header_content ? String(templateData.header_content).trim() : null,
        header_media_url: templateData.header_media_url ? String(templateData.header_media_url).trim() : null,
        body_text: bodyText,
        footer_text: templateData.footer_text ? String(templateData.footer_text).trim() : null,
        buttons: Array.isArray(templateData.buttons) ? templateData.buttons : [],
        status: 'APPROVED',
        source: 'n8n',
        is_enabled: templateData.is_enabled !== false,
        n8n_template_id: templateData.n8n_template_id ? String(templateData.n8n_template_id) : null,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('message_templates')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', cleanName)
        .maybeSingle();

      if (existing) {
        const { data: updated, error } = await supabase
          .from('message_templates')
          .update(templateRecord)
          .eq('id', existing.id)
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, action: 'updated', template: updated });
      } else {
        const { data: inserted, error } = await supabase
          .from('message_templates')
          .insert({
            ...templateRecord,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, action: 'created', template: inserted });
      }
    }

    // Action 2: Contact sync / creation
    if (action.includes('contact')) {
      const contactData = body.contact || body.data || body;
      const rawPhone = String(contactData.phone || contactData.mobile || '').trim();

      const norm = normalizeSmartPhone(rawPhone);
      if (!norm.valid || !norm.e164) {
        return NextResponse.json({ error: `Invalid phone number: ${rawPhone}` }, { status: 400 });
      }

      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .eq('phone', norm.e164)
        .maybeSingle();

      const contactRecord = {
        account_id: accountId,
        phone: norm.e164,
        name: contactData.name || null,
        email: contactData.email || null,
        company: contactData.company || null,
        updated_at: new Date().toISOString(),
      };

      if (existingContact) {
        const { data: updated, error } = await supabase
          .from('contacts')
          .update(contactRecord)
          .eq('id', existingContact.id)
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, action: 'updated', contact: updated });
      } else {
        const { data: inserted, error } = await supabase
          .from('contacts')
          .insert({
            ...contactRecord,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) throw error;
        return NextResponse.json({ success: true, action: 'created', contact: inserted });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Webhook received for action: ${action || 'generic'}`,
      receivedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[n8n/webhook] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
