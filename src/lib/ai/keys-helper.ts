import { AiError } from './types'

/**
 * Mask an API key securely for frontend display and hints.
 * Shows prefix (up to 8 chars) and suffix (last 4 chars), keeping middle hidden.
 * E.g. "sk-proj-1234567890abcdef" -> "sk-proj-...cdef"
 * E.g. "AIzaSyDa9876543210xQ9" -> "AIzaSy...0xQ9"
 */
export function maskApiKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return '••••••••'
  if (trimmed.length <= 8) return '••••••••' + trimmed.slice(-2)

  const prefix = trimmed.slice(0, Math.min(8, Math.floor(trimmed.length / 3)))
  const suffix = trimmed.slice(-4)
  return `${prefix}...${suffix}`
}

export type KeyFailoverReason = 'rate_limit' | 'quota' | 'auth' | 'temporary' | 'other'

/**
 * Detect whether an error represents a rate limit or quota exhaustion that
 * should trigger automatic failover to the next backup key.
 */
export function isRateLimitOrQuotaError(err: unknown): boolean {
  if (!err) return false

  if (err instanceof AiError) {
    if (err.code === 'rate_limited' || err.status === 429) return true
  }

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limited') ||
    msg.includes('ratelimit') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('too many requests') ||
    msg.includes('tpm') ||
    msg.includes('rpm') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('insufficient_quota')
  )
}

/**
 * Detect whether an error is a fatal authentication error (invalid key, unauthorized, forbidden).
 * These keys should be marked 'invalid' so they are not retried.
 */
export function isAuthError(err: unknown): boolean {
  if (!err) return false

  if (err instanceof AiError) {
    if (err.code === 'invalid_key' || err.status === 401 || err.status === 403) return true
  }

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('invalid_key') ||
    msg.includes('invalid_api_key') ||
    msg.includes('invalid api key') ||
    msg.includes('invalid api-key') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('permission_denied') ||
    msg.includes('api key not valid') ||
    msg.includes('incorrect api key')
  )
}

/**
 * Detect whether an error is a temporary upstream provider failure (500, 502, 503, 504, timeout).
 */
export function isTemporaryError(err: unknown): boolean {
  if (!err) return false

  if (err instanceof AiError) {
    if (err.code === 'timeout' || err.code === 'network_error' || err.status >= 500) return true
  }

  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('unreachable') ||
    msg.includes('service unavailable')
  )
}

/**
 * Classify any error into a categorized failover decision.
 */
export function classifyAiError(err: unknown): KeyFailoverReason {
  if (isRateLimitOrQuotaError(err)) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
    return msg.includes('quota') || msg.includes('insufficient_quota') ? 'quota' : 'rate_limit'
  }
  if (isAuthError(err)) return 'auth'
  if (isTemporaryError(err)) return 'temporary'
  return 'other'
}

/**
 * Suggested cooldown period (in milliseconds) based on failure type.
 * - Rate limit: 2 minutes (120s)
 * - Quota exceeded: 10 minutes (600s)
 * - Temporary 5xx: 1 minute (60s)
 */
export function getCooldownMs(reason: KeyFailoverReason): number {
  switch (reason) {
    case 'rate_limit':
      return 2 * 60 * 1000 // 2 minutes
    case 'quota':
      return 10 * 60 * 1000 // 10 minutes
    case 'temporary':
      return 60 * 1000 // 1 minute
    default:
      return 60 * 1000
  }
}
