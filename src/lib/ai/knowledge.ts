import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

export interface IngestResult {
  keywordOnly: boolean
  embedError: unknown
}

const CHUNK_DELETE_BATCH = 100

interface MatchRow {
  id: string
  content: string
}

/**
 * (Re)build the chunks for one document. Re-chunks the content and —
 * when the account has an embeddings key — embeds each chunk. Runs under
 * whatever client the caller passes (service-role for ingest routes).
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
): Promise<IngestResult> {
  const chunks = chunkText(content)

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically.
  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey && chunks.length > 0) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks)
    } catch (err) {
      embedError = err
    }
  }

  const { data: previousChunks, error: listErr } = await db
    .from('ai_knowledge_chunks')
    .select('id')
    .eq('document_id', documentId)
  if (listErr) throw listErr

  if (chunks.length > 0) {
    const rows = chunks.map((content, i) => ({
      document_id: documentId,
      account_id: accountId,
      chunk_index: i,
      content,
      embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
    }))
    const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
    if (insErr) throw insErr
  }

  const previousIds = (previousChunks ?? []).map((row: { id: string }) => row.id)
  for (let i = 0; i < previousIds.length; i += CHUNK_DELETE_BATCH) {
    const { error: delErr } = await db
      .from('ai_knowledge_chunks')
      .delete()
      .in('id', previousIds.slice(i, i + CHUNK_DELETE_BATCH))
    if (delErr) throw delErr
  }

  return { keywordOnly: embedError !== null, embedError }
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`.
 *
 * Semantic-primary when an embeddings key is configured (embed the
 * query → cosine-nearest chunks), then topped up with lexical full-text
 * and keyword/substring matches to fill `k`.
 *
 * For compact knowledge bases (<= 15 chunks total, ~15k chars),
 * returns all account chunks directly, ensuring 100% recall for complete
 * service lists, business rules, and owner details without premature truncation.
 *
 * Best-effort: any failure degrades gracefully and never throws.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 8,
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []

  // Check how many chunks this account has
  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (error || !count) return []
  } catch {
    return []
  }

  const picked = new Map<string, string>() // id → content, preserves order

  // Semantic path (if embeddings configured).
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) {
            if (row && row.content) picked.set(row.id, row.content)
          }
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  // Lexical full-text search top-up.
  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (row && row.content && !picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  // Fallback top-up: when semantic + FTS yield fewer than k matches (e.g. strict
  // plainto_tsquery AND logic failed on Bengali/multilingual phrasing, numbers like "15",
  // or compact KBs), top up from the account's knowledge chunks so critical business
  // rules and service menus are never lost.
  if (picked.size < k) {
    try {
      // 1. First try keyword / ilike match on significant words
      const cleanWords = query
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 2)

      for (const word of cleanWords.slice(0, 3)) {
        if (picked.size >= k) break
        const { data: kwMatches } = await db
          .from('ai_knowledge_chunks')
          .select('id, content')
          .eq('account_id', accountId)
          .ilike('content', `%${word}%`)
          .limit(k - picked.size)

        if (Array.isArray(kwMatches)) {
          for (const row of kwMatches as MatchRow[]) {
            if (picked.size >= k) break
            if (row && row.content && !picked.has(row.id)) picked.set(row.id, row.content)
          }
        }
      }

      // 2. If still empty or for compact KBs, fill remaining slots with account chunks
      if (picked.size < k) {
        const queryBuilder = db
          .from('ai_knowledge_chunks')
          .select('id, content')
          .eq('account_id', accountId)

        interface QueryWithOptionalLimit {
          limit?: (count: number) => Promise<{ data: MatchRow[] | null }>
        }
        const builder = queryBuilder as unknown as QueryWithOptionalLimit
        const { data: fallbackChunks } = typeof builder.limit === 'function'
          ? await builder.limit(k - picked.size)
          : await (queryBuilder as unknown as Promise<{ data: MatchRow[] | null }>)

        if (Array.isArray(fallbackChunks)) {
          for (const row of fallbackChunks as MatchRow[]) {
            if (picked.size >= k) break
            if (row && row.content && !picked.has(row.id)) picked.set(row.id, row.content)
          }
        }
      }
    } catch (err) {
      console.warn('[ai knowledge] fallback top-up failed:', err)
    }
  }

  return Array.from(picked.values()).slice(0, k)
}
