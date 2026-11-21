import { AiError, type AiProvider } from './types';
import { AI_PROVIDER_DEFAULT_MODEL } from './defaults';
import { getCachedDetection, setCachedDetection } from './token-optimizer';

export interface DetectedModelItem {
  id: string;
  name: string;
  description?: string;
  recommended?: boolean;
}

export interface DetectionResult {
  ok: boolean;
  provider: AiProvider;
  providerName: string;
  model: string;
  availableModels: string[];
  modelsList: DetectedModelItem[];
  baseUrl: string | null;
  message?: string;
  error?: string;
}

/**
 * Universal AI Provider Identification from API Key and optional Base URL.
 * Recognizes Google Gemini, OpenAI, OpenRouter, NVIDIA NIM, Groq, Anthropic, DeepSeek, Together AI, Mistral, and Custom OpenAI-Compatible.
 */
export function detectProviderFromKey(
  apiKey: string,
  userBaseUrl?: string
): { provider: AiProvider; providerName: string; baseUrl: string | null } {
  const key = apiKey.trim();
  const url = (userBaseUrl || '').trim();

  if (url) {
    let name = 'OpenAI-Compatible';
    if (url.includes('googleapis.com')) name = 'Google Gemini';
    else if (url.includes('groq.com')) name = 'Groq';
    else if (url.includes('openrouter.ai')) name = 'OpenRouter';
    else if (url.includes('nvidia.com')) name = 'NVIDIA NIM';
    else if (url.includes('deepseek.com')) name = 'DeepSeek';
    else if (url.includes('together.xyz')) name = 'Together AI';
    else if (url.includes('mistral.ai')) name = 'Mistral AI';
    else if (url.includes('localhost') || url.includes('127.0.0.1')) name = 'Local LLM (Ollama/vLLM)';

    return { provider: 'openai_compatible', providerName: name, baseUrl: url };
  }

  // Anthropic Claude
  if (key.startsWith('sk-ant-')) {
    return { provider: 'anthropic', providerName: 'Anthropic (Claude)', baseUrl: null };
  }

  // Groq
  if (key.startsWith('gsk_')) {
    return {
      provider: 'openai_compatible',
      providerName: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
    };
  }

  // Google Gemini (AI Studio & Cloud API)
  if (key.startsWith('AIzaSy')) {
    return {
      provider: 'openai_compatible',
      providerName: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    };
  }

  // NVIDIA NIM (Cloud Functions API)
  if (key.startsWith('nvapi-')) {
    return {
      provider: 'openai_compatible',
      providerName: 'NVIDIA NIM',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    };
  }

  // OpenRouter (Universal AI Gateway)
  if (key.startsWith('sk-or-')) {
    return {
      provider: 'openai_compatible',
      providerName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    };
  }

  // Default for standard sk- keys (OpenAI / ChatGPT)
  return { provider: 'openai', providerName: 'OpenAI', baseUrl: null };
}

/**
 * Universal dynamic model fetcher.
 * Queries the provider's /models endpoint to retrieve real available models,
 * filters chat-capable models, and selects the most token-optimized model for WhatsApp.
 */
export async function fetchAvailableModels(
  provider: AiProvider,
  apiKey: string,
  baseUrl?: string | null
): Promise<{
  models: string[];
  recommendedModel: string;
  modelsList: DetectedModelItem[];
}> {
  const key = apiKey.trim();
  if (!key) {
    throw new AiError('API key is required', { code: 'missing_key', status: 400 });
  }

  // 1. OpenAI
  if (provider === 'openai') {
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${key}`,
          'User-Agent': 'WACRM-AI-Assistant/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const msg = errJson?.error?.message || `OpenAI returned status ${res.status}`;
        throw new AiError(msg, { code: 'invalid_key', status: res.status });
      }

      const data = await res.json();
      const allIds: string[] = Array.isArray(data?.data)
        ? data.data.map((m: { id: string }) => m.id)
        : [];

      // Filter for chat completion models
      const chatModels = allIds.filter(
        (id) =>
          (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('chatgpt-')) &&
          !id.includes('instruct') &&
          !id.includes('realtime') &&
          !id.includes('audio') &&
          !id.includes('whisper') &&
          !id.includes('dall-e') &&
          !id.includes('tts') &&
          !id.includes('embedding')
      );

      // Preferred order for WhatsApp CRM (fastest, most cost-effective first)
      const preference = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o3-mini', 'o1-mini'];
      let recommended = AI_PROVIDER_DEFAULT_MODEL.openai;
      for (const pref of preference) {
        if (chatModels.includes(pref)) {
          recommended = pref;
          break;
        }
      }

      const models = chatModels.length > 0 ? chatModels : [recommended];
      const modelsList: DetectedModelItem[] = models.map((id) => ({
        id,
        name: id.toUpperCase().replace('-', ' '),
        description: id === 'gpt-4o-mini'
          ? 'Fastest, intelligent, lowest token cost (Best for WhatsApp)'
          : id === 'gpt-4o'
            ? 'Omni flagship model for complex tasks'
            : 'OpenAI Chat Model',
        recommended: id === recommended,
      }));

      return { models, recommendedModel: recommended, modelsList };
    } catch (err: unknown) {
      if (err instanceof AiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new AiError(`OpenAI verification failed: ${msg}`, { code: 'network_error', status: 502 });
    }
  }

  // 2. Anthropic (Claude)
  if (provider === 'anthropic') {
    const fallbackAnthropic: DetectedModelItem[] = [
      { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: 'Lightning fast & token-optimized (Best for WhatsApp)', recommended: true },
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', description: 'Most intelligent & capable Claude model' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Compact fast model' },
      { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', description: 'Deep reasoning model' },
    ];

    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'User-Agent': 'WACRM-AI-Assistant/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const data = await res.json();
        const ids: string[] = Array.isArray(data?.data)
          ? data.data.map((m: { id: string }) => m.id)
          : [];
        if (ids.length > 0) {
          const rec =
            ids.find((id) => id.includes('3-5-haiku') || id.includes('haiku')) ||
            ids[0];
          const modelsList: DetectedModelItem[] = ids.map((id) => ({
            id,
            name: id,
            description: id.includes('haiku') ? 'Fast & economical for WhatsApp' : 'Claude model',
            recommended: id === rec,
          }));
          return { models: ids, recommendedModel: rec, modelsList };
        }
      } else if (res.status === 401 || res.status === 403) {
        const errJson = await res.json().catch(() => null);
        throw new AiError(
          errJson?.error?.message || 'Invalid Anthropic API Key',
          { code: 'invalid_key', status: res.status }
        );
      }
    } catch (err: unknown) {
      if (err instanceof AiError) throw err;
    }

    return {
      models: fallbackAnthropic.map((m) => m.id),
      recommendedModel: 'claude-3-5-haiku-latest',
      modelsList: fallbackAnthropic,
    };
  }

  // 3. OpenAI-Compatible Providers (Google Gemini, NVIDIA NIM, OpenRouter, Groq, DeepSeek, Custom)
  const targetBaseUrl = (baseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');

  // A. Google Gemini OpenAI endpoint
  if (targetBaseUrl.includes('googleapis.com')) {
    const knownGemini: DetectedModelItem[] = [
      { id: 'models/gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Next-gen, ultra-fast & intelligent (Recommended)', recommended: true },
      { id: 'models/gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'High speed, token-efficient model' },
      { id: 'models/gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Reliable high-speed workhorse' },
      { id: 'models/gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Complex reasoning model' },
    ];

    try {
      // First try /openai/models
      const res = await fetch(`${targetBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${key}`,
          'User-Agent': 'WACRM-AI-Assistant/1.0',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        const rawIds: string[] = Array.isArray(data?.data)
          ? data.data.map((m: { id: string }) => m.id)
          : [];
        const chatModels = rawIds.filter((id) => id.includes('gemini') && !id.includes('embedding'));
        if (chatModels.length > 0) {
          const rec = chatModels.find((m) => m.includes('2.5-flash')) ||
            chatModels.find((m) => m.includes('2.0-flash')) ||
            chatModels.find((m) => m.includes('1.5-flash')) ||
            chatModels[0];
          return {
            models: chatModels,
            recommendedModel: rec,
            modelsList: chatModels.map((id) => ({
              id,
              name: id.replace('models/', '').toUpperCase(),
              description: id.includes('flash') ? 'Ultra-fast & token-efficient' : 'Gemini model',
              recommended: id === rec,
            })),
          };
        }
      }
    } catch {
      // Fall through to known Gemini defaults
    }

    return {
      models: knownGemini.map((m) => m.id),
      recommendedModel: 'models/gemini-2.5-flash',
      modelsList: knownGemini,
    };
  }

  // B. NVIDIA NIM
  if (targetBaseUrl.includes('nvidia.com')) {
    const knownNvidia: DetectedModelItem[] = [
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', description: 'Top-tier open intelligence (Recommended)', recommended: true },
      { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', description: 'Super fast & lightweight' },
      { id: 'mistralai/mixtral-8x7b-instruct-v0.1', name: 'Mixtral 8x7B Instruct', description: 'High efficiency mixture of experts' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'NVIDIA Nemotron 70B', description: 'NVIDIA optimized reasoning' },
    ];

    try {
      const res = await fetch(`${targetBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${key}`,
          'User-Agent': 'WACRM-AI-Assistant/1.0',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        const rawIds: string[] = Array.isArray(data?.data)
          ? data.data.map((m: { id: string }) => m.id)
          : [];
        if (rawIds.length > 0) {
          const rec = rawIds.find((id) => id.includes('llama-3.3-70b') || id.includes('llama-3.1-70b')) || rawIds[0];
          return {
            models: rawIds,
            recommendedModel: rec,
            modelsList: rawIds.map((id) => ({
              id,
              name: id,
              description: 'NVIDIA NIM Hosted Model',
              recommended: id === rec,
            })),
          };
        }
      }
    } catch {
      // Fall through
    }

    return {
      models: knownNvidia.map((m) => m.id),
      recommendedModel: 'meta/llama-3.3-70b-instruct',
      modelsList: knownNvidia,
    };
  }

  // C. OpenRouter
  if (targetBaseUrl.includes('openrouter.ai')) {
    try {
      const res = await fetch(`${targetBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${key}`,
          'User-Agent': 'WACRM-AI-Assistant/1.0',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data?.data) ? data.data : [];
        const topPreferred = [
          'google/gemini-2.5-flash',
          'openai/gpt-4o-mini',
          'meta-llama/llama-3.3-70b-instruct',
          'deepseek/deepseek-chat',
          'anthropic/claude-3.5-haiku',
          'mistralai/mistral-small-latest',
        ];

        const allIds: string[] = rawList.map((m: { id: string }) => m.id);
        const sortedIds = [
          ...topPreferred.filter((id) => allIds.includes(id)),
          ...allIds.filter((id) => !topPreferred.includes(id)),
        ].slice(0, 50);

        const rec = sortedIds[0] || 'openai/gpt-4o-mini';
        return {
          models: sortedIds,
          recommendedModel: rec,
          modelsList: sortedIds.map((id) => ({
            id,
            name: id,
            description: topPreferred.includes(id) ? 'Popular & token-optimized for WhatsApp' : 'OpenRouter Model',
            recommended: id === rec,
          })),
        };
      }
    } catch {
      // Fall through
    }

    return {
      models: ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'],
      recommendedModel: 'google/gemini-2.5-flash',
      modelsList: [
        { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fastest & low cost', recommended: true },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Economical OpenAI model' },
        { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Open weights flagship' },
        { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', description: 'High reasoning efficiency' },
      ],
    };
  }

  // D. Groq
  if (targetBaseUrl.includes('groq.com')) {
    const knownGroq: DetectedModelItem[] = [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', description: 'Ultra-fast LPU inference (Recommended)', recommended: true },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', description: 'Fastest response time' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: '32k context window' },
    ];

    try {
      const res = await fetch(`${targetBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${key}`,
          'User-Agent': 'WACRM-AI-Assistant/1.0',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        const ids: string[] = Array.isArray(data?.data) ? data.data.map((m: { id: string }) => m.id) : [];
        const chat = ids.filter((id) => !id.includes('whisper'));
        if (chat.length > 0) {
          const rec = chat.find((id) => id.includes('70b-versatile')) || chat[0];
          return {
            models: chat,
            recommendedModel: rec,
            modelsList: chat.map((id) => ({
              id,
              name: id,
              description: 'Groq ultra-fast LPU model',
              recommended: id === rec,
            })),
          };
        }
      }
    } catch {
      // Fall through
    }

    return {
      models: knownGroq.map((m) => m.id),
      recommendedModel: 'llama-3.3-70b-versatile',
      modelsList: knownGroq,
    };
  }

  // E. Generic / Custom OpenAI-Compatible (Ollama, Together AI, Mistral, DeepSeek, etc.)
  try {
    const res = await fetch(`${targetBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'User-Agent': 'WACRM-AI-Assistant/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = await res.json();
      const allIds: string[] = Array.isArray(data?.data)
        ? data.data.map((m: { id: string }) => m.id)
        : Array.isArray(data?.models)
          ? data.models.map((m: { name?: string; id?: string }) => m.name || m.id || '')
          : [];

      if (allIds.length > 0) {
        const preferred = [
          'llama-3.3-70b-versatile',
          'llama-3.1-8b-instant',
          'gemini-2.5-flash',
          'gemini-2.0-flash',
          'gemini-1.5-flash',
          'openai/gpt-4o-mini',
          'deepseek-chat',
          'mistral-small-latest',
        ];

        let recommended = allIds[0];
        for (const p of preferred) {
          if (allIds.includes(p)) {
            recommended = p;
            break;
          }
        }

        return {
          models: allIds,
          recommendedModel: recommended,
          modelsList: allIds.map((id) => ({
            id,
            name: id,
            description: 'Custom Endpoint Model',
            recommended: id === recommended,
          })),
        };
      }
    }
  } catch (err) {
    console.warn('[auto-detect] Failed to fetch models from OpenAI-compatible endpoint:', err);
  }

  // Fallback if probe fails or is offline
  return {
    models: ['default-model'],
    recommendedModel: 'default-model',
    modelsList: [{ id: 'default-model', name: 'Default Model', description: 'Provider standard model', recommended: true }],
  };
}

/**
 * Auto-detects the provider from the API key, probes available models,
 * caches results, and returns complete connection details.
 */
export async function autoDetectAiCredentials(params: {
  apiKey: string;
  baseUrl?: string;
}): Promise<DetectionResult> {
  const { apiKey, baseUrl } = params;
  if (!apiKey || !apiKey.trim()) {
    return {
      ok: false,
      provider: 'openai',
      providerName: 'OpenAI',
      model: AI_PROVIDER_DEFAULT_MODEL.openai,
      availableModels: [],
      modelsList: [],
      baseUrl: null,
      error: 'Please enter an API key',
    };
  }

  const cacheKey = `${apiKey.trim().slice(0, 10)}:${baseUrl?.trim() || ''}`;
  const cached = getCachedDetection(cacheKey);
  if (cached) return cached;

  let detected = detectProviderFromKey(apiKey, baseUrl);

  try {
    let fetchResult = await fetchAvailableModels(
      detected.provider,
      apiKey,
      detected.baseUrl
    );

    const result: DetectionResult = {
      ok: true,
      provider: detected.provider,
      providerName: detected.providerName,
      model: fetchResult.recommendedModel,
      availableModels: fetchResult.models,
      modelsList: fetchResult.modelsList || [],
      baseUrl: detected.baseUrl,
      message: `Successfully connected to ${detected.providerName}! Selected model: ${fetchResult.recommendedModel}`,
    };

    setCachedDetection(cacheKey, result);
    return result;
  } catch (err: unknown) {
    // If OpenAI returned 401 on an sk- key without custom baseUrl, probe DeepSeek & OpenRouter as fallback
    if (detected.provider === 'openai' && !baseUrl) {
      try {
        const deepSeekRes = await fetchAvailableModels('openai_compatible', apiKey, 'https://api.deepseek.com/v1');
        const dsResult: DetectionResult = {
          ok: true,
          provider: 'openai_compatible',
          providerName: 'DeepSeek',
          model: deepSeekRes.recommendedModel,
          availableModels: deepSeekRes.models,
          modelsList: deepSeekRes.modelsList || [],
          baseUrl: 'https://api.deepseek.com/v1',
          message: `Successfully connected to DeepSeek! Selected model: ${deepSeekRes.recommendedModel}`,
        };
        setCachedDetection(cacheKey, dsResult);
        return dsResult;
      } catch {
        // DeepSeek also failed, fall through
      }

      try {
        const openRouterRes = await fetchAvailableModels('openai_compatible', apiKey, 'https://openrouter.ai/api/v1');
        const orResult: DetectionResult = {
          ok: true,
          provider: 'openai_compatible',
          providerName: 'OpenRouter',
          model: openRouterRes.recommendedModel,
          availableModels: openRouterRes.models,
          modelsList: openRouterRes.modelsList || [],
          baseUrl: 'https://openrouter.ai/api/v1',
          message: `Successfully connected to OpenRouter! Selected model: ${openRouterRes.recommendedModel}`,
        };
        setCachedDetection(cacheKey, orResult);
        return orResult;
      } catch {
        // OpenRouter failed
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      provider: detected.provider,
      providerName: detected.providerName,
      model: AI_PROVIDER_DEFAULT_MODEL[detected.provider] || 'gpt-4o-mini',
      availableModels: [],
      modelsList: [],
      baseUrl: detected.baseUrl,
      error: message,
    };
  }
}
