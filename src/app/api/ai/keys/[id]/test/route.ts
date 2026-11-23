import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { revealKeyPlaintext, listAccountAiKeys } from '@/lib/ai/key-manager'
import { validateAiCredentials } from '@/lib/ai/validate'
import type { AiConfig } from '@/lib/ai/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/ai/keys/[id]/test  (admin+)
 * Test a specific stored key connection.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-key-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Key ID required' }, { status: 400 })

    const allKeys = await listAccountAiKeys(supabase, accountId)
    const keyItem = allKeys.find((k) => k.id === id)
    if (!keyItem) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 })
    }

    const plainKey = await revealKeyPlaintext(supabase, accountId, id)

    const testConfig: AiConfig = {
      provider: keyItem.provider,
      model: keyItem.model,
      baseUrl: keyItem.baseUrl,
      apiKey: plainKey,
      systemPrompt: null,
      isActive: true,
      autoReplyEnabled: true,
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
      embeddingsApiKey: null,
    }

    await validateAiCredentials(testConfig)

    // Update last_tested_at on key
    if (id !== 'primary-config-key') {
      try {
        await supabase
          .from('ai_keys')
          .update({
            last_tested_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', id)
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ ok: true, message: `Key verified successfully! (${keyItem.model})` })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection test failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
