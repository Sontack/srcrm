import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { autoDetectAiCredentials } from '@/lib/ai/auto-detect';
import { decrypt } from '@/lib/whatsapp/encryption';

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`ai-detect:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : undefined;

    // If key not sent, allow testing with existing stored key
    if (!apiKey) {
      const { data: existing } = await supabase
        .from('ai_configs')
        .select('api_key, base_url')
        .eq('account_id', accountId)
        .maybeSingle();

      if (existing?.api_key) {
        try {
          apiKey = decrypt(existing.api_key);
        } catch {
          // Ignore decryption error
        }
      }
    }

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: 'Please enter an API key to detect provider and models' },
        { status: 400 }
      );
    }

    const result = await autoDetectAiCredentials({ apiKey, baseUrl });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
