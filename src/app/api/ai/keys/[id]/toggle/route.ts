import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { toggleAiKeyActive } from '@/lib/ai/key-manager'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/ai/keys/[id]/toggle  (admin+)
 * Toggles an AI key between active and disabled.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-key-toggle:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const isActive = Boolean(body.isActive)

    await toggleAiKeyActive(supabase, accountId, id, isActive)
    return NextResponse.json({ ok: true, isActive })
  } catch (err) {
    return toErrorResponse(err)
  }
}
