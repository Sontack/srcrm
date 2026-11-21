import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { pruneConversationContext } from './token-optimizer'
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
  } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) {
      console.log(`[ai auto-reply] Auto-reply not enabled for account ${accountId} (configured: ${!!config}, enabled: ${config?.autoReplyEnabled})`);
      return
    }

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) {
      console.log(`[ai auto-reply] Active automation responder exists for account ${accountId}, standing down to prevent collision.`);
      return
    }

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count, handling_mode')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) {
      console.warn(`[ai auto-reply] Conversation ${conversationId} lookup failed:`, convErr)
      return
    }

    // When an operator manually took over the conversation, handling_mode is 'human'
    // or ai_autoreply_disabled is true.
    if (conv.handling_mode === 'human' || conv.ai_autoreply_disabled) {
      console.log(`[ai auto-reply] Paused: conversation ${conversationId} is currently assigned to human operator (ai_autoreply_disabled: ${conv.ai_autoreply_disabled}, handling_mode: ${conv.handling_mode})`)
      return
    }

    // If assigned to a human and handling_mode is not explicitly 'ai', honor human ownership
    if (conv.assigned_agent_id && conv.handling_mode !== 'ai') {
      console.log(`[ai auto-reply] Paused: conversation ${conversationId} is assigned to agent ${conv.assigned_agent_id}`)
      return
    }

    // Per-conversation reply cap check
    const maxCap = config.autoReplyMaxPerConversation || 20;
    if ((conv.ai_reply_count ?? 0) >= maxCap) {
      console.log(`[ai auto-reply] Conversation ${conversationId} reached auto-reply limit (${conv.ai_reply_count}/${maxCap})`)
      return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Every gate has passed — we're committed to attempting a reply, so
    // show the customer "typing…" (and mark their message read) while the
    // retrieval + LLM round trips run. Meta clears the indicator after
    // 25 s or when our reply lands, whichever is first, so there's
    // nothing to undo on the handoff / no-text path. Strictly
    // best-effort: a failed indicator must never cost us the reply.
    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId)
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
    })

    const prunedMessages = pruneConversationContext(messages, {
      maxTurns: 8,
      maxTotalChars: 1500,
    })

    let generation: { text: string; handoff: boolean; usage: any } | null = null
    let genError: unknown = null

    try {
      generation = await generateReply({
        config,
        systemPrompt,
        messages: prunedMessages,
        maxTokens: 350,
        temperature: 0.3,
      })
    } catch (firstErr) {
      genError = firstErr
      console.warn('[ai auto-reply] first generate attempt failed, retrying once:', firstErr)
      try {
        generation = await generateReply({
          config,
          systemPrompt,
          messages: prunedMessages,
          maxTokens: 350,
          temperature: 0.3,
        })
        genError = null
      } catch (retryErr) {
        genError = retryErr
        console.error('[ai auto-reply] retry generate attempt also failed:', retryErr)
      }
    }

    if (!generation || genError) {
      // LLM failed after retry — provide a safe, polite fallback response so
      // the customer is NEVER left on Seen with no response.
      const userQuery = latestUserMessage(messages)
      const isBengali =
        /[\u0980-\u09FF]/.test(userQuery) ||
        Boolean(config.systemPrompt && /[\u0980-\u09FF]/.test(config.systemPrompt))
      const fallbackText = isBengali
        ? 'ধন্যবাদ! আমরা আপনার বার্তাটি পেয়েছি। আমাদের একজন প্রতিনিধি শীঘ্রই আপনাকে উত্তর দেবেন।'
        : 'Thank you for contacting us! We have received your message. Our team will get back to you shortly.'

      try {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: fallbackText,
          aiGenerated: true,
        })
        console.log(`[ai auto-reply] Safe fallback response delivered to conversation ${conversationId}`)
      } catch (fallbackSendErr) {
        console.error('[ai auto-reply] Safe fallback delivery failed:', fallbackSendErr)
      }

      await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: true,
          ai_handoff_summary: `AI provider error: ${(genError as Error)?.message || 'Generation failed'}`,
          handling_mode: 'human',
        })
        .eq('id', conversationId)
      if (config.handoffAgentId) {
        await db
          .from('conversations')
          .update({ assigned_agent_id: config.handoffAgentId })
          .eq('id', conversationId)
          .is('assigned_agent_id', null)
      }
      return
    }

    const { text, handoff, usage } = generation

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      await db
        .from('conversations')
        .update({
          ai_autoreply_disabled: true,
          ai_handoff_summary: summary,
          handling_mode: 'human',
        })
        .eq('id', conversationId)
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId) {
        await db
          .from('conversations')
          .update({ assigned_agent_id: config.handoffAgentId })
          .eq('id', conversationId)
          .is('assigned_agent_id', null)
      }
      return
    }

    if (
      inboundMessageId &&
      (await hasNewerInbound(db, conversationId, inboundMessageId))
    ) {
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      console.error('[ai auto-reply] claim_ai_reply_slot failed, attempting fallback direct update:', claimErr)
      const { data: directUpd, error: directErr } = await db
        .from('conversations')
        .update({
          ai_reply_count: (conv.ai_reply_count ?? 0) + 1,
        })
        .eq('id', conversationId)
        .select('id')
      if (directErr || !directUpd || directUpd.length === 0) {
        console.error('[ai auto-reply] fallback direct update also failed:', directErr)
        return
      }
    } else if (claimed !== true) {
      console.log(`[ai auto-reply] Slot not claimed (claimed: ${claimed}) for conversation ${conversationId}`)
      return
    }

    try {
      const sendRes = await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text,
        aiGenerated: true,
      })
      console.log(`[ai auto-reply] Successfully replied to conversation ${conversationId} for contact ${contactId} (whatsapp_message_id: ${sendRes.whatsapp_message_id})`)
    } catch (sendErr) {
      console.error('[ai auto-reply] engineSendText delivery failed:', sendErr)
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

async function hasNewerInbound(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  inboundMessageId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return false
  return data[0].message_id !== inboundMessageId
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}
