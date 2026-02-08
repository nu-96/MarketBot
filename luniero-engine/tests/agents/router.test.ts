import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../src/core/message-bus', () => ({
  messageBus: {
    publish: vi.fn().mockResolvedValue('event-id-123'),
    subscribe: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/core/state-store', () => ({
  stateStore: {
    createJob: vi.fn().mockImplementation(async (job: any) => ({
      ...job,
      iteration: 0,
      maxIterations: job.maxIterations || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    getJob: vi.fn().mockResolvedValue(null),
    updateJob: vi.fn().mockImplementation(async (id: string, updates: any) => ({
      id,
      ...updates,
      updatedAt: new Date().toISOString(),
    })),
  },
}));

import { routerAgent } from '../../src/agents/router';
import { messageBus } from '../../src/core/message-bus';
import { stateStore } from '../../src/core/state-store';

describe('RouterAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createJob', () => {
    it('should create a job and return jobId', async () => {
      const jobId = await routerAgent.createJob({
        clientId: 'acme',
        type: 'social_post',
        topic: 'AI trends',
      });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(jobId.length).toBeGreaterThan(0);
    });

    it('should call stateStore.createJob with correct fields', async () => {
      await routerAgent.createJob({
        clientId: 'acme',
        type: 'blog_post',
        topic: 'Tech insights',
        platform: 'linkedin',
      });

      expect(stateStore.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'acme',
          type: 'blog_post',
          status: 'received',
          maxIterations: 5,
          input: expect.objectContaining({
            clientId: 'acme',
            type: 'blog_post',
            topic: 'Tech insights',
            platform: 'linkedin',
          }),
        })
      );
    });

    it('should publish job.created event', async () => {
      await routerAgent.createJob({
        clientId: 'acme',
        type: 'social_post',
        topic: 'test topic',
      });

      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'job.created',
          clientId: 'acme',
          sourceAgent: 'router',
          payload: expect.objectContaining({
            type: 'social_post',
            topic: 'test topic',
          }),
        })
      );
    });

    it('should generate unique jobIds', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = await routerAgent.createJob({
          clientId: 'acme',
          type: 'social_post',
          topic: 'test',
        });
        ids.add(id);
      }
      expect(ids.size).toBe(100);
    });

    it('should pass optional instructions', async () => {
      await routerAgent.createJob({
        clientId: 'acme',
        type: 'social_post',
        topic: 'test',
        instructions: 'Keep it under 100 words',
      });

      expect(stateStore.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            instructions: 'Keep it under 100 words',
          }),
        })
      );
    });
  });

  describe('start', () => {
    it('should subscribe to REVIEW_PASSED events', async () => {
      await routerAgent.start();
      expect(messageBus.subscribe).toHaveBeenCalledWith(
        ['review.passed'],
        expect.any(Function)
      );
    });
  });

  describe('handleReviewPassed', () => {
    it('should mark job as complete when review passes', async () => {
      const mockJob = {
        id: 'job-1',
        polishedDraft: { content: 'Final content' },
        iteration: 1,
      };
      (stateStore.getJob as any).mockResolvedValueOnce(mockJob);

      // Start to register handler, then trigger it
      await routerAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];

      await handler({
        eventType: 'review.passed',
        jobId: 'job-1',
        clientId: 'acme',
        traceId: 'trace-1',
        eventId: 'evt-1',
        payload: { score: 92 },
      });

      expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
        status: 'complete',
      }));

      expect(messageBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'job.complete',
          jobId: 'job-1',
        })
      );
    });

    it('should use draft when polishedDraft is missing', async () => {
      const mockJob = {
        id: 'job-2',
        draft: { content: 'Draft content' },
        polishedDraft: undefined,
        iteration: 0,
      };
      (stateStore.getJob as any).mockResolvedValueOnce(mockJob);

      await routerAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];

      await handler({
        eventType: 'review.passed',
        jobId: 'job-2',
        clientId: 'acme',
        traceId: 'trace-1',
        eventId: 'evt-1',
        payload: { score: 85 },
      });

      expect(stateStore.updateJob).toHaveBeenCalledWith('job-2', expect.objectContaining({
        output: { content: 'Draft content' },
      }));
    });

    it('should handle missing job gracefully', async () => {
      (stateStore.getJob as any).mockResolvedValueOnce(null);

      await routerAgent.start();
      const handler = (messageBus.subscribe as any).mock.calls[0][1];

      // Should not throw
      await handler({
        eventType: 'review.passed',
        jobId: 'ghost',
        clientId: 'acme',
        traceId: 'trace-1',
        eventId: 'evt-1',
        payload: { score: 90 },
      });

      expect(stateStore.updateJob).not.toHaveBeenCalled();
    });
  });
});
