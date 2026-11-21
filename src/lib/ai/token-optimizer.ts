import type { ChatMessage } from './types';
import type { DetectionResult } from './auto-detect';

// ============================================================
// Smart Token Optimization Engine for WhatsApp CRM AI Assistant
//
// 1. Simple greeting detection: skips heavy knowledge base retrieval
//    and long prompts for trivial greetings, saving ~1,000+ input tokens.
// 2. Context window pruning: keeps recent high-signal conversational turns
//    within a strict character/token budget instead of 20 old messages.
// 3. Knowledge base excerpt bounding: limits chunks to top 2-3 and caps
//    character length per chunk.
// 4. In-memory Knowledge and Model Detection caches with TTL.
// 5. Inbound duplicate request debounce to prevent repeated LLM calls.
// ============================================================

const GREETING_TOKENS = new Set([
  // English
  'hi',
  'hello',
  'hey',
  'hiya',
  'heya',
  'there',
  'hey there',
  'hi there',
  'hello there',
  'good morning',
  'good afternoon',
  'good evening',
  'good day',
  'how are you',
  'how r u',
  'thanks',
  'thank you',
  'thx',
  'ty',
  'ok',
  'okay',
  'k',
  'bye',
  'goodbye',
  'cya',
  // Bengali
  'হাই',
  'হ্যালো',
  'নমস্কার',
  'নমস্তে',
  'আদাব',
  'সালাম',
  'ধন্যবাদ',
  'থ্যাঙ্কস',
  'থ্যাংকস',
  'কেমন আছেন',
  'কেমন আছো',
  'ঠিক আছে',
  'আচ্ছা',
  'বাই',
  // Hindi / Urdu / Arabic
  'नमस्ते',
  'नमस्कार',
  'प्रणाम',
  'राम राम',
  'शुक्रिया',
  'धन्यवाद',
  'अलविदा',
  'assalamu alaikum',
  'as-salamu alaykum',
  'salam',
  'shukran',
  'kya haal hai',
  'theek hai',
  'accha',
]);

const INQUIRY_INDICATORS = [
  '?',
  'দাম',
  'কত',
  'খরচ',
  'ফি',
  'কীভাবে',
  'কিভাবে',
  'পদ্ধতি',
  'কাগজ',
  'ডকুমেন্ট',
  'সার্ভিস',
  'সেবা',
  'লোকেশন',
  'ঠিকানা',
  'ফোন',
  'নম্বর',
  'price',
  'cost',
  'fee',
  'fees',
  'charge',
  'charges',
  'how',
  'what',
  'when',
  'where',
  'who',
  'which',
  'why',
  'service',
  'services',
  'document',
  'documents',
  'require',
  'required',
  'location',
  'address',
  'contact',
  'timing',
  'hours',
  'open',
  'rate',
  'rates',
  'kitna',
  'kya',
  'kaise',
  'kab',
  'kahan',
];

/**
 * Check if the inbound message is purely a greeting or polite acknowledgement.
 * If true, Knowledge Base retrieval can be bypassed to save thousands of tokens.
 */
export function isSimpleGreetingOrPleasantry(rawText: string): boolean {
  if (!rawText) return false;
  const text = rawText.trim().toLowerCase();
  if (text.length === 0 || text.length > 50) return false;

  // If message contains question marks or inquiry keywords, it's not a simple greeting
  for (const indicator of INQUIRY_INDICATORS) {
    if (text.includes(indicator)) return false;
  }

  // Strip punctuation and emojis while preserving Indic matras / combining marks (\p{M})
  const clean = text
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!clean) return false;
  if (GREETING_TOKENS.has(clean)) return true;

  // Check 1-3 word combinations
  const words = clean.split(' ');
  if (words.length <= 3 && words.every((w) => GREETING_TOKENS.has(w))) {
    return true;
  }

  return false;
}

/**
 * Prune conversation history to fit a target turn count and character/token budget.
 * Always preserves the latest customer message.
 */
export function pruneConversationContext(
  messages: ChatMessage[],
  opts: { maxTurns?: number; maxTotalChars?: number } = {}
): ChatMessage[] {
  const maxTurns = opts.maxTurns ?? 6;
  const maxTotalChars = opts.maxTotalChars ?? 1500;

  if (!messages || messages.length === 0) return [];

  // Take the most recent turns
  let slice = messages.slice(-maxTurns);

  // Calculate total characters
  let totalChars = slice.reduce((acc, m) => acc + m.content.length, 0);

  // If over budget, drop oldest turns until within budget (keeping at least the last 1-2 turns)
  while (slice.length > 2 && totalChars > maxTotalChars) {
    const dropped = slice.shift();
    if (dropped) totalChars -= dropped.content.length;
  }

  // Deduplicate consecutive identical messages from the same role
  const deduped: ChatMessage[] = [];
  for (const m of slice) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.role === m.role && prev.content === m.content) {
      continue;
    }
    deduped.push(m);
  }

  return deduped;
}

/**
 * Optimized Knowledge retrieval limit — 2 chunks provide high accuracy
 * while using ~60% fewer prompt tokens than 5 chunks.
 */
export function getOptimizedKnowledgeLimit(requested = 5): number {
  return Math.max(1, Math.min(requested, 2));
}

/**
 * Truncate long knowledge chunks to prevent runaway prompt tokens.
 */
export function truncateKnowledgeChunk(chunk: string, maxChars = 550): string {
  const text = chunk.trim();
  if (text.length <= maxChars) return text;

  // Cut cleanly at last sentence or newline before maxChars
  const sub = text.slice(0, maxChars);
  const lastBreak = Math.max(sub.lastIndexOf('\n'), sub.lastIndexOf('. '));
  if (lastBreak > maxChars * 0.6) {
    return sub.slice(0, lastBreak + 1).trim();
  }
  return `${sub.trim()}...`;
}

// ============================================================
// In-Memory Caches for Knowledge & Model Detections (with TTL)
// ============================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const KNOWLEDGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DETECTION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const INBOUND_DEBOUNCE_TTL_MS = 6 * 1000; // 6 seconds

const knowledgeCache = new Map<string, CacheEntry<string[]>>();
const detectionCache = new Map<string, CacheEntry<DetectionResult>>();
const inboundDebounceCache = new Map<string, number>();

function cleanExpired<T>(cache: Map<string, CacheEntry<T>>) {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

export function getCachedKnowledge(accountId: string, query: string): string[] | null {
  cleanExpired(knowledgeCache);
  const key = `${accountId}:${query.trim().toLowerCase()}`;
  const entry = knowledgeCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value;
  }
  return null;
}

export function setCachedKnowledge(accountId: string, query: string, chunks: string[]): void {
  const key = `${accountId}:${query.trim().toLowerCase()}`;
  knowledgeCache.set(key, {
    value: chunks,
    expiresAt: Date.now() + KNOWLEDGE_CACHE_TTL_MS,
  });
}

export function clearKnowledgeCache(): void {
  knowledgeCache.clear();
}

export function getCachedDetection(cacheKey: string): DetectionResult | null {
  cleanExpired(detectionCache);
  const entry = detectionCache.get(cacheKey);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value;
  }
  return null;
}

export function setCachedDetection(cacheKey: string, result: DetectionResult): void {
  detectionCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + DETECTION_CACHE_TTL_MS,
  });
}

export function clearDetectionCache(): void {
  detectionCache.clear();
}

/**
 * Check if the customer sent the exact same message to this conversation
 * within the last 6 seconds (Meta webhook duplicate retry or rapid spam).
 */
export function isDuplicateInbound(conversationId: string, text: string): boolean {
  const key = `${conversationId}:${text.trim()}`;
  const now = Date.now();
  const lastTime = inboundDebounceCache.get(key);

  if (lastTime && now - lastTime < INBOUND_DEBOUNCE_TTL_MS) {
    return true;
  }

  inboundDebounceCache.set(key, now);
  // Clean old entries if cache grows
  if (inboundDebounceCache.size > 200) {
    for (const [k, time] of inboundDebounceCache.entries()) {
      if (now - time > INBOUND_DEBOUNCE_TTL_MS) inboundDebounceCache.delete(k);
    }
  }
  return false;
}
