import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { getN8nClientForAccount } from '@/lib/n8n/client';

export async function GET(req: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { client, config } = await getN8nClientForAccount(supabase, accountId);

    if (!client || !config.instanceUrl) {
      return NextResponse.json({
        workflows: [],
        configured: false,
        message: 'n8n instance is not configured. Please set your instance URL in Settings.',
      });
    }

    const { searchParams } = new URL(req.url);
    const active = searchParams.get('active');
    const tags = searchParams.get('tags');
    const limit = searchParams.get('limit');
    const cursor = searchParams.get('cursor');

    const result = await client.getWorkflows({
      active: active !== null ? active === 'true' : undefined,
      tags: tags || undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor: cursor || undefined,
    });

    if (result.error) {
      return NextResponse.json({ workflows: [], error: result.error }, { status: 502 });
    }

    return NextResponse.json({
      workflows: result.workflows,
      nextCursor: result.nextCursor,
      configured: true,
      instanceUrl: config.instanceUrl,
      editorUrl: config.editorUrl || config.instanceUrl,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { client } = await getN8nClientForAccount(supabase, accountId);

    if (!client) {
      return NextResponse.json(
        { error: 'n8n instance is not configured. Configure it in Settings.' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { name, nodes, connections, settings, staticData, tags } = body;

    if (!name) {
      return NextResponse.json({ error: 'Workflow name is required.' }, { status: 400 });
    }

    const result = await client.createWorkflow({
      name,
      nodes: nodes || [],
      connections: connections || {},
      settings: settings || {},
      staticData,
      tags,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true, workflow: result.workflow });
  } catch (err) {
    return toErrorResponse(err);
  }
}
