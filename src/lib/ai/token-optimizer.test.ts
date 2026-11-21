import { describe, expect, it, beforeEach } from 'vitest';
import {
  isSimpleGreetingOrPleasantry,
  pruneConversationContext,
  truncateKnowledgeChunk,
  getCachedKnowledge,
  setCachedKnowledge,
  clearKnowledgeCache,
  isDuplicateInbound,
} from './token-optimizer';

describe('Token Optimizer', () => {
  beforeEach(() => {
    clearKnowledgeCache();
  });

  describe('isSimpleGreetingOrPleasantry', () => {
    it('detects simple English greetings', () => {
      expect(isSimpleGreetingOrPleasantry('Hi')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('hello!')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('Hey there')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('Good morning')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('thank you')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('ok')).toBe(true);
    });

    it('detects simple Bengali greetings', () => {
      expect(isSimpleGreetingOrPleasantry('হাই')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('হ্যালো')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('নমস্কার')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('ধন্যবাদ')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('ঠিক আছে')).toBe(true);
    });

    it('detects Hindi/Urdu greetings', () => {
      expect(isSimpleGreetingOrPleasantry('नमस्ते')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('salam')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('assalamu alaikum')).toBe(true);
      expect(isSimpleGreetingOrPleasantry('theek hai')).toBe(true);
    });

    it('rejects messages that contain inquiries or question marks', () => {
      expect(isSimpleGreetingOrPleasantry('Hi, what is the price of passport?')).toBe(false);
      expect(isSimpleGreetingOrPleasantry('প্যান কার্ড এর খরচ কত?')).toBe(false);
      expect(isSimpleGreetingOrPleasantry('Where is your office?')).toBe(false);
      expect(isSimpleGreetingOrPleasantry('fees kitna hai?')).toBe(false);
    });
  });

  describe('pruneConversationContext', () => {
    it('bounds history to maxTurns', () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Message ${i + 1}`,
      }));

      const pruned = pruneConversationContext(messages, { maxTurns: 6 });
      expect(pruned.length).toBe(6);
      expect(pruned[pruned.length - 1].content).toBe('Message 15');
    });

    it('trims oversized context while keeping latest message', () => {
      const longText = 'A'.repeat(800);
      const messages = [
        { role: 'user' as const, content: longText },
        { role: 'assistant' as const, content: longText },
        { role: 'user' as const, content: 'Latest short inquiry' },
      ];

      const pruned = pruneConversationContext(messages, { maxTurns: 6, maxTotalChars: 1000 });
      expect(pruned[pruned.length - 1].content).toBe('Latest short inquiry');
      expect(pruned.length).toBeLessThan(3);
    });
  });

  describe('truncateKnowledgeChunk', () => {
    it('leaves short chunks intact', () => {
      const short = 'Passport fees: $50.';
      expect(truncateKnowledgeChunk(short, 100)).toBe(short);
    });

    it('cleanly truncates long chunks', () => {
      const long = 'Sentence one. Sentence two. ' + 'X'.repeat(500);
      const res = truncateKnowledgeChunk(long, 50);
      expect(res.length).toBeLessThanOrEqual(55);
    });
  });

  describe('knowledge cache', () => {
    it('stores and retrieves cached knowledge', () => {
      expect(getCachedKnowledge('acct-1', 'pan card')).toBeNull();
      setCachedKnowledge('acct-1', 'pan card', ['Fee is Rs 107']);
      expect(getCachedKnowledge('acct-1', 'pan card')).toEqual(['Fee is Rs 107']);
    });
  });

  describe('isDuplicateInbound', () => {
    it('detects rapid duplicate message to same conversation', () => {
      expect(isDuplicateInbound('conv-1', 'Hi')).toBe(false);
      expect(isDuplicateInbound('conv-1', 'Hi')).toBe(true);
      expect(isDuplicateInbound('conv-2', 'Hi')).toBe(false);
    });
  });
});
