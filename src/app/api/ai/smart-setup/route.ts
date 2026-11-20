import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { validateAiCredentials } from '@/lib/ai/validate';
import { autoDetectAiCredentials } from '@/lib/ai/auto-detect';
import { buildSmartSystemPrompt, type BusinessInfo } from '@/lib/ai/smart-prompt';
import { syncBusinessKnowledgeToDatabase } from '@/lib/ai/business-knowledge';
import { invalidateAiAccountStatus } from '@/lib/ai/account-status-cache';
import type { AiProvider } from '@/lib/ai/types';

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(`ai-smart-setup:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    let provider = body.provider as AiProvider | undefined;
    let model = typeof body.model === 'string' ? body.model.trim() : undefined;
    let baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : null;
    const businessInfo = (body.businessInfo || {}) as BusinessInfo;
    const autoReplyEnabled = body.autoReplyEnabled !== false;
    const maxReplies =
      typeof body.maxPerConversation === 'number' && body.maxPerConversation >= 1 && body.maxPerConversation <= 20
        ? body.maxPerConversation
        : 3;
    const handoffAgentId = typeof body.handoffAgentId === 'string' ? body.handoffAgentId.trim() : null;

    // Check for existing stored key if none provided
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('api_key, embeddings_api_key, provider, model, base_url, system_prompt')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!apiKey && existing?.api_key) {
      try {
        apiKey = decrypt(existing.api_key);
        if (!provider) provider = existing.provider as AiProvider;
        if (!model) model = existing.model;
        if (!baseUrl) baseUrl = existing.base_url;
      } catch {
        // Fall through to missing key error
      }
    }

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: 'API key is required to configure AI Agent' },
        { status: 400 }
      );
    }

    // Auto-detect provider & model if missing
    if (!provider || !model) {
      const detected = await autoDetectAiCredentials({ apiKey, baseUrl: baseUrl || undefined });
      if (!detected.ok) {
        return NextResponse.json(
          { ok: false, error: detected.error || 'Failed to validate API key with AI provider' },
          { status: 400 }
        );
      }
      provider = detected.provider;
      model = detected.model;
      if (detected.baseUrl) baseUrl = detected.baseUrl;
    }

    // Embeddings key: for OpenAI, use the same key automatically if none already set
    let embeddingsKeyPlain: string | null = null;
    if (provider === 'openai') {
      embeddingsKeyPlain = apiKey;
    } else if (existing?.embeddings_api_key) {
      try {
        embeddingsKeyPlain = decrypt(existing.embeddings_api_key);
      } catch {
        // Ignore
      }
    }

    // Validate credentials via test ping
    try {
      await validateAiCredentials({
        provider,
        model,
        apiKey,
        baseUrl,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled,
        autoReplyMaxPerConversation: maxReplies,
        handoffAgentId,
        embeddingsApiKey: embeddingsKeyPlain,
      });
    } catch (valErr: unknown) {
      const msg = valErr instanceof Error ? valErr.message : String(valErr);
      return NextResponse.json(
        { ok: false, error: `AI provider connection test failed: ${msg}` },
        { status: 400 }
      );
    }

    // Build smart tailored system prompt
    const smartSystemPrompt =
      businessInfo.businessName || businessInfo.servicesAndPricing || businessInfo.policies
        ? buildSmartSystemPrompt(businessInfo)
        : existing?.system_prompt || buildSmartSystemPrompt({ businessName: 'Our Business' });

    // Encrypt and persist config
    const encryptedKey = encrypt(apiKey);
    const encryptedEmbeddingsKey = embeddingsKeyPlain ? encrypt(embeddingsKeyPlain) : null;

    const payload = {
      account_id: accountId,
      provider,
      model,
      base_url: baseUrl,
      api_key: encryptedKey,
      embeddings_api_key: encryptedEmbeddingsKey,
      system_prompt: smartSystemPrompt,
      is_active: true,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxReplies,
      handoff_agent_id: handoffAgentId || null,
      updated_at: new Date().toISOString(),
    };

    let saveErr = null;
    if (existing) {
      const { error } = await supabase
        .from('ai_configs')
        .update(payload)
        .eq('account_id', accountId);
      saveErr = error;
    } else {
      const { error } = await supabase.from('ai_configs').insert({
        ...payload,
        created_by: userId,
      });
      saveErr = error;
    }

    if (saveErr) {
      console.error('[ai/smart-setup] Save config error:', saveErr);
      return NextResponse.json(
        { ok: false, error: 'Failed to save AI configuration in database' },
        { status: 500 }
      );
    }

    // Sync business knowledge documents if provided
    let knowledgeResult = { documentsCreated: 0, documents: [] as unknown[] };
    if (
      businessInfo.businessName ||
      businessInfo.servicesAndPricing ||
      businessInfo.policies ||
      businessInfo.faqs
    ) {
      try {
        knowledgeResult = await syncBusinessKnowledgeToDatabase(
          supabase,
          accountId,
          userId,
          businessInfo,
          embeddingsKeyPlain
        );
      } catch (kbErr) {
        console.warn('[ai/smart-setup] Knowledge sync warning:', kbErr);
      }
    }

    invalidateAiAccountStatus();

    return NextResponse.json({
      ok: true,
      configured: true,
      is_active: true,
      auto_reply_enabled: autoReplyEnabled,
      provider,
      model,
      baseUrl,
      system_prompt: smartSystemPrompt,
      knowledgeDocsCreated: knowledgeResult.documentsCreated,
      message: 'AI Customer Support Agent configured and activated successfully!',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
