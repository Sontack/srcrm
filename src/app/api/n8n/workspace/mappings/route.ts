import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';

export const SUPPORTED_EVENTS = [
  {
    event: 'message.received',
    name: 'New Inbound WhatsApp Message',
    description: 'Triggered whenever any contact sends a text, image, audio, or document on WhatsApp.',
  },
  {
    event: 'contact.created',
    name: 'New Contact Created / Imported',
    description: 'Triggered when a new contact is added manually, imported via CSV/Excel, or starts a chat.',
  },
  {
    event: 'broadcast.completed',
    name: 'Broadcast Campaign Finished',
    description: 'Triggered when a mass WhatsApp broadcast campaign completes delivery to all recipients.',
  },
  {
    event: 'conversation.handoff',
    name: 'Human Agent Handover Requested',
    description: 'Triggered when AI detects the customer wants human support or agent clicks Handover.',
  },
];

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data } = await supabase
      .from('n8n_integrations')
      .select('workflow_mappings, events')
      .eq('account_id', accountId)
      .maybeSingle();

    return NextResponse.json({
      events: SUPPORTED_EVENTS,
      activeEvents: data?.events || ['message.received', 'contact.created', 'broadcast.completed', 'conversation.handoff'],
      workflowMappings: data?.workflow_mappings || {},
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await req.json();
    const { workflowMappings, activeEvents } = body;

    const payload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (workflowMappings && typeof workflowMappings === 'object') {
      payload.workflow_mappings = workflowMappings;
    }

    if (Array.isArray(activeEvents)) {
      payload.events = activeEvents;
    }

    const { error } = await supabase
      .from('n8n_integrations')
      .update(payload)
      .eq('account_id', accountId);

    if (error) {
      console.error('[n8n/mappings POST] error:', error);
      return NextResponse.json({ error: 'Failed to update workflow mappings' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
