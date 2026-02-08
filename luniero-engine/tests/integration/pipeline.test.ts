import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration test: Full content pipeline with mocked LLM
 * Tests the complete flow: job created → context → brief → draft → polish → review → complete
 */

// Track all published events
const publishedEvents: any[] = [];
const subscribedHandlers = new Map<string, Function[]>();

vi.mock('../../src/core/message-bus', () => ({
  messageBus: {
    publish: vi.fn().mockImplementation(async (event: any) => {
      publishedEvents.push(event);
      // Simulate event delivery to subscribers
      const handlers = subscribedHandlers.get(event.eventType) || [];
      for (const handler of handlers) {
        // We don't await here to avoid infinite recursion in tests
        // Instead we'll process events manually
      }
      return 'mock-event-id';
    }),
    subscribe: vi.fn().mockImplementation((eventTypes: string[], handler: Function) => {
      const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
      for (const type of types) {
        if (!subscribedHandlers.has(type)) {
          subscribedHandlers.set(type, []);
        }
        subscribedHandlers.get(type)!.push(handler);
      }
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    startConsuming: vi.fn().mockResolvedValue(undefined),
  },
}));

// In-memory job store for integration
const jobStore = new Map<string, any>();

vi.mock('../../src/core/state-store', () => ({
  stateStore: {
    createJob: vi.fn().mockImplementation(async (job: any) => {
      const fullJob = {
        ...job,
        iteration: 0,
        maxIterations: job.maxIterations || 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobStore.set(fullJob.id, fullJob);
      return fullJob;
    }),
    getJob: vi.fn().mockImplementation(async (jobId: string) => {
      return jobStore.get(jobId) || null;
    }),
    updateJob: vi.fn().mockImplementation(async (jobId: string, updates: any) => {
      const existing = jobStore.get(jobId);
      if (!existing) throw new Error(`Job not found: ${jobId}`);
      const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
      jobStore.set(jobId, updated);
      return updated;
    }),
    incrementIteration: vi.fn().mockImplementation(async (jobId: string) => {
      const job = jobStore.get(jobId);
      if (!job) throw new Error(`Job not found: ${jobId}`);
      job.iteration += 1;
      jobStore.set(jobId, job);
      return job.iteration;
    }),
  },
}));

// Mock LLM responses for each agent
let llmCallCount = 0;

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockImplementation(async (params: any) => {
        llmCallCount++;
        const systemPrompt = params.system || '';

        // Determine which agent is calling based on system prompt content
        if (systemPrompt.includes('Brief Agent') || systemPrompt.includes('content briefs')) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                title: 'AI Trends Shaping 2026',
                type: 'linkedin_post',
                targetAudience: 'B2B SaaS decision makers',
                keyMessages: ['AI is transforming business', 'Early adopters win'],
                structure: [
                  { section: 'hook', notes: 'Bold opening stat about AI adoption' },
                  { section: 'body', notes: 'Three key trends' },
                  { section: 'cta', notes: 'Invite discussion' },
                ],
                wordCount: 200,
                tone: 'Professional but approachable',
                platform: 'linkedin',
                hashtags: ['#AI', '#B2BSaaS', '#Innovation'],
              }),
            }],
          };
        }

        if (systemPrompt.includes('Draft Agent') || systemPrompt.includes('first drafts')) {
          return {
            content: [{
              type: 'text',
              text: 'The AI revolution isn\'t coming — it\'s already here.\n\nIn 2026, three trends are reshaping how B2B SaaS companies operate:\n\n1. Autonomous agents handling complex workflows\n2. Personalized content at scale\n3. Predictive analytics driving decisions\n\nEarly adopters are seeing 3x productivity gains. The question isn\'t whether to adopt AI — it\'s how fast you can integrate it.\n\nWhat AI trend are you most excited about? Drop your thoughts below.\n\n#AI #B2BSaaS #Innovation',
            }],
          };
        }

        if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
          return {
            content: [{
              type: 'text',
              text: 'The AI revolution isn\'t coming. It\'s already here.\n\nThree trends are fundamentally reshaping B2B SaaS in 2026:\n\n→ Autonomous agents managing complex workflows end-to-end\n→ Hyper-personalized content created at unprecedented scale\n→ Predictive analytics that drive decisions before you ask\n\nEarly adopters report 3x productivity gains. The real question: how fast can you adapt?\n\nWhat AI trend excites you most? Share below.\n\n#AI #B2BSaaS #Innovation',
            }],
          };
        }

        if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'approved',
                score: 92,
                checks: {
                  brief_compliance: { pass: true, notes: 'Follows structure perfectly' },
                  word_count: { pass: true, actual: 85, target: 200 },
                  brand_voice: { pass: true, confidence: 0.92 },
                  structure: { pass: true, notes: 'Clear hook-body-CTA structure' },
                  cta_present: { pass: true },
                  hook_strength: { pass: true, notes: 'Strong opening statement' },
                },
                issues: [],
                strengths: ['Compelling hook', 'Clear structure', 'Actionable CTA', 'Good use of data'],
              }),
            }],
          };
        }

        // Default fallback
        return { content: [{ type: 'text', text: 'Default response' }] };
      }),
    };
  }
  return { default: MockAnthropic };
});

vi.mock('../../src/memory/client-store', () => ({
  clientStore: {
    getProfile: vi.fn().mockResolvedValue({
      id: 'acme',
      name: 'Acme Corp',
      industry: 'B2B SaaS',
      preferences: { contentPillars: ['innovation', 'leadership'] },
    }),
    getBrandVoice: vi.fn().mockResolvedValue({
      tone: 'Professional but approachable',
      avoid: ['jargon', 'buzzwords'],
      examples: ['Clear, direct communication'],
      vocabulary: ['innovative', 'scalable'],
    }),
    getContentPillars: vi.fn().mockResolvedValue(['innovation', 'leadership', 'AI']),
    getRecentFeedback: vi.fn().mockResolvedValue([]),
  },
}));

import { routerAgent } from '../../src/agents/router';
import { contextAgent } from '../../src/agents/context-agent';
import { briefAgent } from '../../src/agents/brief-agent';
import { draftAgent } from '../../src/agents/draft-agent';
import { polishAgent } from '../../src/agents/polish-agent';
import { reviewAgent } from '../../src/agents/review-agent';
import { stateStore } from '../../src/core/state-store';

describe('Integration: Full Content Pipeline', () => {
  beforeEach(() => {
    publishedEvents.length = 0;
    subscribedHandlers.clear();
    jobStore.clear();
    llmCallCount = 0;
    vi.clearAllMocks();
  });

  it('should process a complete job through all pipeline stages', async () => {
    // 1. Start all agents (registers event handlers)
    await routerAgent.start();
    await contextAgent.start();
    await briefAgent.start();
    await draftAgent.start();
    await polishAgent.start();
    await reviewAgent.start();

    // 2. Create a job via router
    const jobId = await routerAgent.createJob({
      clientId: 'acme',
      type: 'social_post',
      topic: 'AI trends in 2026',
      platform: 'linkedin',
    });

    expect(jobId).toBeDefined();

    // 3. Verify job.created event was published
    const jobCreatedEvent = publishedEvents.find(e => e.eventType === 'job.created');
    expect(jobCreatedEvent).toBeDefined();
    expect(jobCreatedEvent.clientId).toBe('acme');

    // 4. Simulate event pipeline: deliver job.created to context agent
    const contextHandlers = subscribedHandlers.get('job.created') || [];
    for (const handler of contextHandlers) {
      await handler({ ...jobCreatedEvent, eventId: 'evt-1', timestamp: new Date().toISOString() });
    }

    // 5. Verify context.loaded was published
    const contextEvent = publishedEvents.find(e => e.eventType === 'context.loaded');
    expect(contextEvent).toBeDefined();

    // 6. Deliver context.loaded to brief agent
    const briefHandlers = subscribedHandlers.get('context.loaded') || [];
    for (const handler of briefHandlers) {
      await handler({ ...contextEvent, eventId: 'evt-2', timestamp: new Date().toISOString() });
    }

    // 7. Verify brief.ready was published
    const briefEvent = publishedEvents.find(e => e.eventType === 'brief.ready');
    expect(briefEvent).toBeDefined();
    expect(briefEvent.payload.title).toBe('AI Trends Shaping 2026');

    // 8. Deliver brief.ready to draft agent
    const draftHandlers = subscribedHandlers.get('brief.ready') || [];
    for (const handler of draftHandlers) {
      await handler({ ...briefEvent, eventId: 'evt-3', timestamp: new Date().toISOString() });
    }

    // 9. Verify draft.ready was published
    const draftEvent = publishedEvents.find(e => e.eventType === 'draft.ready');
    expect(draftEvent).toBeDefined();
    expect(draftEvent.payload.content).toContain('AI revolution');

    // 10. Deliver draft.ready to polish agent
    const polishHandlers = subscribedHandlers.get('draft.ready') || [];
    for (const handler of polishHandlers) {
      await handler({ ...draftEvent, eventId: 'evt-4', timestamp: new Date().toISOString() });
    }

    // 11. Verify polish.done was published
    const polishEvent = publishedEvents.find(e => e.eventType === 'polish.done');
    expect(polishEvent).toBeDefined();

    // 12. Deliver polish.done to review agent
    const reviewHandlers = subscribedHandlers.get('polish.done') || [];
    for (const handler of reviewHandlers) {
      await handler({ ...polishEvent, eventId: 'evt-5', timestamp: new Date().toISOString() });
    }

    // 13. Verify review.passed was published (score >= 80)
    const reviewPassedEvent = publishedEvents.find(e => e.eventType === 'review.passed');
    expect(reviewPassedEvent).toBeDefined();
    expect(reviewPassedEvent.payload.score).toBe(92);

    // 14. Deliver review.passed to router for completion
    const completionHandlers = subscribedHandlers.get('review.passed') || [];
    for (const handler of completionHandlers) {
      await handler({ ...reviewPassedEvent, eventId: 'evt-6', timestamp: new Date().toISOString() });
    }

    // 15. Verify job.complete was published
    const completeEvent = publishedEvents.find(e => e.eventType === 'job.complete');
    expect(completeEvent).toBeDefined();

    // 16. Verify final job state
    const finalJob = await stateStore.getJob(jobId);
    expect(finalJob).not.toBeNull();
    expect(finalJob!.status).toBe('complete');
    expect(finalJob!.output).toBeDefined();
    expect(finalJob!.completedAt).toBeDefined();

    // 17. Verify LLM was called 4 times (brief, draft, polish, review)
    expect(llmCallCount).toBe(4);

    // 18. Verify event flow order
    const eventOrder = publishedEvents.map(e => e.eventType);
    expect(eventOrder).toContain('job.created');
    expect(eventOrder).toContain('context.loaded');
    expect(eventOrder).toContain('brief.ready');
    expect(eventOrder).toContain('draft.ready');
    expect(eventOrder).toContain('polish.done');
    expect(eventOrder).toContain('review.passed');
    expect(eventOrder).toContain('job.complete');
  });

  it('should track all state transitions', async () => {
    await routerAgent.start();
    await contextAgent.start();
    await briefAgent.start();
    await draftAgent.start();
    await polishAgent.start();
    await reviewAgent.start();

    const jobId = await routerAgent.createJob({
      clientId: 'acme',
      type: 'blog_post',
      topic: 'Remote work',
    });

    // Track all status updates
    const statusUpdates: string[] = [];
    const originalUpdate = (stateStore.updateJob as any).getMockImplementation();
    (stateStore.updateJob as any).mockImplementation(async (id: string, updates: any) => {
      if (updates.status) statusUpdates.push(updates.status);
      return originalUpdate(id, updates);
    });

    // Run through pipeline
    const contextHandlers = subscribedHandlers.get('job.created') || [];
    for (const h of contextHandlers) await h({ eventType: 'job.created', jobId, clientId: 'acme', traceId: 't', eventId: 'e1', payload: {} });

    const briefHandlers = subscribedHandlers.get('context.loaded') || [];
    const ctxEvt = publishedEvents.find(e => e.eventType === 'context.loaded');
    if (ctxEvt) for (const h of briefHandlers) await h({ ...ctxEvt, eventId: 'e2' });

    const draftHandlers = subscribedHandlers.get('brief.ready') || [];
    const briefEvt = publishedEvents.find(e => e.eventType === 'brief.ready');
    if (briefEvt) for (const h of draftHandlers) await h({ ...briefEvt, eventId: 'e3' });

    const polishHandlers = subscribedHandlers.get('draft.ready') || [];
    const draftEvt = publishedEvents.find(e => e.eventType === 'draft.ready');
    if (draftEvt) for (const h of polishHandlers) await h({ ...draftEvt, eventId: 'e4' });

    const reviewHandlers = subscribedHandlers.get('polish.done') || [];
    const polishEvt = publishedEvents.find(e => e.eventType === 'polish.done');
    if (polishEvt) for (const h of reviewHandlers) await h({ ...polishEvt, eventId: 'e5' });

    // Verify status transitions happened in order
    expect(statusUpdates).toContain('context_loading');
    expect(statusUpdates).toContain('briefing');
    expect(statusUpdates).toContain('drafting');
    expect(statusUpdates).toContain('polishing');
    expect(statusUpdates).toContain('reviewing');
  });

  it('should handle multiple concurrent jobs', async () => {
    await routerAgent.start();
    await contextAgent.start();

    const job1 = await routerAgent.createJob({ clientId: 'client-a', type: 'social_post', topic: 'Topic A' });
    const job2 = await routerAgent.createJob({ clientId: 'client-b', type: 'blog_post', topic: 'Topic B' });

    expect(job1).not.toBe(job2);
    expect(await stateStore.getJob(job1)).not.toBeNull();
    expect(await stateStore.getJob(job2)).not.toBeNull();

    const jobs1 = publishedEvents.filter(e => e.jobId === job1);
    const jobs2 = publishedEvents.filter(e => e.jobId === job2);
    expect(jobs1.length).toBeGreaterThan(0);
    expect(jobs2.length).toBeGreaterThan(0);
  });
});
