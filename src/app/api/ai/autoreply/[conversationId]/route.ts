import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { getT } from '@/lib/i18n/translate'

const t = getT('Api')

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/autoreply/[conversationId]  (agent+)
 *
 * Toggle the AI auto-reply bot for one conversation from the inbox — the
 * "Take over" / "Resume AI" banner.
 *
 * Body: { paused: boolean, assign_to_me?: boolean }
 *   - paused: true  → pause the bot here (a human is taking over). When
 *                     `assign_to_me` is set, also assign the thread to the
 *                     caller (the usual "Take over" flow). Assignment
 *                     fires the `on_conversation_assigned` trigger.
 *   - paused: false → hand the thread back to the bot: clear the pause,
 *                     reset the per-conversation reply count so it gets
 *                     fresh slots, and clear the handoff note. If the
 *                     caller currently owns the thread, unassign it too so
 *                     the bot isn't blocked by the "human owns this" gate.
 *
 * Writes go through the RLS-scoped SSR client, so a conversation outside
 * the caller's account simply isn't found (404).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    // Reuse the send bucket: this is a cheap per-user inbox action and
    // toggling it in a tight loop has no legitimate use.
    const limit = checkRateLimit(`ai-takeover:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    if (!body || (typeof body.paused !== 'boolean' && body.dismiss_request !== true)) {
      return NextResponse.json(
        { error: t('ai.pausedRequired') },
        { status: 400 },
      )
    }

    // Confirm the conversation is in the caller's account before writing.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/autoreply] conversation lookup error:', convErr)
      return NextResponse.json(
        { error: t('common.failedToLoadConversation') },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: t('common.conversationNotFound') }, { status: 404 })
    }

    // Look up operator full name for event history logging
    const { data: operatorProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', userId)
      .maybeSingle()
    const operatorName = operatorProfile?.full_name || 'Operator'

    // Option to dismiss a pending human takeover request without muting AI
    if (body.dismiss_request === true) {
      const { error: upErr } = await supabase
        .from('conversations')
        .update({
          ai_handoff_summary: null,
        })
        .eq('id', conversationId)
        .eq('account_id', accountId)

      if (upErr) {
        return NextResponse.json({ error: t('ai.updateConversationFailed') }, { status: 500 })
      }

      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        content_type: 'text',
        status: 'delivered',
        content_text: `🤖 Human takeover request dismissed by ${operatorName}. AI Assistant continues managing conversation.`,
      })

      return NextResponse.json({ success: true, dismissed: true })
    }

    const paused = body.paused as boolean
    const assignToMe = body.assign_to_me === true

    const update: Record<string, unknown> = {
      ai_autoreply_disabled: paused,
      handling_mode: paused ? 'human' : 'ai',
      ai_handoff_summary: null,
    }

    if (paused) {
      if (assignToMe) update.assigned_agent_id = userId
    } else {
      // Resuming hands the thread *back to the bot*. Clear the pause,
      // reset reply count, and release any human assignment.
      update.assigned_agent_id = null
      update.ai_reply_count = 0
    }

    const { error: upErr } = await supabase
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[ai/autoreply] update error:', upErr)
      return NextResponse.json(
        { error: t('ai.updateConversationFailed') },
        { status: 500 },
      )
    }

    // Save takeover and return-to-AI events into conversation history
    const eventText = paused
      ? `👤 Human takeover activated by ${operatorName}. AI auto-reply is now paused.`
      : `🤖 Conversation returned to AI Assistant by ${operatorName}. AI auto-reply is now active.`

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'text',
      status: 'delivered',
      content_text: eventText,
    })

    return NextResponse.json({ success: true, paused })
  } catch (err) {
    return toErrorResponse(err)
  }
}
