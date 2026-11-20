import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getN8nClientForAccount, N8nClient } from '@/lib/n8n/client';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { client, config } = await getN8nClientForAccount(supabase, accountId);

    if (!config.instanceUrl) {
      return NextResponse.json({
        configured: false,
        connected: false,
        instanceUrl: '',
        editorUrl: '',
        status: 'disconnected',
        message: 'No n8n instance URL configured.',
      });
    }

    if (!client) {
      return NextResponse.json({
        configured: true,
        connected: false,
        instanceUrl: config.instanceUrl,
        editorUrl: config.editorUrl,
        status: 'disconnected',
        message: 'Missing n8n client configuration.',
      });
    }

    const testResult = await client.testConnection();

    // Upsert status in DB so the account row is automatically created/updated
    if (config.instanceUrl) {
      await supabase
        .from('n8n_integrations')
        .upsert(
          {
            account_id: accountId,
            instance_url: config.instanceUrl,
            editor_url: config.editorUrl || config.instanceUrl,
            webhook_url: config.webhookUrl || `${config.instanceUrl}/webhook/crm-events`,
            status: testResult.ok ? 'connected' : 'error',
            last_tested_at: new Date().toISOString(),
            last_error: testResult.error || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'account_id' }
        );
    }

    return NextResponse.json({
      configured: true,
      connected: testResult.ok,
      instanceUrl: config.instanceUrl,
      editorUrl: config.editorUrl || config.instanceUrl,
      status: testResult.ok ? 'connected' : 'error',
      version: testResult.version,
      error: testResult.error,
      workflowMappings: config.workflowMappings,
      events: config.events,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { instance_url, api_key, auth_header_name, auth_header_value } = await req.json();

    if (!instance_url) {
      return NextResponse.json({ error: 'Instance URL is required.' }, { status: 400 });
    }

    const client = new N8nClient({
      instanceUrl: instance_url,
      apiKey: api_key || undefined,
      authHeaderName: auth_header_name || undefined,
      authHeaderValue: auth_header_value || undefined,
    });

    const result = await client.testConnection();
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
