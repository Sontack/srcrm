import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt, MAX_OUTPUT_TOKENS } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { pruneConversationContext } from './token-optimizer'
import type { GenerateResult } from './types'
import { executeWithFailover } from './key-manager'
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

    // Build query text combining recent context for short follow-up questions
    // (e.g. "আর কত টাকা লাগবে?", "15", "কী লাগবে?") so follow-ups maintain context.
    const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content.trim())
    const latestUser = userMessages[userMessages.length - 1] || ''
    const prevUser = userMessages[userMessages.length - 2] || ''
    const queryForKnowledge =
      latestUser.length <= 40 && prevUser
        ? `${prevUser} ${latestUser}`
        : latestUser || latestUserMessage(messages)

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      queryForKnowledge,
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
    })

    const prunedMessages = pruneConversationContext(messages, {
      maxTurns: 10,
      maxTotalChars: 3500,
    })

    let generation: GenerateResult | null = null
    let genError: unknown = null

    try {
      generation = await executeWithFailover(db, accountId, async (activeKey) => {
        const activeConfig = {
          ...config,
          provider: activeKey.provider,
          model: activeKey.model,
          baseUrl: activeKey.baseUrl,
          apiKey: activeKey.apiKey,
        }
        return await generateReply({
          config: activeConfig,
          systemPrompt,
          messages: prunedMessages,
          maxTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.3,
        })
      }, config)
    } catch (failoverErr) {
      genError = failoverErr
      console.error('[ai auto-reply] all failover attempts failed:', failoverErr)
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
          ai_handoff_summary: `AI provider error: ${(genError as Error)?.message || 'Generation failed'}`,
        })
        .eq('id', conversationId)

      void notifyOwnerTakeoverRequested(db, {
        accountId,
        conversationId,
        contactId,
        summary: `AI provider temporary failure: ${(genError as Error)?.message || 'Generation failed'}`,
        handoffAgentId: config.handoffAgentId,
      })
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
      // Customer requested human assistance or the model flagged that a human is needed.
      // Strict Manual Takeover Rule: AI must NEVER automatically transfer a conversation
      // to the human agent or disable auto-reply on its own.
      // 1. Politely inform the customer that the team was notified.
      // 2. Alert the owner with customer details and conversation link.
      // 3. Wait for the owner's manual approval via the "Take Over" button.
      const userQuery = latestUserMessage(messages)
      const isBengali =
        /[\u0980-\u09FF]/.test(userQuery) ||
        Boolean(config.systemPrompt && /[\u0980-\u09FF]/.test(config.systemPrompt))

      const waitMessage = isBengali
        ? 'অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন। আমাদের সাপোর্ট টিমকে জানানো হয়েছে এবং একজন প্রতিনিধি শীঘ্রই আপনাকে সহায়তা করবেন।'
        : 'Please wait a moment. Our support team has been notified and will assist you shortly.'

      try {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: waitMessage,
          aiGenerated: true,
        })
        console.log(`[ai auto-reply] Sent takeover wait notice to conversation ${conversationId}`)
      } catch (sendErr) {
        console.error('[ai auto-reply] Failed to deliver takeover wait notice:', sendErr)
      }

      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })

      // Flag takeover request on the conversation without automatically transferring control
      await db
        .from('conversations')
        .update({
          ai_handoff_summary: summary,
        })
        .eq('id', conversationId)

      // Send instant CRM notification to the owner/admins
      void notifyOwnerTakeoverRequested(db, {
        accountId,
        conversationId,
        contactId,
        summary,
        handoffAgentId: config.handoffAgentId,
      })
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

/**
 * Notifies the account owner and admins that a customer has requested human takeover.
 * Does NOT transfer control automatically — leaves AI active until the owner clicks "Take Over".
 */
export async function notifyOwnerTakeoverRequested(
  db: ReturnType<typeof supabaseAdmin>,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    summary: string
    handoffAgentId?: string | null
  },
): Promise<void> {
  const { accountId, conversationId, contactId, summary, handoffAgentId } = args
  try {
    // 1. Fetch contact details (name and phone)
    const { data: contact } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .maybeSingle()

    const contactName = contact?.name || contact?.phone || 'Customer'
    const contactPhone = contact?.phone ? ` (${contact.phone})` : ''

    // 2. Resolve recipients: configured handoff agent + account admins and owners
    const recipientIds = new Set<string>()
    if (handoffAgentId) {
      recipientIds.add(handoffAgentId)
    }

    const { data: teamMembers } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .in('account_role', ['owner', 'admin'])

    if (teamMembers) {
      for (const m of teamMembers) {
        if (m.user_id) recipientIds.add(m.user_id)
      }
    }

    // 3. Insert notification for each recipient
    const title = `Human Takeover Requested: ${contactName}`
    const body = `Customer ${contactName}${contactPhone} requested human support: ${summary}. Click to open and take over.`

    for (const userId of recipientIds) {
      await db.from('notifications').insert({
        account_id: accountId,
        user_id: userId,
        type: 'conversation_assigned',
        conversation_id: conversationId,
        contact_id: contactId,
        title,
        body,
      })
    }

    // 4. Save takeover request event to conversation messages history
    await db.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'text',
      status: 'delivered',
      content_text: `🔔 Customer requested human assistance (${contactName}${contactPhone}). AI waiting for manual takeover approval.`,
    })
  } catch (err) {
    console.error('[ai auto-reply] notifyOwnerTakeoverRequested failed:', err)
  }
}
