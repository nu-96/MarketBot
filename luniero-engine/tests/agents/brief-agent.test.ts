import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/core/message-bus', () => ({
  messageBus: {
    publish: vi.fn().mockResolvedValue('event-id'),
    subscribe: vi.fn(),
  },
}));

vi.mock('../../src/core/state-store', () => ({
  stateStore: {
    getJob: vi.fn(),
    updateJob: vi.fn().mockImplementation(async (id: string, updates: any) => ({
      id, ...updates,
    })),
  },
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            title: 'AI Trends 2026',
            type: 'linkedin_post',
            targetAudience: 'Tech professionals',
            keyMessages: ['AI is evolving', 'Adapt or fall behind'],
            structure: [
              { section: 'hook', notes: 'Start with a bold stat' },
              { section: 'body', notes: 'Three key trends' },
              { section: 'cta', notes: 'Follow for more insights' },
            ],
            wordCount: 200,
            tone: 'Professional but approachable',
            platform: 'linkedin',
          }),
        }],
      }),
    };
  }
  return { default: MockAnthropic };
});

import { briefAgent } from '../../src/agents/brief-agent';
import { messageBus } from '../../src/core/message-bus';
import { stateStore } from '../../src/core/state-store';

describe('BriefAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('should subscribe to context.loaded and research.done', async () => {
      await briefAgent.start();
      expect(messageBus.subscribe).toHaveBeenCalledWith(
        expect.arrayContaining(['context.loaded', 'research.done']),
        expect.any(Function)
      );
    });
  });

  describe('handleEvent', () => {
    const mockEvent = {
      eventType: 'context.loaded',
      jobId: 'job-brief-1',
      clientId: 'acme',
      traceId: 'trace-1',
      eventId: 'evt-1',
      payload: {},
    };

    const mockJob = {
      id: 'job-brief-1',
      input: { type: 'social_post', topic: 'AI trends', platform: 'linkedin' },
      context: {
        brandVoice: { tone: 'professional', avoid: ['jargon'], examples: [] },
        contentPillars: ['innovation', 'leadership'],
        preferences: {},
      },
    };

    it('should update job status to briefing', async () => {
      await briefAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];

      (stateStore.getJob as any).mockResolvedValue(mockJob);
      await handler(mockEvent);

      expect(stateStore.updateJob).toHaveBeenCalledWith('job-brief-1', expect.objectContaining({
        status: 'briefing',
      }));
    });

    it('should publish brief.ready event with parsed brief', async () => {
      await briefAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];

      (stateStore.getJob as any).mockResolvedValue(mockJob);
      await handler(mockEvent);

      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'brief.ready',
          jobId: 'job-brief-1',
          payload: expect.objectContaining({
            title: 'AI Trends 2026',
            type: 'linkedin_post',
          }),
        })
      );
    });

    it('should save brief to job state', async () => {
      await briefAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];

      (stateStore.getJob as any).mockResolvedValue(mockJob);
      await handler(mockEvent);

      // Second updateJob call should have the brief
      const updateCalls = (stateStore.updateJob as any).mock.calls;
      const briefUpdate = updateCalls.find((c: any) => c[1].brief);
      expect(briefUpdate).toBeDefined();
      expect(briefUpdate[1].brief.title).toBe('AI Trends 2026');
      expect(briefUpdate[1].status).toBe('brief_pending_approval');
    });
  });

  describe('edge cases', () => {
    it('should handle missing context gracefully', async () => {
      await briefAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];

      const jobNoContext = {
        id: 'job-no-ctx',
        input: { type: 'social_post', topic: 'test' },
        context: null,
      };
      (stateStore.getJob as any).mockResolvedValue(jobNoContext);

      // Should not throw even with null context
      await expect(handler({
        ...{ eventType: 'context.loaded', jobId: 'job-no-ctx', clientId: 'c', traceId: 'trace-1', eventId: 'e', payload: {} },
      })).resolves.not.toThrow();
    });
  });
});
