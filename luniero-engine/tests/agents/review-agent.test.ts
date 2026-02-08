import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockLLMResponse = '';

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
    incrementIteration: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockImplementation(async () => ({
        content: [{ type: 'text', text: mockLLMResponse }],
      })),
    };
  }
  return { default: MockAnthropic };
});

import { reviewAgent } from '../../src/agents/review-agent';
import { messageBus } from '../../src/core/message-bus';
import { stateStore } from '../../src/core/state-store';

describe('ReviewAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockJob = {
    id: 'job-review-1',
    polishedDraft: { content: 'Polished content here.' },
    draft: { content: 'Draft content.' },
    brief: {
      title: 'Test',
      type: 'linkedin_post',
      tone: 'professional',
      wordCount: 200,
      keyMessages: ['msg1'],
      structure: [{ section: 'hook', notes: 'test' }],
    },
    context: { brandVoice: { tone: 'professional', avoid: [], examples: [] } },
    iteration: 0,
    maxIterations: 3,
  };

  const mockEvent = {
    eventType: 'polish.done',
    jobId: 'job-review-1',
    clientId: 'acme',
    traceId: 'trace-1',
    eventId: 'evt-1',
    payload: {},
  };

  describe('start', () => {
    it('should subscribe to polish.done events', async () => {
      await reviewAgent.start();
      expect(messageBus.subscribe).toHaveBeenCalledWith(
        ['polish.done'],
        expect.any(Function)
      );
    });
  });

  describe('approved review', () => {
    it('should publish review.passed when status is approved', async () => {
      mockLLMResponse = JSON.stringify({
        status: 'approved',
        score: 92,
        checks: {
          brief_compliance: { pass: true },
          word_count: { pass: true, actual: 200, target: 200 },
          brand_voice: { pass: true, confidence: 0.95 },
        },
        issues: [],
        strengths: ['Great hook', 'Clear CTA'],
      });

      await reviewAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];
      (stateStore.getJob as any).mockResolvedValue(mockJob);

      await handler(mockEvent);

      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'review.passed',
          jobId: 'job-review-1',
        })
      );
    });
  });

  describe('needs_revision review', () => {
    it('should publish revision.requested when needs revision', async () => {
      mockLLMResponse = JSON.stringify({
        status: 'needs_revision',
        score: 55,
        checks: {
          brief_compliance: { pass: false, notes: 'Missing CTA' },
          word_count: { pass: false, actual: 50, target: 200 },
        },
        issues: ['Too short', 'Missing call to action'],
        strengths: ['Good tone'],
      });

      await reviewAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];
      (stateStore.getJob as any).mockResolvedValue(mockJob);
      (stateStore.incrementIteration as any).mockResolvedValue(1);

      const updatedJob = { ...mockJob, maxIterations: 3 };
      (stateStore.getJob as any)
        .mockResolvedValueOnce(mockJob)    // Initial getJob in base class
        .mockResolvedValueOnce(updatedJob); // getJob after increment

      await handler(mockEvent);

      expect(stateStore.incrementIteration).toHaveBeenCalledWith('job-review-1');
      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'revision.requested',
          payload: expect.objectContaining({
            issues: expect.arrayContaining(['Too short']),
          }),
        })
      );
    });
  });

  describe('max iterations reached', () => {
    it('should escalate to human review when max iterations exceeded', async () => {
      mockLLMResponse = JSON.stringify({
        status: 'needs_revision',
        score: 50,
        checks: {},
        issues: ['Still not good enough'],
        strengths: [],
      });

      await reviewAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];
      (stateStore.getJob as any).mockResolvedValue(mockJob);
      (stateStore.incrementIteration as any).mockResolvedValue(3); // At max

      const maxedJob = { ...mockJob, maxIterations: 3 };
      (stateStore.getJob as any)
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce(maxedJob);

      await handler(mockEvent);

      expect(stateStore.updateJob).toHaveBeenCalledWith('job-review-1', expect.objectContaining({
        status: 'human_review',
      }));
    });
  });

  describe('malformed LLM response', () => {
    it('should fallback to needs_human_review on unparseable JSON', async () => {
      mockLLMResponse = 'This is not JSON at all, just random text from the LLM.';

      await reviewAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];
      (stateStore.getJob as any).mockResolvedValue(mockJob);

      await handler(mockEvent);

      expect(stateStore.updateJob).toHaveBeenCalledWith('job-review-1', expect.objectContaining({
        review: expect.objectContaining({
          status: 'needs_human_review',
          score: 0,
        }),
      }));
    });

    it('should handle empty LLM response', async () => {
      mockLLMResponse = '';

      await reviewAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];
      (stateStore.getJob as any).mockResolvedValue(mockJob);

      await handler(mockEvent);

      expect(stateStore.updateJob).toHaveBeenCalledWith('job-review-1', expect.objectContaining({
        review: expect.objectContaining({
          status: 'needs_human_review',
        }),
      }));
    });

    it('should handle partial JSON in response', async () => {
      mockLLMResponse = '```json\n{"status": "approved", "score": 85, "checks": {}, "issues": [], "strengths": ["good"]}\n```';

      await reviewAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];
      (stateStore.getJob as any).mockResolvedValue(mockJob);

      await handler(mockEvent);

      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'review.passed',
        })
      );
    });
  });

  describe('edge cases', () => {
    it('should handle missing polishedDraft, fallback to draft', async () => {
      mockLLMResponse = JSON.stringify({
        status: 'approved', score: 80, checks: {}, issues: [], strengths: [],
      });

      const jobNoPollish = { ...mockJob, polishedDraft: undefined };
      (stateStore.getJob as any).mockResolvedValue(jobNoPollish);

      await reviewAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];

      // Should not throw
      await expect(handler(mockEvent)).resolves.not.toThrow();
    });

    it('should handle needs_human_review status directly', async () => {
      mockLLMResponse = JSON.stringify({
        status: 'needs_human_review',
        score: 30,
        checks: {},
        issues: ['Content is inappropriate'],
        strengths: [],
      });

      await reviewAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];
      (stateStore.getJob as any).mockResolvedValue(mockJob);

      await handler(mockEvent);

      expect(stateStore.updateJob).toHaveBeenCalledWith('job-review-1', expect.objectContaining({
        status: 'human_review',
      }));
    });
  });
});
