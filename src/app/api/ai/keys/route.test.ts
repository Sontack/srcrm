import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

const h = vi.hoisted(() => ({
  savedKey: null as Record<string, unknown> | null,
  listKeys: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    supabase: {},
  }),
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
    supabase: {},
  }),
  toErrorResponse: (err: unknown) => {
    const msg = err instanceof Error ? err.message : 'error'
    return new Response(JSON.stringify({ error: msg }), { status: 400 })
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'rate-limited' }), { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))

vi.mock('@/lib/ai/key-manager', () => ({
  listAccountAiKeys: async () => h.listKeys,
  saveAiKey: async (
    _db: unknown,
    _accountId: string,
    _userId: string,
    input: Record<string, unknown>
  ) => {
    h.savedKey = { id: 'key-123', ...input }
    return h.savedKey
  },
}))

vi.mock('@/lib/ai/auto-detect', () => ({
  detectProviderFromKey: (key: string) => {
    if (key.startsWith('AIzaSy')) {
      return {
        provider: 'openai_compatible',
        providerName: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      }
    }
    return { provider: 'openai', providerName: 'OpenAI', baseUrl: null }
  },
  autoDetectAiCredentials: async (params: { apiKey: string }) => {
    if (params.apiKey.includes('invalid')) {
      return {
        ok: false,
        error: 'API key not valid for provider',
        provider: 'openai',
        providerName: 'OpenAI',
        model: '',
        availableModels: [],
        modelsList: [],
        baseUrl: null,
      }
    }
    if (params.apiKey.startsWith('AIzaSy')) {
      return {
        ok: true,
        provider: 'openai_compatible',
        providerName: 'Google Gemini',
        model: 'models/gemini-2.5-flash-lite',
        availableModels: ['models/gemini-2.5-flash-lite'],
        modelsList: [{ id: 'models/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' }],
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      }
    }
    return {
      ok: true,
      provider: 'openai',
      providerName: 'OpenAI',
      model: 'gpt-4o-mini',
      availableModels: ['gpt-4o-mini'],
      modelsList: [{ id: 'gpt-4o-mini', name: 'GPT 4o Mini' }],
      baseUrl: null,
    }
  },
}))

describe('/api/ai/keys Route', () => {
  beforeEach(() => {
    h.savedKey = null
    h.listKeys = []
  })

  it('GET returns list of account keys', async () => {
    h.listKeys = [{ id: 'key-1', label: 'Primary Key', isPrimary: true }]
    const res = await GET()
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.keys).toHaveLength(1)
  })

  it('POST rejects missing API key', async () => {
    const req = new Request('http://localhost/api/ai/keys', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('API key is required')
  })

  it('POST automatically detects provider and model when not provided', async () => {
    const req = new Request('http://localhost/api/ai/keys', {
      method: 'POST',
      body: JSON.stringify({
        api_key: 'AIzaSyValidGeminiKey',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(h.savedKey?.provider).toBe('openai_compatible')
    expect(h.savedKey?.model).toBe('models/gemini-2.5-flash-lite')
    expect(h.savedKey?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
  })

  it('POST returns 400 when auto-detection fails', async () => {
    const req = new Request('http://localhost/api/ai/keys', {
      method: 'POST',
      body: JSON.stringify({
        api_key: 'invalid-key-test',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('API key not valid')
  })
})
