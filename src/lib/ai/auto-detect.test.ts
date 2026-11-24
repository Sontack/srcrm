import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  detectProviderFromKey,
  fetchAvailableModels,
  autoDetectAiCredentials,
} from './auto-detect';

describe('AI Auto-Detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectProviderFromKey', () => {
    it('detects Anthropic from sk-ant- prefix', () => {
      const res = detectProviderFromKey('sk-ant-api03-abcdef123456');
      expect(res.provider).toBe('anthropic');
      expect(res.baseUrl).toBeNull();
    });

    it('detects Groq from gsk_ prefix', () => {
      const res = detectProviderFromKey('gsk_abcdef1234567890');
      expect(res.provider).toBe('openai_compatible');
      expect(res.providerName).toBe('Groq');
      expect(res.baseUrl).toBe('https://api.groq.com/openai/v1');
    });

    it('detects Google Gemini from AIzaSy prefix', () => {
      const res = detectProviderFromKey('AIzaSyD1234567890abcdef');
      expect(res.provider).toBe('openai_compatible');
      expect(res.providerName).toBe('Google Gemini');
      expect(res.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    });

    it('detects NVIDIA NIM from nvapi- prefix', () => {
      const res = detectProviderFromKey('nvapi-abcdef123456');
      expect(res.provider).toBe('openai_compatible');
      expect(res.providerName).toBe('NVIDIA NIM');
      expect(res.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    });

    it('detects OpenRouter from sk-or- prefix', () => {
      const res = detectProviderFromKey('sk-or-v1-abcdef123456');
      expect(res.provider).toBe('openai_compatible');
      expect(res.providerName).toBe('OpenRouter');
      expect(res.baseUrl).toBe('https://openrouter.ai/api/v1');
    });

    it('detects OpenAI for standard sk- keys', () => {
      const res = detectProviderFromKey('sk-proj-abcdef123456');
      expect(res.provider).toBe('openai');
      expect(res.baseUrl).toBeNull();
    });

    it('respects user-specified custom baseUrl', () => {
      const res = detectProviderFromKey('my-key', 'https://api.deepseek.com/v1');
      expect(res.provider).toBe('openai_compatible');
      expect(res.providerName).toBe('DeepSeek');
      expect(res.baseUrl).toBe('https://api.deepseek.com/v1');
    });
  });

  describe('fetchAvailableModels', () => {
    it('queries OpenAI models and filters chat models', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'text-davinci-003' },
            { id: 'gpt-4o-mini' },
            { id: 'gpt-4o' },
            { id: 'whisper-1' },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await fetchAvailableModels('openai', 'sk-proj-test');
      expect(res.models).toContain('gpt-4o-mini');
      expect(res.models).toContain('gpt-4o');
      expect(res.models).not.toContain('whisper-1');
      expect(res.recommendedModel).toBe('gpt-4o-mini');
    });

    it('falls back to known Anthropic models when query fails', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await fetchAvailableModels('anthropic', 'sk-ant-test');
      expect(res.models).toContain('claude-3-5-haiku-latest');
      expect(res.recommendedModel).toBe('claude-3-5-haiku-latest');
    });

    it('rejects invalid Google Gemini key with descriptive error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'API key not valid. Please pass a valid API key.' },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      await expect(
        fetchAvailableModels(
          'openai_compatible',
          'AIzaSyInvalidKey',
          'https://generativelanguage.googleapis.com/v1beta/openai'
        )
      ).rejects.toThrow('API key not valid');
    });

    it('successfully queries Google Gemini chat models when key is valid', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'models/gemini-2.5-flash-lite' },
            { id: 'models/gemini-2.0-flash' },
            { id: 'models/text-embedding-004' },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await fetchAvailableModels(
        'openai_compatible',
        'AIzaSyValidKey',
        'https://generativelanguage.googleapis.com/v1beta/openai'
      );
      expect(res.models).toContain('models/gemini-2.5-flash-lite');
      expect(res.models).not.toContain('models/text-embedding-004');
      expect(res.recommendedModel).toBe('models/gemini-2.5-flash-lite');
    });
  });

  describe('autoDetectAiCredentials', () => {
    it('returns error when API key is empty', async () => {
      const res = await autoDetectAiCredentials({ apiKey: '' });
      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('returns ok: false and clear error message when Gemini key is rejected', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'API key not valid' },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await autoDetectAiCredentials({ apiKey: 'AIzaSyBadKey' });
      expect(res.ok).toBe(false);
      expect(res.providerName).toBe('Google Gemini');
      expect(res.error).toContain('API key not valid');
      expect(res.model).toBe('');
    });

    it('successfully detects and returns model for valid key', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await autoDetectAiCredentials({ apiKey: 'sk-proj-valid-key' });
      expect(res.ok).toBe(true);
      expect(res.provider).toBe('openai');
      expect(res.model).toBe('gpt-4o-mini');
    });
  });
});
