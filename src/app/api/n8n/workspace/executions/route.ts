import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { getN8nClientForAccount } from '@/lib/n8n/client';

export async function GET(req: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { client } = await getN8nClientForAccount(supabase, accountId);

    if (!client) {
      return NextResponse.json({
        executions: [],
        configured: false,
        message: 'n8n instance is not configured.',
      });
    }

    const { searchParams } = new URL(req.url);
    const limit = searchParams.get('limit');
    const status = searchParams.get('status');
    const workflowId = searchParams.get('workflowId');
    const cursor = searchParams.get('cursor');

    const result = await client.getExecutions({
      limit: limit ? parseInt(limit, 10) : 50,
      status: status || undefined,
      workflowId: workflowId || undefined,
      cursor: cursor || undefined,
    });

    if (result.error) {
      return NextResponse.json({ executions: [], error: result.error }, { status: 502 });
    }

    return NextResponse.json({
      executions: result.executions,
      nextCursor: result.nextCursor,
      configured: true,
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
      return NextResponse.json({ error: 'n8n instance is not configured.' }, { status: 400 });
    }

    const body = await req.json();
    const { action, executionId } = body;

    if (!executionId) {
      return NextResponse.json({ error: 'executionId is required.' }, { status: 400 });
    }

    if (action === 'retry') {
      const res = await client.retryExecution(executionId);
      if (res.error) {
        return NextResponse.json({ error: res.error }, { status: 502 });
      }
      return NextResponse.json({ success: true, execution: res.execution });
    } else if (action === 'stop') {
      const res = await client.stopExecution(executionId);
      if (res.error) {
        return NextResponse.json({ error: res.error }, { status: 502 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action. Supported: retry, stop.' }, { status: 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
