import { generateReply } from './generate'
import { AiError, type AiConfig } from './types'

/**
 * Cheap liveness + auth check: validates credentials before persisting.
 * For OpenRouter, uses the dedicated /auth/key endpoint for instant auth verification.
 * For other providers, runs a minimal connectivity test ping.
 * Throws `AiError` on failure, resolves on success.
 */
export async function validateAiCredentials(config: AiConfig): Promise<void> {
  const baseUrl = config.baseUrl || ''
  const apiKey = config.apiKey.trim()

  // OpenRouter dedicated auth verification endpoint
  if (baseUrl.includes('openrouter.ai')) {
    const authRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://wacrm.app',
        'X-Title': 'WACRM WhatsApp CRM',
        'User-Agent': 'WACRM-AI-Assistant/1.0',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!authRes.ok) {
      const errJson = await authRes.json().catch(() => null)
      const msg =
        errJson?.error?.message ||
        `OpenRouter API key validation failed (HTTP ${authRes.status})`
      throw new AiError(msg, { code: 'invalid_key', status: authRes.status })
    }
    return
  }

  await generateReply({
    config,
    systemPrompt: 'You are a connectivity check. Reply with the single word: OK.',
    messages: [{ role: 'user', content: 'ping' }],
  })
}
