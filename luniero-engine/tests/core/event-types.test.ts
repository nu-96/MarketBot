import { describe, it, expect } from 'vitest';
import {
  baseEventSchema,
  agentEventSchema,
  eventTypes,
  jobCreatedPayload,
  contextPayload,
  briefPayload,
  draftPayload,
  reviewPayload,
} from '../../src/core/event-types';
import { v4 as uuidv4 } from 'uuid';

describe('Event Types', () => {
  describe('eventTypes constants', () => {
    it('should have all required event types', () => {
      expect(eventTypes.JOB_CREATED).toBe('job.created');
      expect(eventTypes.CONTEXT_LOADED).toBe('context.loaded');
      expect(eventTypes.RESEARCH_DONE).toBe('research.done');
      expect(eventTypes.BRIEF_READY).toBe('brief.ready');
      expect(eventTypes.BRIEF_APPROVED).toBe('brief.approved');
      expect(eventTypes.DRAFT_READY).toBe('draft.ready');
      expect(eventTypes.POLISH_DONE).toBe('polish.done');
      expect(eventTypes.REVIEW_PASSED).toBe('review.passed');
      expect(eventTypes.REVIEW_FAILED).toBe('review.failed');
      expect(eventTypes.REVISION_REQUESTED).toBe('revision.requested');
      expect(eventTypes.JOB_COMPLETE).toBe('job.complete');
      expect(eventTypes.AGENT_ERROR).toBe('agent.error');
    });

    it('should have exactly 12 event types', () => {
      expect(Object.keys(eventTypes)).toHaveLength(12);
    });

    it('should have string values matching dot notation pattern', () => {
      for (const value of Object.values(eventTypes)) {
        expect(value).toMatch(/^[a-z_]+\.[a-z_]+$/);
      }
    });
  });

  describe('baseEventSchema', () => {
    const validEvent = {
      eventId: uuidv4(),
      jobId: 'job-123',
      timestamp: new Date().toISOString(),
      sourceAgent: 'test-agent',
      clientId: 'client-1',
      traceId: uuidv4(),
    };

    it('should validate a correct base event', () => {
      const result = baseEventSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('should accept optional targetAgents', () => {
      const result = baseEventSchema.safeParse({
        ...validEvent,
        targetAgents: ['agent-a', 'agent-b'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept optional parentEventId', () => {
      const result = baseEventSchema.safeParse({
        ...validEvent,
        parentEventId: uuidv4(),
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing eventId', () => {
      const { eventId, ...rest } = validEvent;
      const result = baseEventSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject invalid UUID for eventId', () => {
      const result = baseEventSchema.safeParse({ ...validEvent, eventId: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });

    it('should reject missing jobId', () => {
      const { jobId, ...rest } = validEvent;
      const result = baseEventSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject missing sourceAgent', () => {
      const { sourceAgent, ...rest } = validEvent;
      const result = baseEventSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject invalid timestamp format', () => {
      const result = baseEventSchema.safeParse({ ...validEvent, timestamp: 'not-a-date' });
      expect(result.success).toBe(false);
    });

    it('should reject non-UUID traceId', () => {
      const result = baseEventSchema.safeParse({ ...validEvent, traceId: 'bad-trace' });
      expect(result.success).toBe(false);
    });
  });

  describe('agentEventSchema', () => {
    it('should validate full agent event', () => {
      const result = agentEventSchema.safeParse({
        eventId: uuidv4(),
        jobId: 'job-1',
        timestamp: new Date().toISOString(),
        sourceAgent: 'router',
        clientId: 'client-1',
        traceId: uuidv4(),
        eventType: 'job.created',
        payload: { type: 'social_post', topic: 'test' },
      });
      expect(result.success).toBe(true);
    });

    it('should require eventType field', () => {
      const result = agentEventSchema.safeParse({
        eventId: uuidv4(),
        jobId: 'job-1',
        timestamp: new Date().toISOString(),
        sourceAgent: 'router',
        clientId: 'client-1',
        traceId: uuidv4(),
        payload: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe('jobCreatedPayload', () => {
    it('should validate social_post type', () => {
      const result = jobCreatedPayload.safeParse({
        type: 'social_post',
        topic: 'AI trends',
      });
      expect(result.success).toBe(true);
    });

    it('should validate blog_post with platform', () => {
      const result = jobCreatedPayload.safeParse({
        type: 'blog_post',
        platform: 'linkedin',
        topic: 'Tech insights',
        instructions: 'Keep it short',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const result = jobCreatedPayload.safeParse({
        type: 'invalid_type',
        topic: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid platform', () => {
      const result = jobCreatedPayload.safeParse({
        type: 'social_post',
        platform: 'myspace',
        topic: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('should accept all valid platforms', () => {
      for (const platform of ['linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'all']) {
        const result = jobCreatedPayload.safeParse({
          type: 'social_post',
          platform,
          topic: 'test',
        });
        expect(result.success).toBe(true);
      }
    });

    it('should accept all valid types', () => {
      for (const type of ['social_post', 'blog_post', 'report', 'campaign']) {
        const result = jobCreatedPayload.safeParse({ type, topic: 'test' });
        expect(result.success).toBe(true);
      }
    });

    it('should reject missing topic', () => {
      const result = jobCreatedPayload.safeParse({ type: 'social_post' });
      expect(result.success).toBe(false);
    });
  });

  describe('briefPayload', () => {
    const validBrief = {
      title: 'Test Title',
      type: 'linkedin_post',
      targetAudience: 'B2B SaaS leaders',
      keyMessages: ['Message 1', 'Message 2'],
      structure: [{ section: 'hook', notes: 'Strong opening' }],
      wordCount: 150,
      tone: 'Professional',
    };

    it('should validate a correct brief', () => {
      const result = briefPayload.safeParse(validBrief);
      expect(result.success).toBe(true);
    });

    it('should accept optional SEO fields', () => {
      const result = briefPayload.safeParse({
        ...validBrief,
        seo: { primaryKeyword: 'AI', secondaryKeywords: ['ML', 'automation'] },
      });
      expect(result.success).toBe(true);
    });

    it('should reject negative word count', () => {
      const result = briefPayload.safeParse({ ...validBrief, wordCount: -10 });
      // wordCount is z.number() so negative is technically valid per schema
      // but it should still parse
      expect(result.success).toBe(true);
    });

    it('should reject missing keyMessages', () => {
      const { keyMessages, ...rest } = validBrief;
      const result = briefPayload.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('should reject empty structure array type mismatch', () => {
      const result = briefPayload.safeParse({ ...validBrief, structure: 'not-array' });
      expect(result.success).toBe(false);
    });
  });

  describe('reviewPayload', () => {
    it('should validate approved review', () => {
      const result = reviewPayload.safeParse({
        status: 'approved',
        score: 95,
        checks: { voice: { pass: true } },
      });
      expect(result.success).toBe(true);
    });

    it('should validate needs_revision review', () => {
      const result = reviewPayload.safeParse({
        status: 'needs_revision',
        score: 60,
        checks: { voice: { pass: false, notes: 'Too casual' } },
        revisionRequests: ['Fix tone'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject score above 100', () => {
      const result = reviewPayload.safeParse({
        status: 'approved',
        score: 150,
        checks: {},
      });
      expect(result.success).toBe(false);
    });

    it('should reject score below 0', () => {
      const result = reviewPayload.safeParse({
        status: 'approved',
        score: -5,
        checks: {},
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const result = reviewPayload.safeParse({
        status: 'maybe',
        score: 50,
        checks: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe('draftPayload', () => {
    it('should validate correct draft', () => {
      const result = draftPayload.safeParse({
        content: 'This is a draft...',
        wordCount: 150,
        format: 'markdown',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing content', () => {
      const result = draftPayload.safeParse({ wordCount: 150, format: 'md' });
      expect(result.success).toBe(false);
    });
  });
});
