import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { getN8nClientForAccount } from '@/lib/n8n/client';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();
    const { client } = await getN8nClientForAccount(supabase, accountId);

    if (!client) {
      return NextResponse.json({ error: 'n8n instance is not configured.' }, { status: 400 });
    }

    const result = await client.getWorkflow(id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    return NextResponse.json({ workflow: result.workflow });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const { client } = await getN8nClientForAccount(supabase, accountId);

    if (!client) {
      return NextResponse.json({ error: 'n8n instance is not configured.' }, { status: 400 });
    }

    const body = await req.json();
    const result = await client.updateWorkflow(id, body);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true, workflow: result.workflow });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const { client } = await getN8nClientForAccount(supabase, accountId);

    if (!client) {
      return NextResponse.json({ error: 'n8n instance is not configured.' }, { status: 400 });
    }

    const result = await client.deleteWorkflow(id);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const { client } = await getN8nClientForAccount(supabase, accountId);

    if (!client) {
      return NextResponse.json({ error: 'n8n instance is not configured.' }, { status: 400 });
    }

    const body = await req.json();
    const { active } = body;

    const result = active
      ? await client.activateWorkflow(id)
      : await client.deactivateWorkflow(id);

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true, workflow: result.workflow });
  } catch (err) {
    return toErrorResponse(err);
  }
}
