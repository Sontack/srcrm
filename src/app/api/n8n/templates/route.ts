import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET(req: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const url = new URL(req.url);
    const sourceOnly = url.searchParams.get('source');

    let query = supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (sourceOnly) {
      query = query.eq('source', sourceOnly);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[n8n/templates GET] fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
    }

    return NextResponse.json({ templates: data || [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const body = await req.json();

    // Check if body is an array of templates or a single template
    const templateList = Array.isArray(body)
      ? body
      : Array.isArray(body.templates)
      ? body.templates
      : [body];

    const results = [];
    for (const item of templateList) {
      const rawName = String(item.name || item.template_name || '').trim();
      const bodyText = String(item.body_text || item.text || item.body || '').trim();

      if (!rawName || !bodyText) {
        continue;
      }

      // Normalize template name (WhatsApp style: lowercase, underscores)
      const name = rawName
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 512);

      const category = ['Marketing', 'Utility', 'Authentication'].includes(item.category)
        ? item.category
        : 'Utility';

      const language = item.language || 'en_US';
      const headerType = ['text', 'image', 'video', 'document'].includes(item.header_type)
        ? item.header_type
        : null;

      const headerContent = item.header_content ? String(item.header_content).trim() : null;
      const headerMediaUrl = item.header_media_url ? String(item.header_media_url).trim() : null;
      const footerText = item.footer_text ? String(item.footer_text).trim() : null;
      const buttons = Array.isArray(item.buttons) ? item.buttons : [];
      const n8nTemplateId = item.n8n_template_id ? String(item.n8n_template_id) : item.id ? String(item.id) : null;
      const isEnabled = item.is_enabled !== false;

      // Check if template with this name already exists in account
      const { data: existing } = await supabase
        .from('message_templates')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', name)
        .maybeSingle();

      const record = {
        account_id: accountId,
        user_id: userId,
        name,
        category,
        language,
        header_type: headerType,
        header_content: headerContent,
        header_media_url: headerMediaUrl,
        body_text: bodyText,
        footer_text: footerText,
        buttons,
        status: 'APPROVED',
        source: 'n8n',
        is_enabled: isEnabled,
        n8n_template_id: n8nTemplateId,
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        const { data: updated, error: updateErr } = await supabase
          .from('message_templates')
          .update(record)
          .eq('id', existing.id)
          .select()
          .single();

        if (updateErr) {
          console.error('[n8n/templates POST] update failed:', updateErr);
        } else if (updated) {
          results.push(updated);
        }
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('message_templates')
          .insert({
            ...record,
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertErr) {
          console.error('[n8n/templates POST] insert failed:', insertErr);
        } else if (inserted) {
          results.push(inserted);
        }
      }
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No valid templates could be imported. Please provide name and body_text.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      importedCount: results.length,
      templates: results,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');

    const body = await req.json();
    const { id, is_enabled, body_text, footer_text, category, buttons } = body;

    if (!id) {
      return NextResponse.json({ error: 'Template id is required' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof is_enabled === 'boolean') updates.is_enabled = is_enabled;
    if (typeof body_text === 'string' && body_text.trim()) updates.body_text = body_text.trim();
    if (typeof footer_text === 'string') updates.footer_text = footer_text.trim() || null;
    if (category && ['Marketing', 'Utility', 'Authentication'].includes(category)) updates.category = category;
    if (Array.isArray(buttons)) updates.buttons = buttons;

    const { data, error } = await supabase
      .from('message_templates')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select()
      .single();

    if (error) {
      console.error('[n8n/templates PATCH] update error:', error);
      return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
    }

    return NextResponse.json({ success: true, template: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');

    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Template id is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);

    if (error) {
      console.error('[n8n/templates DELETE] delete error:', error);
      return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
