import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

export async function POST(req: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const body = await req.json().catch(() => ({}));
    let targetUrl: string = body.webhook_url?.trim();
    let apiKey: string | undefined = body.api_key?.trim();
    let authHeaderName: string | undefined = body.auth_header_name?.trim();
    let authHeaderValue: string | undefined = body.auth_header_value?.trim();

    // If not supplied in request body, retrieve from database
    const { data: integration } = await supabase
      .from('n8n_integrations')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!targetUrl && integration?.webhook_url) {
      targetUrl = integration.webhook_url;
    }

    if (!apiKey && integration?.api_key_encrypted) {
      try {
        apiKey = decrypt(integration.api_key_encrypted);
      } catch (err) {
        console.error('[n8n/test] API key decrypt failed:', err);
      }
    }

    if (!authHeaderName && integration?.auth_header_name) {
      authHeaderName = integration.auth_header_name;
    }

    if (!authHeaderValue && integration?.auth_header_value_encrypted) {
      try {
        authHeaderValue = decrypt(integration.auth_header_value_encrypted);
      } catch (err) {
        console.error('[n8n/test] Auth header decrypt failed:', err);
      }
    }

    if (!targetUrl) {
      return NextResponse.json({ error: 'Webhook URL is required to test connection' }, { status: 400 });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'WACRM-n8n-Integration/1.0',
      'X-WACRM-Event': 'test.ping',
      'X-WACRM-Account-ID': accountId,
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (authHeaderName && authHeaderValue) {
      headers[authHeaderName] = authHeaderValue;
    }

    const pingPayload = {
      event: 'test.ping',
      accountId,
      timestamp: new Date().toISOString(),
      message: 'Hello from WhatsApp CRM! Connection test successful.',
    };

    let testSuccess = false;
    let errorMessage: string | null = null;
    let statusCode: number | null = null;

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(pingPayload),
        signal: AbortSignal.timeout(8000),
      });

      statusCode = response.status;
      if (response.ok) {
        testSuccess = true;
      } else {
        const text = await response.text().catch(() => response.statusText);
        errorMessage = `Webhook returned HTTP ${response.status}: ${text.slice(0, 200)}`;
      }
    } catch (fetchErr: unknown) {
      errorMessage = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    }

    // Update status in database if integration exists
    if (integration) {
      await supabase
        .from('n8n_integrations')
        .update({
          status: testSuccess ? 'connected' : 'error',
          last_tested_at: new Date().toISOString(),
          last_error: testSuccess ? null : errorMessage,
        })
        .eq('account_id', accountId);
    }

    if (!testSuccess) {
      return NextResponse.json(
        {
          success: false,
          status: statusCode,
          error: errorMessage || 'Failed to reach n8n webhook',
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      status: statusCode,
      message: 'Successfully connected to n8n webhook',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
