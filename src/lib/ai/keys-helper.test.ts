import { describe, expect, it } from 'vitest'
import {
  maskApiKey,
  isRateLimitOrQuotaError,
  isAuthError,
  isTemporaryError,
  classifyAiError,
  getCooldownMs,
} from './keys-helper'
import { AiError } from './types'

describe('keys-helper', () => {
  describe('maskApiKey', () => {
    it('masks OpenAI style keys showing prefix and suffix', () => {
      const masked = maskApiKey('sk-proj-1234567890abcdef')
      expect(masked).toContain('sk-proj-')
      expect(masked).toContain('...cdef')
      expect(masked).not.toContain('1234567890')
    })

    it('masks Gemini style keys', () => {
      const masked = maskApiKey('AIzaSyDa9876543210xQ9')
      expect(masked).toContain('AIzaSy')
      expect(masked).toContain('...0xQ9')
      expect(masked).not.toContain('987654321')
    })

    it('handles empty or very short strings gracefully', () => {
      expect(maskApiKey('')).toBe('••••••••')
      expect(maskApiKey('abc')).toBe('••••••••bc')
    })
  })

  describe('isRateLimitOrQuotaError', () => {
    it('detects 429 status code', () => {
      const err = new AiError('Too many requests', { status: 429, code: 'rate_limited' })
      expect(isRateLimitOrQuotaError(err)).toBe(true)
    })

    it('detects quota exceeded messages from Gemini and OpenAI', () => {
      expect(isRateLimitOrQuotaError(new Error('You exceeded your current quota'))).toBe(true)
      expect(isRateLimitOrQuotaError(new Error('Resource has been exhausted (e.g. check quota)'))).toBe(true)
      expect(isRateLimitOrQuotaError(new Error('RESOURCE_EXHAUSTED'))).toBe(true)
      expect(isRateLimitOrQuotaError(new Error('Rate limit reached for model gemini-2.5-flash-lite'))).toBe(true)
    })

    it('returns false for unrelated errors', () => {
      expect(isRateLimitOrQuotaError(new Error('Invalid JSON format'))).toBe(false)
      expect(isRateLimitOrQuotaError(null)).toBe(false)
    })
  })

  describe('isAuthError', () => {
    it('detects 401 and 403 status codes', () => {
      const err401 = new AiError('Unauthorized', { status: 401, code: 'invalid_key' })
      expect(isAuthError(err401)).toBe(true)

      const err403 = new AiError('Forbidden', { status: 403 })
      expect(isAuthError(err403)).toBe(true)
    })

    it('detects invalid key messages', () => {
      expect(isAuthError(new Error('API key not valid. Please pass a valid API key.'))).toBe(true)
      expect(isAuthError(new Error('Incorrect API key provided: sk-***'))).toBe(true)
    })
  })

  describe('isTemporaryError', () => {
    it('detects 5xx and timeout errors', () => {
      expect(isTemporaryError(new AiError('Gateway Timeout', { status: 504, code: 'timeout' }))).toBe(true)
      expect(isTemporaryError(new AiError('Internal Server Error', { status: 500 }))).toBe(true)
      expect(isTemporaryError(new Error('Connection timed out'))).toBe(true)
    })
  })

  describe('classifyAiError & getCooldownMs', () => {
    it('correctly classifies errors and assigns appropriate cooldowns', () => {
      expect(classifyAiError(new Error('Rate limit exceeded'))).toBe('rate_limit')
      expect(getCooldownMs('rate_limit')).toBe(120000)

      expect(classifyAiError(new Error('Quota exhausted'))).toBe('quota')
      expect(getCooldownMs('quota')).toBe(600000)

      expect(classifyAiError(new Error('Invalid API key'))).toBe('auth')
      expect(classifyAiError(new Error('Service Unavailable 503'))).toBe('temporary')
      expect(getCooldownMs('temporary')).toBe(60000)
    })
  })
})
