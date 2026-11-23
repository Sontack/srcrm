import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { deleteAiKey } from '@/lib/ai/key-manager'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * DELETE /api/ai/keys/[id]  (admin+)
 * Deletes an AI key.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-key-del:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Key ID required' }, { status: 400 })

    await deleteAiKey(supabase, accountId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
