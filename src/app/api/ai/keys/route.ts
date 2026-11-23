import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { listAccountAiKeys, saveAiKey } from '@/lib/ai/key-manager'
import type { AiProvider } from '@/lib/ai/types'

/**
 * GET /api/ai/keys
 * List all saved AI keys for the current account (masked hints only).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const keys = await listAccountAiKeys(supabase, accountId)
    return NextResponse.json({ keys })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/keys  (admin+)
 * Add a new API key or update an existing key.
 * Validates with provider, encrypts, and stores.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-keys:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { id, label, provider, model, base_url, api_key, is_primary, is_active } = body

    if (!provider || !['openai', 'anthropic', 'openai_compatible'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid AI provider' }, { status: 400 })
    }

    if (!model || typeof model !== 'string' || !model.trim()) {
      return NextResponse.json({ error: 'Model is required' }, { status: 400 })
    }

    if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    const savedKey = await saveAiKey(supabase, accountId, userId, {
      id: typeof id === 'string' ? id : undefined,
      label: typeof label === 'string' ? label.trim() : undefined,
      provider: provider as AiProvider,
      model: model.trim(),
      baseUrl: typeof base_url === 'string' ? base_url.trim() : null,
      apiKey: api_key.trim(),
      isPrimary: Boolean(is_primary),
      isActive: is_active !== undefined ? Boolean(is_active) : true,
    })

    return NextResponse.json({ ok: true, key: savedKey })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save AI key'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
