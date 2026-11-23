import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { revealKeyPlaintext } from '@/lib/ai/key-manager'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/ai/keys/[id]/reveal  (admin+)
 * Securely decrypts and returns the raw API key for the show/hide eye button.
 * Only accessible to verified workspace administrators.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    // Stricter rate limit on key reveal actions
    const limit = checkRateLimit(`ai-key-reveal:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Key ID required' }, { status: 400 })

    const apiKey = await revealKeyPlaintext(supabase, accountId, id)
    return NextResponse.json({ ok: true, apiKey })
  } catch (err) {
    return toErrorResponse(err)
  }
}
