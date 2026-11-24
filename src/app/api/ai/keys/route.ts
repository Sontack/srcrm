import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { listAccountAiKeys, saveAiKey } from '@/lib/ai/key-manager'
import { autoDetectAiCredentials, detectProviderFromKey } from '@/lib/ai/auto-detect'
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
 * Automatically detects provider, model, and endpoint if not explicitly provided.
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

    const { id, label, is_primary, is_active, base_url, api_key } = body
    let { provider, model } = body

    if (!api_key || typeof api_key !== 'string' || !api_key.trim()) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }

    const trimmedKey = api_key.trim()
    let trimmedBaseUrl = typeof base_url === 'string' && base_url.trim() ? base_url.trim() : null
    let resolvedLabel = typeof label === 'string' && label.trim() ? label.trim() : undefined

    // Auto-detect provider, model, and baseUrl if not fully specified
    if (!provider || !model) {
      const detectResult = await autoDetectAiCredentials({
        apiKey: trimmedKey,
        baseUrl: trimmedBaseUrl || undefined,
      })

      if (!detectResult.ok) {
        return NextResponse.json(
          { error: detectResult.error || 'Failed to detect AI provider or validate API key' },
          { status: 400 }
        )
      }

      provider = detectResult.provider
      model = detectResult.model
      if (!trimmedBaseUrl && detectResult.baseUrl) {
        trimmedBaseUrl = detectResult.baseUrl
      }
      if (!resolvedLabel) {
        resolvedLabel = `${detectResult.providerName} Key`
      }
    }

    // Ensure OpenAI-compatible endpoints have their appropriate default Base URL
    if (provider === 'openai_compatible' && !trimmedBaseUrl) {
      const detected = detectProviderFromKey(trimmedKey)
      if (detected.baseUrl) {
        trimmedBaseUrl = detected.baseUrl
      }
    }

    if (!['openai', 'anthropic', 'openai_compatible'].includes(provider)) {
      return NextResponse.json({ error: 'Invalid AI provider' }, { status: 400 })
    }

    if (!model || typeof model !== 'string' || !model.trim()) {
      return NextResponse.json({ error: 'Model is required' }, { status: 400 })
    }

    const savedKey = await saveAiKey(supabase, accountId, userId, {
      id: typeof id === 'string' ? id : undefined,
      label: resolvedLabel,
      provider: provider as AiProvider,
      model: model.trim(),
      baseUrl: trimmedBaseUrl,
      apiKey: trimmedKey,
      isPrimary: Boolean(is_primary),
      isActive: is_active !== undefined ? Boolean(is_active) : true,
    })

    return NextResponse.json({ ok: true, key: savedKey })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save AI key'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
