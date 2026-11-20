import { AiError, type AiProvider } from './types';
import { AI_PROVIDER_DEFAULT_MODEL } from './defaults';

export interface DetectionResult {
  ok: boolean;
  provider: AiProvider;
  providerName: string;
  model: string;
  availableModels: string[];
  baseUrl: string | null;
  message?: string;
  error?: string;
}

export function detectProviderFromKey(
  apiKey: string,
  userBaseUrl?: string
): { provider: AiProvider; providerName: string; baseUrl: string | null } {
  const key = apiKey.trim();
  const url = (userBaseUrl || '').trim();

  if (url) {
    let name = 'OpenAI-Compatible';
    if (url.includes('groq.com')) name = 'Groq';
    else if (url.includes('googleapis.com')) name = 'Google Gemini';
    else if (url.includes('openrouter.ai')) name = 'OpenRouter';
    else if (url.includes('deepseek.com')) name = 'DeepSeek';
    return { provider: 'openai_compatible', providerName: name, baseUrl: url };
  }

  if (key.startsWith('sk-ant-')) {
    return { provider: 'anthropic', providerName: 'Anthropic (Claude)', baseUrl: null };
  }

  if (key.startsWith('gsk_')) {
    return {
      provider: 'openai_compatible',
      providerName: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
    };
  }

  if (key.startsWith('AIzaSy')) {
    return {
      provider: 'openai_compatible',
      providerName: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    };
  }

  if (key.startsWith('sk-or-')) {
    return {
      provider: 'openai_compatible',
      providerName: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    };
  }

  // Default to OpenAI for standard sk- keys
  return { provider: 'openai', providerName: 'OpenAI', baseUrl: null };
}

export async function fetchAvailableModels(
  provider: AiProvider,
  apiKey: string,
  baseUrl?: string | null
): Promise<{ models: string[]; recommendedModel: string }> {
  const key = apiKey.trim();
  if (!key) {
    throw new AiError('API key is required', { code: 'missing_key', status: 400 });
  }

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

      // Filter for chat-friendly completion models
      const chatModels = allIds.filter(
        (id) =>
          (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('chatgpt-')) &&
          !id.includes('instruct') &&
          !id.includes('realtime') &&
          !id.includes('audio')
      );

      // Prioritize top customer-support models
      const preference = ['gpt-5.4-mini', 'gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
      let recommended = AI_PROVIDER_DEFAULT_MODEL.openai;
      for (const pref of preference) {
        if (chatModels.includes(pref)) {
          recommended = pref;
          break;
        }
      }

      const models = chatModels.length > 0 ? chatModels : [recommended];
      return { models, recommendedModel: recommended };
    } catch (err: unknown) {
      if (err instanceof AiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new AiError(`OpenAI verification failed: ${msg}`, { code: 'network_error', status: 502 });
    }
  }

  if (provider === 'anthropic') {
    const knownAnthropicModels = [
      'claude-3-5-haiku-latest',
      'claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-latest',
      'claude-3-opus-latest',
      'claude-3-haiku-20240307',
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
          return { models: ids, recommendedModel: rec };
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
      models: knownAnthropicModels,
      recommendedModel: 'claude-3-5-haiku-latest',
    };
  }

  // OpenAI-Compatible (Groq, Gemini, OpenRouter, Custom)
  const targetBaseUrl = (baseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');
  try {
    const res = await fetch(`${targetBaseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'User-Agent': 'WACRM-AI-Assistant/1.0',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      const allIds: string[] = Array.isArray(data?.data)
        ? data.data.map((m: { id: string }) => m.id)
        : [];

      if (allIds.length > 0) {
        let recommended = allIds[0];
        // Heuristics for common providers
        const preferred = [
          'llama-3.3-70b-versatile',
          'llama-3.1-8b-instant',
          'gemini-1.5-flash',
          'gemini-2.0-flash',
          'openai/gpt-4o-mini',
          'deepseek-chat',
        ];
        for (const p of preferred) {
          if (allIds.includes(p)) {
            recommended = p;
            break;
          }
        }
        return { models: allIds, recommendedModel: recommended };
      }
    }
  } catch (err) {
    console.warn('[auto-detect] Failed to fetch models from OpenAI-compatible endpoint:', err);
  }

  // Fallback defaults for popular compatible endpoints
  if (targetBaseUrl.includes('groq.com')) {
    return {
      models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
      recommendedModel: 'llama-3.3-70b-versatile',
    };
  }

  if (targetBaseUrl.includes('googleapis.com')) {
    return {
      models: ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
      recommendedModel: 'gemini-1.5-flash',
    };
  }

  return {
    models: ['default-model'],
    recommendedModel: 'default-model',
  };
}

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
      baseUrl: null,
      error: 'Please enter an API key',
    };
  }

  const detected = detectProviderFromKey(apiKey, baseUrl);
  try {
    const { models, recommendedModel } = await fetchAvailableModels(
      detected.provider,
      apiKey,
      detected.baseUrl
    );

    return {
      ok: true,
      provider: detected.provider,
      providerName: detected.providerName,
      model: recommendedModel,
      availableModels: models,
      baseUrl: detected.baseUrl,
      message: `Successfully connected to ${detected.providerName}! Recommended model: ${recommendedModel}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      provider: detected.provider,
      providerName: detected.providerName,
      model: AI_PROVIDER_DEFAULT_MODEL[detected.provider] || 'gpt-4o-mini',
      availableModels: [],
      baseUrl: detected.baseUrl,
      error: message,
    };
  }
}
