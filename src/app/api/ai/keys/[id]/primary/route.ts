import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { setPrimaryKey } from '@/lib/ai/key-manager'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/ai/keys/[id]/primary  (admin+)
 * Promotes a key to Primary and syncs it with ai_configs.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-key-primary:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Key ID required' }, { status: 400 })

    await setPrimaryKey(supabase, accountId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
