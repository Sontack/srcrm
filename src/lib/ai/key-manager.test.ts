import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  executeWithFailover,
  clearKeyMemoryCooldown,
  setKeyMemoryCooldown,
  type DecryptedAiKey,
} from './key-manager'
import { encrypt } from '@/lib/whatsapp/encryption'
import { AiError } from './types'

describe('key-manager executeWithFailover', () => {
  const accountId = 'acc-test-123'

  beforeEach(() => {
    clearKeyMemoryCooldown('key-primary')
    clearKeyMemoryCooldown('key-backup-1')
    clearKeyMemoryCooldown('key-backup-2')
  })

  function createMockDb(keys: Array<Partial<DecryptedAiKey> & { id: string; is_primary?: boolean; status?: string; is_active?: boolean }>) {
    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'ai_keys') {
          const resolveData = () =>
            Promise.resolve({
              data: keys.map((k) => ({
                id: k.id,
                account_id: accountId,
                label: k.label || 'Test Key',
                provider: k.provider || 'openai_compatible',
                model: k.model || 'gemini-2.5-flash-lite',
                base_url: k.baseUrl || null,
                api_key: encrypt(k.apiKey || 'test-key-plain'),
                is_primary: k.isPrimary ?? k.is_primary ?? false,
                is_active: k.is_active ?? true,
                status: k.status || 'active',
                rate_limited_until: null,
                priority: k.isPrimary ? 0 : 1,
              })),
              error: null,
            })

          interface MockChain {
            select: () => MockChain
            eq: () => MockChain
            neq: () => MockChain
            order: () => MockChain
            update: () => { eq: () => Promise<{ error: null }> }
            then: <TResult1 = unknown, TResult2 = never>(
              onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
            ) => Promise<TResult1 | TResult2>
          }

          const chain: MockChain = {
            select: () => chain,
            eq: () => chain,
            neq: () => chain,
            order: () => chain,
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            then: (onfulfilled, onrejected) => resolveData().then(onfulfilled, onrejected),
          }
          return chain
        }
        if (table === 'ai_configs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as unknown as SupabaseClient
  }

  it('executes successfully on primary key when healthy', async () => {
    const mockDb = createMockDb([
      { id: 'key-primary', apiKey: 'primary-secret-123', is_primary: true, is_active: true, status: 'active' },
      { id: 'key-backup-1', apiKey: 'backup-secret-456', is_primary: false, is_active: true, status: 'backup' },
    ])

    const attemptedKeys: string[] = []
    const result = await executeWithFailover(mockDb, accountId, async (key) => {
      attemptedKeys.push(key.id)
      return { text: `Generated using ${key.id}` }
    })

    expect(result.text).toBe('Generated using key-primary')
    expect(attemptedKeys).toEqual(['key-primary'])
  })

  it('automatically switches to backup key when primary key hits 429 rate limit', async () => {
    const mockDb = createMockDb([
      { id: 'key-primary', apiKey: 'primary-secret-123', is_primary: true, is_active: true, status: 'active' },
      { id: 'key-backup-1', apiKey: 'backup-secret-456', is_primary: false, is_active: true, status: 'backup' },
    ])

    const attemptedKeys: string[] = []
    const result = await executeWithFailover(mockDb, accountId, async (key) => {
      attemptedKeys.push(key.id)
      if (key.id === 'key-primary') {
        throw new AiError('Rate limit exceeded: 429 Too Many Requests', { status: 429, code: 'rate_limited' })
      }
      return { text: `Success from ${key.id}` }
    })

    expect(result.text).toBe('Success from key-backup-1')
    expect(attemptedKeys).toEqual(['key-primary', 'key-backup-1'])
  })

  it('automatically switches across multiple backup keys on quota exceeded', async () => {
    const mockDb = createMockDb([
      { id: 'key-primary', apiKey: 'primary-secret-123', is_primary: true, is_active: true, status: 'active' },
      { id: 'key-backup-1', apiKey: 'backup-secret-456', is_primary: false, is_active: true, status: 'backup' },
      { id: 'key-backup-2', apiKey: 'backup-secret-789', is_primary: false, is_active: true, status: 'backup' },
    ])

    const attemptedKeys: string[] = []
    const result = await executeWithFailover(mockDb, accountId, async (key) => {
      attemptedKeys.push(key.id)
      if (key.id === 'key-primary') {
        throw new Error('Resource has been exhausted (check quota)')
      }
      if (key.id === 'key-backup-1') {
        throw new Error('You exceeded your current quota, please check your plan')
      }
      return { text: `Success from ${key.id}` }
    })

    expect(result.text).toBe('Success from key-backup-2')
    expect(attemptedKeys).toEqual(['key-primary', 'key-backup-1', 'key-backup-2'])
  })

  it('automatically skips keys that are currently cooling down', async () => {
    const mockDb = createMockDb([
      { id: 'key-primary', apiKey: 'primary-secret-123', is_primary: true, is_active: true, status: 'active' },
      { id: 'key-backup-1', apiKey: 'backup-secret-456', is_primary: false, is_active: true, status: 'backup' },
    ])

    // Primary is already cooling down
    setKeyMemoryCooldown('key-primary', 60000)

    const attemptedKeys: string[] = []
    const result = await executeWithFailover(mockDb, accountId, async (key) => {
      attemptedKeys.push(key.id)
      return { text: `Directly executed on ${key.id}` }
    })

    expect(result.text).toBe('Directly executed on key-backup-1')
    expect(attemptedKeys).toEqual(['key-backup-1'])
  })

  it('throws descriptive error when all candidate keys fail', async () => {
    const mockDb = createMockDb([
      { id: 'key-primary', apiKey: 'primary-secret-123', is_primary: true, is_active: true, status: 'active' },
      { id: 'key-backup-1', apiKey: 'backup-secret-456', is_primary: false, is_active: true, status: 'backup' },
    ])

    await expect(
      executeWithFailover(mockDb, accountId, async () => {
        throw new AiError('429 Rate limit', { status: 429, code: 'rate_limited' })
      })
    ).rejects.toThrow('429 Rate limit')
  })
})
