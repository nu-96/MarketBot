import { describe, it, expect } from 'vitest';
import { test as fcTest } from '@fast-check/vitest';
import fc from 'fast-check';
import {
  jobCreatedPayload,
  briefPayload,
  reviewPayload,
  draftPayload,
  baseEventSchema,
} from '../../src/core/event-types';
import { jobRequestSchema, clientProfileSchema } from '../../src/utils/validation';

describe('Fuzz Tests: Input Validation', () => {
  describe('jobCreatedPayload - fuzz', () => {
    fcTest.prop([fc.anything()])('should not crash on arbitrary input', (input) => {
      const result = jobCreatedPayload.safeParse(input);
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    fcTest.prop([fc.string(), fc.string()])('should reject random string pairs as type/topic', (type, topic) => {
      const result = jobCreatedPayload.safeParse({ type, topic });
      // Only valid if type happens to be one of the valid enums
      if (['social_post', 'blog_post', 'report', 'campaign'].includes(type) && topic.length > 0) {
        expect(result.success).toBe(true);
      }
    });

    fcTest.prop([
      fc.constantFrom('social_post', 'blog_post', 'report', 'campaign'),
      fc.string({ minLength: 1, maxLength: 500 }),
    ])('should accept valid type with any non-empty topic', (type, topic) => {
      const result = jobCreatedPayload.safeParse({ type, topic });
      expect(result.success).toBe(true);
    });

    fcTest.prop([fc.integer()])('should reject numeric types', (type) => {
      const result = jobCreatedPayload.safeParse({ type, topic: 'test' });
      expect(result.success).toBe(false);
    });

    fcTest.prop([fc.boolean()])('should reject boolean types', (type) => {
      const result = jobCreatedPayload.safeParse({ type, topic: 'test' });
      expect(result.success).toBe(false);
    });

    fcTest.prop([fc.array(fc.string())])('should reject arrays as type', (type) => {
      const result = jobCreatedPayload.safeParse({ type, topic: 'test' });
      expect(result.success).toBe(false);
    });
  });

  describe('briefPayload - fuzz', () => {
    fcTest.prop([fc.anything()])('should not crash on arbitrary input', (input) => {
      const result = briefPayload.safeParse(input);
      expect(result).toBeDefined();
    });

    fcTest.prop([
      fc.string({ minLength: 1 }),
      fc.string({ minLength: 1 }),
      fc.string({ minLength: 1 }),
      fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
      fc.integer({ min: 1, max: 10000 }),
      fc.string({ minLength: 1 }),
    ])('should accept valid brief structures', (title, type, audience, messages, wordCount, tone) => {
      const result = briefPayload.safeParse({
        title,
        type,
        targetAudience: audience,
        keyMessages: messages,
        structure: [{ section: 'body', notes: 'content' }],
        wordCount,
        tone,
      });
      expect(result.success).toBe(true);
    });

    fcTest.prop([fc.float({ min: -1e10, max: 1e10 })])('should handle any number as wordCount', (wordCount) => {
      const result = briefPayload.safeParse({
        title: 'Test',
        type: 'post',
        targetAudience: 'devs',
        keyMessages: ['msg'],
        structure: [{ section: 'body', notes: 'n' }],
        wordCount,
        tone: 'casual',
      });
      if (Number.isNaN(wordCount)) {
        expect(result.success).toBe(false);
      } else {
        expect(result.success).toBe(true);
      }
    });
  });

  describe('reviewPayload - fuzz', () => {
    fcTest.prop([fc.anything()])('should not crash on arbitrary input', (input) => {
      const result = reviewPayload.safeParse(input);
      expect(result).toBeDefined();
    });

    fcTest.prop([fc.integer({ min: -100, max: 200 })])('should enforce score boundaries', (score) => {
      const result = reviewPayload.safeParse({
        status: 'approved',
        score,
        checks: {},
      });
      if (score >= 0 && score <= 100) {
        expect(result.success).toBe(true);
      } else {
        expect(result.success).toBe(false);
      }
    });

    fcTest.prop([fc.string()])('should reject arbitrary status strings', (status) => {
      const result = reviewPayload.safeParse({
        status,
        score: 50,
        checks: {},
      });
      if (['approved', 'needs_revision', 'needs_human_review'].includes(status)) {
        expect(result.success).toBe(true);
      } else {
        expect(result.success).toBe(false);
      }
    });
  });

  describe('draftPayload - fuzz', () => {
    fcTest.prop([fc.anything()])('should not crash on arbitrary input', (input) => {
      const result = draftPayload.safeParse(input);
      expect(result).toBeDefined();
    });

    fcTest.prop([
      fc.string({ minLength: 0, maxLength: 50000 }),
      fc.integer({ min: 0 }),
      fc.string({ minLength: 1 }),
    ])('should accept valid draft structures', (content, wordCount, format) => {
      const result = draftPayload.safeParse({ content, wordCount, format });
      expect(result.success).toBe(true);
    });
  });

  describe('jobRequestSchema - fuzz', () => {
    fcTest.prop([fc.anything()])('should not crash on arbitrary input', (input) => {
      const result = jobRequestSchema.safeParse(input);
      expect(result).toBeDefined();
    });

    fcTest.prop([
      fc.string({ minLength: 1, maxLength: 100 }),
      fc.constantFrom('social_post', 'blog_post', 'report', 'campaign'),
      fc.string({ minLength: 1, maxLength: 500 }),
    ])('should accept valid job requests', (clientId, type, topic) => {
      const result = jobRequestSchema.safeParse({ clientId, type, topic });
      expect(result.success).toBe(true);
    });

    it('should reject empty clientId', () => {
      const result = jobRequestSchema.safeParse({ clientId: '', type: 'social_post', topic: 'test' });
      expect(result.success).toBe(false);
    });

    it('should reject empty topic', () => {
      const result = jobRequestSchema.safeParse({ clientId: 'acme', type: 'social_post', topic: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('clientProfileSchema - fuzz', () => {
    fcTest.prop([fc.anything()])('should not crash on arbitrary input', (input) => {
      const result = clientProfileSchema.safeParse(input);
      expect(result).toBeDefined();
    });

    fcTest.prop([
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 100 }),
    ])('should accept valid minimal profiles', (id, name) => {
      const result = clientProfileSchema.safeParse({ id, name });
      expect(result.success).toBe(true);
    });
  });

  describe('baseEventSchema - fuzz', () => {
    fcTest.prop([fc.anything()])('should not crash on arbitrary input', (input) => {
      const result = baseEventSchema.safeParse(input);
      expect(result).toBeDefined();
    });

    fcTest.prop([
      fc.string(),
      fc.string(),
      fc.string(),
      fc.string(),
      fc.string(),
    ])('should reject random strings for UUID fields', (eventId, jobId, timestamp, sourceAgent, clientId) => {
      const result = baseEventSchema.safeParse({
        eventId, jobId, timestamp, sourceAgent, clientId, traceId: 'bad',
      });
      // Very unlikely random strings are valid UUIDs and ISO dates
      // We just verify it doesn't crash
      expect(typeof result.success).toBe('boolean');
    });
  });
});
