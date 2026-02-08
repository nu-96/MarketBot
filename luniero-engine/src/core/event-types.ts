import { z } from 'zod';

// Base event schema
export const baseEventSchema = z.object({
  eventId: z.string().uuid(),
  jobId: z.string(),
  timestamp: z.string().datetime(),
  sourceAgent: z.string(),
  targetAgents: z.array(z.string()).optional(),
  clientId: z.string(),
  traceId: z.string().uuid(),
  parentEventId: z.string().uuid().optional(),
});

// Event types
export const eventTypes = {
  JOB_CREATED: 'job.created',
  CONTEXT_LOADED: 'context.loaded',
  RESEARCH_DONE: 'research.done',
  BRIEF_READY: 'brief.ready',
  BRIEF_APPROVED: 'brief.approved',
  DRAFT_READY: 'draft.ready',
  POLISH_DONE: 'polish.done',
  REVIEW_PASSED: 'review.passed',
  REVIEW_FAILED: 'review.failed',
  REVISION_REQUESTED: 'revision.requested',
  JOB_COMPLETE: 'job.complete',
  AGENT_ERROR: 'agent.error',
} as const;

export type EventType = typeof eventTypes[keyof typeof eventTypes];

// Payload schemas for each event type
export const jobCreatedPayload = z.object({
  type: z.enum(['social_post', 'blog_post', 'report', 'campaign']),
  platform: z.enum(['linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'all']).optional(),
  topic: z.string(),
  instructions: z.string().optional(),
});

export const contextPayload = z.object({
  brandVoice: z.object({
    tone: z.string(),
    avoid: z.array(z.string()),
    examples: z.array(z.string()),
  }),
  contentPillars: z.array(z.string()),
  preferences: z.record(z.string(), z.any()),
});

export const briefPayload = z.object({
  title: z.string(),
  type: z.string(),
  targetAudience: z.string(),
  keyMessages: z.array(z.string()),
  structure: z.array(z.object({
    section: z.string(),
    notes: z.string(),
  })),
  wordCount: z.number(),
  tone: z.string(),
  seo: z.object({
    primaryKeyword: z.string(),
    secondaryKeywords: z.array(z.string()),
  }).optional(),
});

export const draftPayload = z.object({
  content: z.string(),
  wordCount: z.number(),
  format: z.string(),
});

export const reviewPayload = z.object({
  status: z.enum(['approved', 'needs_revision', 'needs_human_review']),
  score: z.number().min(0).max(100),
  checks: z.record(z.string(), z.object({
    pass: z.boolean(),
    notes: z.string().optional(),
  })),
  revisionRequests: z.array(z.string()).optional(),
});

// Full event schema
export const agentEventSchema = baseEventSchema.extend({
  eventType: z.string(),
  payload: z.any(),
});

export type AgentEvent = z.infer<typeof agentEventSchema>;
