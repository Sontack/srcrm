import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig, AiProvider } from './types'
import { validateAiCredentials } from './validate'
import {
  maskApiKey,
  isRateLimitOrQuotaError,
  isAuthError,
  classifyAiError,
  getCooldownMs,
} from './keys-helper'

export interface AiKeyItem {
  id: string
  accountId: string
  label: string
  provider: AiProvider
  model: string
  baseUrl: string | null
  keyHint: string
  isPrimary: boolean
  isActive: boolean
  status: 'active' | 'backup' | 'rate_limited' | 'invalid' | 'disabled'
  rateLimitedUntil: string | null
  lastUsedAt: string | null
  lastTestedAt: string | null
  lastError: string | null
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  rateLimitErrors: number
  priority: number
  createdAt: string
  updatedAt: string
}

export interface DecryptedAiKey {
  id: string
  accountId: string
  label: string
  provider: AiProvider
  model: string
  baseUrl: string | null
  apiKey: string
  isPrimary: boolean
}

export interface SaveKeyInput {
  id?: string
  label?: string
  provider: AiProvider
  model: string
  baseUrl?: string | null
  apiKey: string
  isPrimary?: boolean
  isActive?: boolean
}

// In-memory cooldown cache: keyId -> cooldownUntilMs
const memoryCooldowns = new Map<string, number>()

function isKeyCoolingDown(keyId: string, dbRateLimitedUntil?: string | null): boolean {
  const memUntil = memoryCooldowns.get(keyId)
  const now = Date.now()
  if (memUntil && memUntil > now) return true

  if (dbRateLimitedUntil) {
    const dbUntil = new Date(dbRateLimitedUntil).getTime()
    if (dbUntil > now) return true
  }

  if (memUntil && memUntil <= now) {
    memoryCooldowns.delete(keyId)
  }
  return false
}

export function setKeyMemoryCooldown(keyId: string, durationMs: number) {
  memoryCooldowns.set(keyId, Date.now() + durationMs)
}

export function clearKeyMemoryCooldown(keyId: string) {
  memoryCooldowns.delete(keyId)
}

/**
 * List all AI keys configured for an account.
 * If ai_keys table is not available, falls back to reading ai_configs.
 */
export async function listAccountAiKeys(
  db: SupabaseClient,
  accountId: string
): Promise<AiKeyItem[]> {
  try {
    const { data, error } = await db
      .from('ai_keys')
      .select('*')
      .eq('account_id', accountId)
      .order('is_primary', { ascending: false })
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })

    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map((row) => {
        const cooling = isKeyCoolingDown(row.id, row.rate_limited_until)
        let computedStatus = row.status as AiKeyItem['status']

        // If cooldown has expired, status returns to active or backup
        if (computedStatus === 'rate_limited' && !cooling) {
          computedStatus = row.is_primary ? 'active' : 'backup'
        } else if (cooling && computedStatus !== 'invalid' && computedStatus !== 'disabled') {
          computedStatus = 'rate_limited'
        } else if (row.is_active && computedStatus !== 'invalid' && computedStatus !== 'disabled') {
          computedStatus = row.is_primary ? 'active' : 'backup'
        }

        return {
          id: row.id,
          accountId: row.account_id,
          label: row.label || (row.is_primary ? 'Primary API Key' : 'Backup Key'),
          provider: row.provider as AiProvider,
          model: row.model,
          baseUrl: row.base_url,
          keyHint: row.key_hint || '••••••••',
          isPrimary: Boolean(row.is_primary),
          isActive: Boolean(row.is_active),
          status: computedStatus,
          rateLimitedUntil: cooling
            ? new Date(memoryCooldowns.get(row.id) || row.rate_limited_until).toISOString()
            : null,
          lastUsedAt: row.last_used_at,
          lastTestedAt: row.last_tested_at,
          lastError: row.last_error,
          totalRequests: row.total_requests ?? 0,
          successfulRequests: row.successful_requests ?? 0,
          failedRequests: row.failed_requests ?? 0,
          rateLimitErrors: row.rate_limit_errors ?? 0,
          priority: row.priority ?? 0,
          createdAt: row.created_at || new Date().toISOString(),
          updatedAt: row.updated_at || new Date().toISOString(),
        }
      })
    }
  } catch (err) {
    console.warn('[ai key-manager] listAccountAiKeys ai_keys query failed, falling back to ai_configs:', err)
  }

  // Fallback to ai_configs
  try {
    const { data: cfg } = await db
      .from('ai_configs')
      .select('account_id, provider, model, base_url, api_key, is_active, created_at, updated_at')
      .eq('account_id', accountId)
      .maybeSingle()

    if (cfg && cfg.api_key) {
      let keyHint = '••••••••'
      try {
        const plain = decrypt(cfg.api_key)
        keyHint = maskApiKey(plain)
      } catch {
        // preserve masked placeholder
      }

      const isCooling = memoryCooldowns.has('primary-config-key')
      return [
        {
          id: 'primary-config-key',
          accountId: cfg.account_id,
          label: 'Primary API Key',
          provider: cfg.provider as AiProvider,
          model: cfg.model,
          baseUrl: cfg.base_url,
          keyHint,
          isPrimary: true,
          isActive: Boolean(cfg.is_active),
          status: isCooling ? 'rate_limited' : cfg.is_active ? 'active' : 'disabled',
          rateLimitedUntil: isCooling
            ? new Date(memoryCooldowns.get('primary-config-key')!).toISOString()
            : null,
          lastUsedAt: null,
          lastTestedAt: null,
          lastError: null,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          rateLimitErrors: 0,
          priority: 0,
          createdAt: cfg.created_at || new Date().toISOString(),
          updatedAt: cfg.updated_at || new Date().toISOString(),
        },
      ]
    }
  } catch {
    // Return empty list
  }

  return []
}

/**
 * Save an API key (add new or update existing).
 * Validates with provider, encrypts, and updates ai_keys (and ai_configs if primary).
 */
export async function saveAiKey(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: SaveKeyInput
): Promise<AiKeyItem> {
  const { provider, model } = input
  const baseUrl = input.baseUrl?.trim() || null
  const rawApiKey = input.apiKey.trim()
  const label = input.label?.trim() || (input.isPrimary ? 'Primary Key' : 'Backup Key')

  if (!rawApiKey) {
    throw new Error('API Key cannot be empty')
  }

  // Validate the key with provider before persisting
  const candidateConfig: AiConfig = {
    provider,
    model,
    baseUrl,
    apiKey: rawApiKey,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }

  await validateAiCredentials(candidateConfig)

  const encryptedKey = encrypt(rawApiKey)
  const keyHint = maskApiKey(rawApiKey)

  // Check existing keys to determine priority
  const existingKeys = await listAccountAiKeys(db, accountId)
  const isFirstKey = existingKeys.length === 0
  const isPrimary = input.isPrimary !== undefined ? input.isPrimary : isFirstKey

  let savedId = input.id

  try {
    if (savedId && savedId !== 'primary-config-key') {
      // Update existing
      const { data, error } = await db
        .from('ai_keys')
        .update({
          label,
          provider,
          model,
          base_url: baseUrl,
          api_key: encryptedKey,
          key_hint: keyHint,
          is_primary: isPrimary,
          is_active: input.isActive ?? true,
          status: isPrimary ? 'active' : 'backup',
          rate_limited_until: null,
          last_tested_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', savedId)
        .eq('account_id', accountId)
        .select()
        .single()

      if (error) throw error
      if (data) savedId = data.id
    } else {
      // Insert new
      const nextPriority = existingKeys.length

      if (isPrimary) {
        // Demote previous primary keys
        await db
          .from('ai_keys')
          .update({ is_primary: false, status: 'backup' })
          .eq('account_id', accountId)
          .eq('is_primary', true)
      }

      const { data, error } = await db
        .from('ai_keys')
        .insert({
          account_id: accountId,
          created_by: userId,
          label,
          provider,
          model,
          base_url: baseUrl,
          api_key: encryptedKey,
          key_hint: keyHint,
          is_primary: isPrimary,
          is_active: input.isActive ?? true,
          status: isPrimary ? 'active' : 'backup',
          priority: isPrimary ? 0 : nextPriority,
          last_tested_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) throw error
      if (data) savedId = data.id
    }

    if (savedId) {
      clearKeyMemoryCooldown(savedId)
    }
  } catch (err) {
    console.warn('[ai key-manager] insert/update into ai_keys failed, ensuring ai_configs sync:', err)
  }

  // Synchronize with ai_configs if primary or only key
  if (isPrimary) {
    try {
      const { data: existingCfg } = await db
        .from('ai_configs')
        .select('account_id')
        .eq('account_id', accountId)
        .maybeSingle()

      if (existingCfg) {
        await db
          .from('ai_configs')
          .update({
            provider,
            model,
            base_url: baseUrl,
            api_key: encryptedKey,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId)
      } else {
        await db
          .from('ai_configs')
          .insert({
            account_id: accountId,
            created_by: userId,
            provider,
            model,
            base_url: baseUrl,
            api_key: encryptedKey,
            is_active: true,
            auto_reply_enabled: true,
          })
      }
      clearKeyMemoryCooldown('primary-config-key')
    } catch (cfgErr) {
      console.warn('[ai key-manager] ai_configs sync error:', cfgErr)
    }
  }

  return {
    id: savedId || 'primary-config-key',
    accountId,
    label,
    provider,
    model,
    baseUrl,
    keyHint,
    isPrimary,
    isActive: input.isActive ?? true,
    status: isPrimary ? 'active' : 'backup',
    rateLimitedUntil: null,
    lastUsedAt: null,
    lastTestedAt: new Date().toISOString(),
    lastError: null,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitErrors: 0,
    priority: isPrimary ? 0 : 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Promote an existing key to primary.
 */
export async function setPrimaryKey(
  db: SupabaseClient,
  accountId: string,
  keyId: string
): Promise<void> {
  try {
    // Demote current primary
    await db
      .from('ai_keys')
      .update({ is_primary: false, status: 'backup' })
      .eq('account_id', accountId)

    // Promote new primary
    const { data: promoted, error } = await db
      .from('ai_keys')
      .update({ is_primary: true, status: 'active', priority: 0 })
      .eq('id', keyId)
      .eq('account_id', accountId)
      .select('provider, model, base_url, api_key')
      .single()

    if (error) throw error

    // Sync to ai_configs
    if (promoted && promoted.api_key) {
      await db
        .from('ai_configs')
        .update({
          provider: promoted.provider,
          model: promoted.model,
          base_url: promoted.base_url,
          api_key: promoted.api_key,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accountId)
    }
  } catch (err) {
    console.error('[ai key-manager] setPrimaryKey error:', err)
    throw err
  }
}

/**
 * Delete an API key from an account.
 */
export async function deleteAiKey(
  db: SupabaseClient,
  accountId: string,
  keyId: string
): Promise<void> {
  try {
    const { data: keyToDelete } = await db
      .from('ai_keys')
      .select('is_primary')
      .eq('id', keyId)
      .eq('account_id', accountId)
      .maybeSingle()

    await db.from('ai_keys').delete().eq('id', keyId).eq('account_id', accountId)
    clearKeyMemoryCooldown(keyId)

    // If deleted key was primary, promote next available active key
    if (keyToDelete?.is_primary) {
      const { data: nextKey } = await db
        .from('ai_keys')
        .select('id, provider, model, base_url, api_key')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (nextKey) {
        await db
          .from('ai_keys')
          .update({ is_primary: true, status: 'active', priority: 0 })
          .eq('id', nextKey.id)

        await db
          .from('ai_configs')
          .update({
            provider: nextKey.provider,
            model: nextKey.model,
            base_url: nextKey.base_url,
            api_key: nextKey.api_key,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId)
      }
    }
  } catch (err) {
    console.error('[ai key-manager] deleteAiKey error:', err)
    throw err
  }
}

/**
 * Toggle active state of an API key.
 */
export async function toggleAiKeyActive(
  db: SupabaseClient,
  accountId: string,
  keyId: string,
  isActive: boolean
): Promise<void> {
  const status = isActive ? 'backup' : 'disabled'
  await db
    .from('ai_keys')
    .update({ is_active: isActive, status })
    .eq('id', keyId)
    .eq('account_id', accountId)
}

/**
 * Reveal plaintext API key for an authorized admin.
 */
export async function revealKeyPlaintext(
  db: SupabaseClient,
  accountId: string,
  keyId: string
): Promise<string> {
  if (keyId === 'primary-config-key') {
    const { data } = await db
      .from('ai_configs')
      .select('api_key')
      .eq('account_id', accountId)
      .single()
    if (!data?.api_key) throw new Error('API Key not found')
    return decrypt(data.api_key)
  }

  const { data, error } = await db
    .from('ai_keys')
    .select('api_key')
    .eq('id', keyId)
    .eq('account_id', accountId)
    .single()

  if (error || !data?.api_key) {
    // Try fallback to ai_configs
    const { data: cfg } = await db
      .from('ai_configs')
      .select('api_key')
      .eq('account_id', accountId)
      .maybeSingle()
    if (cfg?.api_key) return decrypt(cfg.api_key)
    throw new Error('API Key not found')
  }

  return decrypt(data.api_key)
}

/**
 * Get all available decrypted keys for an account in priority order (Primary first, then backups).
 */
export async function getDecryptedCandidateKeys(
  db: SupabaseClient,
  accountId: string
): Promise<DecryptedAiKey[]> {
  const candidates: DecryptedAiKey[] = []

  try {
    const { data, error } = await db
      .from('ai_keys')
      .select('id, account_id, label, provider, model, base_url, api_key, is_primary, is_active, status, rate_limited_until, priority, created_at')
      .eq('account_id', accountId)

    if (!error && Array.isArray(data) && data.length > 0) {
      const activeRows = data
        .filter((r) => r.is_active && r.status !== 'invalid' && r.status !== 'disabled')
        .sort((a, b) => {
          if (a.is_primary && !b.is_primary) return -1
          if (!a.is_primary && b.is_primary) return 1
          return (a.priority ?? 0) - (b.priority ?? 0)
        })

      for (const row of activeRows) {
        if (isKeyCoolingDown(row.id, row.rate_limited_until)) {
          continue
        }
        try {
          const plainKey = decrypt(row.api_key)
          candidates.push({
            id: row.id,
            accountId: row.account_id,
            label: row.label || (row.is_primary ? 'Primary Key' : 'Backup Key'),
            provider: row.provider as AiProvider,
            model: row.model,
            baseUrl: row.base_url,
            apiKey: plainKey,
            isPrimary: Boolean(row.is_primary),
          })
        } catch {
          // Decrypt failed, skip
        }
      }
    }
  } catch (err) {
    console.warn('[ai key-manager] getDecryptedCandidateKeys from ai_keys failed, falling back:', err)
  }

  // If no candidates from ai_keys, read from ai_configs
  if (candidates.length === 0) {
    try {
      const { data: cfg } = await db
        .from('ai_configs')
        .select('account_id, provider, model, base_url, api_key, is_active')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .maybeSingle()

      if (cfg && cfg.api_key) {
        if (!isKeyCoolingDown('primary-config-key')) {
          candidates.push({
            id: 'primary-config-key',
            accountId: cfg.account_id,
            label: 'Primary API Key',
            provider: cfg.provider as AiProvider,
            model: cfg.model,
            baseUrl: cfg.base_url,
            apiKey: decrypt(cfg.api_key),
            isPrimary: true,
          })
        }
      }
    } catch {
      // no config
    }
  }

  return candidates
}

/**
 * Record usage statistics for a key after an execution attempt.
 */
export async function recordKeyResult(
  db: SupabaseClient,
  keyId: string,
  result: {
    success: boolean
    error?: unknown
  }
): Promise<void> {
  const { success, error } = result
  const now = new Date().toISOString()

  if (success) {
    if (keyId !== 'primary-config-key') {
      try {
        const total = await getNumericCol(db, keyId, 'total_requests')
        const successes = await getNumericCol(db, keyId, 'successful_requests')
        await db
          .from('ai_keys')
          .update({
            total_requests: total + 1,
            successful_requests: successes + 1,
            last_used_at: now,
            last_error: null,
          })
          .eq('id', keyId)
      } catch {
        // ignore
      }
    }
    return
  }

  // Failure handling
  const errMsg = (error instanceof Error ? error.message : String(error)).slice(0, 500)
  const classification = classifyAiError(error)
  const cooldownMs = getCooldownMs(classification)

  setKeyMemoryCooldown(keyId, cooldownMs)

  if (keyId !== 'primary-config-key') {
    const isAuth = isAuthError(error)
    const isRateLimit = isRateLimitOrQuotaError(error)

    const updatePatch: Record<string, unknown> = {
      total_requests: (await getNumericCol(db, keyId, 'total_requests')) + 1,
      failed_requests: (await getNumericCol(db, keyId, 'failed_requests')) + 1,
      last_error: errMsg,
      last_used_at: now,
    }

    if (isRateLimit) {
      updatePatch.rate_limit_errors = (await getNumericCol(db, keyId, 'rate_limit_errors')) + 1
      updatePatch.rate_limited_until = new Date(Date.now() + cooldownMs).toISOString()
      updatePatch.status = 'rate_limited'
    } else if (isAuth) {
      updatePatch.status = 'invalid'
    }

    try {
      await db.from('ai_keys').update(updatePatch).eq('id', keyId)
    } catch {
      // ignore
    }
  }
}

async function getNumericCol(db: SupabaseClient, keyId: string, col: string): Promise<number> {
  try {
    const { data } = await db.from('ai_keys').select('*').eq('id', keyId).maybeSingle()
    if (data && typeof (data as unknown as Record<string, unknown>)[col] === 'number') {
      return (data as unknown as Record<string, unknown>)[col] as number
    }
  } catch {
    // table or column missing
  }
  return 0
}

/**
 * Execute an AI operation with automatic multiple key failover!
 * 1. Takes the list of active keys (Primary first, then Backup 1, Backup 2...).
 * 2. Attempts operation with Primary key.
 * 3. On 429 rate limit or quota exceeded:
 *    - Records failure & sets cooldown on that key.
 *    - Switches automatically to Backup key 1 and retries!
 * 4. On repeated rate limit/quota: switches to Backup key 2 and retries!
 * 5. Returns successful result and logs stats.
 * 6. If all keys fail, throws descriptive error for safe fallback.
 */
export async function executeWithFailover<T>(
  db: SupabaseClient,
  accountId: string,
  operation: (key: DecryptedAiKey) => Promise<T>,
  fallbackConfig?: AiConfig | null
): Promise<T> {
  const candidateKeys = await getDecryptedCandidateKeys(db, accountId)

  if (candidateKeys.length === 0 && fallbackConfig && fallbackConfig.apiKey) {
    candidateKeys.push({
      id: 'primary-config-key',
      accountId,
      label: 'Primary API Key',
      provider: fallbackConfig.provider,
      model: fallbackConfig.model,
      baseUrl: fallbackConfig.baseUrl,
      apiKey: fallbackConfig.apiKey,
      isPrimary: true,
    })
  }

  if (candidateKeys.length === 0) {
    throw new Error('No active AI API keys configured or all keys are currently cooling down.')
  }

  let lastError: unknown = null
  const attemptedKeyIds = new Set<string>()

  for (let i = 0; i < candidateKeys.length; i++) {
    const key = candidateKeys[i]
    attemptedKeyIds.add(key.id)

    try {
      console.log(`[ai failover] Trying key ${i + 1}/${candidateKeys.length}: ${key.label} (${key.provider}/${key.model})`)
      const result = await operation(key)

      // Record success
      void recordKeyResult(db, key.id, { success: true })
      return result
    } catch (err) {
      lastError = err
      const isRateOrQuota = isRateLimitOrQuotaError(err)
      const isAuth = isAuthError(err)
      const errorMsg = err instanceof Error ? err.message : String(err)

      console.warn(`[ai failover] Key ${key.label} (${key.id}) failed: ${errorMsg}`)
      void recordKeyResult(db, key.id, { success: false, error: err })

      // If it's a rate limit or quota error, or auth error, failover to next key!
      if (isRateOrQuota || isAuth) {
        const remaining = candidateKeys.filter((k) => !attemptedKeyIds.has(k.id))
        if (remaining.length > 0) {
          console.log(`[ai failover] Failover triggered: ${remaining.length} backup key(s) remaining. Advancing...`)
          continue
        }
      } else {
        // For temporary 5xx network errors, retry with next key if available
        const remaining = candidateKeys.filter((k) => !attemptedKeyIds.has(k.id))
        if (remaining.length > 0) {
          console.log(`[ai failover] Temporary error encountered. Attempting failover to next key...`)
          continue
        }
      }

      break
    }
  }

  // If we reach here, all candidates were exhausted
  throw lastError || new Error('All configured AI API keys failed.')
}
