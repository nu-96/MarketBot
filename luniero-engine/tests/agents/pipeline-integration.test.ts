import { describe, it, expect, vi, beforeEach } from 'vitest';

const jobStore = new Map<string, any>();

vi.mock('../../src/core/state-store', () => ({
  stateStore: {
    createJob: vi.fn().mockImplementation(async (job: any) => {
      const fullJob = {
        ...job, iteration: 0, maxIterations: job.maxIterations || 3,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      jobStore.set(fullJob.id, fullJob);
      return fullJob;
    }),
    getJob: vi.fn().mockImplementation(async (jobId: string) => jobStore.get(jobId) || null),
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

vi.mock('../../src/memory/client-store', () => ({
  clientStore: {
    getProfile: vi.fn().mockResolvedValue({
      id: 'test', name: 'Test Client', industry: 'Tech',
      preferences: { contentPillars: ['Testing'] },
    }),
    getBrandVoice: vi.fn().mockResolvedValue({
      tone: 'Professional', avoid: [], examples: [], vocabulary: [],
    }),
    getContentPillars: vi.fn().mockResolvedValue(['Testing']),
    getRecentFeedback: vi.fn().mockResolvedValue([]),
    searchClientContext: vi.fn().mockResolvedValue([]),
    searchByFileName: vi.fn().mockResolvedValue([]),
    storeClientContext: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockState = { createFn: null as ReturnType<typeof vi.fn> | null };

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockImplementation((params: any) => {
        if (mockState.createFn) return mockState.createFn(params);
        const sp = params.system || '';
        if (sp.includes('Brief Agent') || sp.includes('content briefs')) {
          return Promise.resolve({ content: [{ type: 'text', text: JSON.stringify({
            title: 'Test', type: 'post', targetAudience: 'devs', keyMessages: ['test'],
            structure: [{ section: 'hook', notes: 'n' }], wordCount: 100, tone: 'pro', platform: 'twitter', hashtags: [],
          }) }] });
        }
        if (sp.includes('Draft Agent') || sp.includes('first drafts')) {
          return Promise.resolve({ content: [{ type: 'text', text: 'Unit testing best practices for modern teams.' }] });
        }
        if (sp.includes('Polish Agent') || sp.includes('refine drafts')) {
          return Promise.resolve({ content: [{ type: 'text', text: 'Unit testing best practices every modern team should adopt.' }] });
        }
        if (sp.includes('Review Agent') || sp.includes('ensure quality')) {
          return Promise.resolve({ content: [{ type: 'text', text: JSON.stringify({
            status: 'approved', score: 85, checks: {}, issues: [], strengths: ['Clear'],
          }) }] });
        }
        return Promise.resolve({ content: [{ type: 'text', text: 'Default' }] });
      }),
    };
  }
  return { default: MockAnthropic };
});

import { runPipeline } from '../../src/cli/pipeline';
import { stateStore } from '../../src/core/state-store';
import { clientStore } from '../../src/memory/client-store';

describe('Pipeline Integration', () => {
  beforeEach(() => {
    jobStore.clear();
    mockState.createFn = null;
    vi.clearAllMocks();
  });

  it('should run complete pipeline from brief to review', async () => {
    await stateStore.createJob({
      id: 'pipe-1', clientId: 'test', type: 'social_post', status: 'received' as const,
      input: { clientId: 'test', type: 'social_post', topic: 'unit testing', platform: 'twitter' },
      maxIterations: 3,
    });

    const stages: string[] = [];
    const result = await runPipeline('pipe-1', {
      onStage: (status) => stages.push(status),
    });

    expect(stages).toContain('context_loading');
    expect(stages).toContain('briefing');
    expect(stages).toContain('drafting');
    expect(stages).toContain('polishing');
    expect(stages).toContain('reviewing');
    expect(['complete', 'human_review']).toContain(result.status);
    expect(result.output || result.polishedDraft).toBeDefined();
  });

  it('should handle revision loop correctly', async () => {
    await stateStore.createJob({
      id: 'pipe-2', clientId: 'test', type: 'social_post', status: 'received' as const,
      input: { clientId: 'test', type: 'social_post', topic: 'testing' },
      maxIterations: 3,
    });

    let reviewCount = 0;
    mockState.createFn = vi.fn().mockImplementation(async (params: any) => {
      const sp = params.system || '';
      if (sp.includes('Brief Agent') || sp.includes('content briefs')) {
        return { content: [{ type: 'text', text: JSON.stringify({
          title: 'T', type: 'p', targetAudience: 'd', keyMessages: ['m'],
          structure: [{ section: 'h', notes: 'n' }], wordCount: 100, tone: 'c', platform: 'tw', hashtags: [],
        }) }] };
      }
      if (sp.includes('Draft Agent') || sp.includes('first drafts')) return { content: [{ type: 'text', text: 'Draft' }] };
      if (sp.includes('Polish Agent') || sp.includes('refine drafts')) return { content: [{ type: 'text', text: 'Polished' }] };
      if (sp.includes('Review Agent') || sp.includes('ensure quality')) {
        reviewCount++;
        if (reviewCount === 1) {
          return { content: [{ type: 'text', text: JSON.stringify({
            status: 'needs_revision', score: 40, checks: {}, issues: ['Weak'], strengths: [],
          }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({
          status: 'approved', score: 82, checks: {}, issues: [], strengths: ['Better'],
        }) }] };
      }
      return { content: [{ type: 'text', text: 'Default' }] };
    });

    const stages: string[] = [];
    const result = await runPipeline('pipe-2', { onStage: (s) => stages.push(s) });

    expect(result.status).toBe('human_review');
    expect(stages).toContain('revision');
    expect(reviewCount).toBe(2);
  });

  it('should respect maxIterations limit', async () => {
    await stateStore.createJob({
      id: 'pipe-3', clientId: 'test', type: 'social_post', status: 'received' as const,
      input: { clientId: 'test', type: 'social_post', topic: 'test' },
      maxIterations: 1,
    });

    mockState.createFn = vi.fn().mockImplementation(async (params: any) => {
      const sp = params.system || '';
      if (sp.includes('Brief Agent') || sp.includes('content briefs')) {
        return { content: [{ type: 'text', text: JSON.stringify({
          title: 'T', type: 'p', targetAudience: 'd', keyMessages: ['m'],
          structure: [{ section: 'h', notes: 'n' }], wordCount: 100, tone: 'c', platform: 'tw', hashtags: [],
        }) }] };
      }
      if (sp.includes('Draft Agent') || sp.includes('first drafts')) return { content: [{ type: 'text', text: 'Draft' }] };
      if (sp.includes('Polish Agent') || sp.includes('refine drafts')) return { content: [{ type: 'text', text: 'Polished' }] };
      if (sp.includes('Review Agent') || sp.includes('ensure quality')) {
        return { content: [{ type: 'text', text: JSON.stringify({
          status: 'needs_revision', score: 30, checks: {}, issues: ['Bad'], strengths: [],
        }) }] };
      }
      return { content: [{ type: 'text', text: 'Default' }] };
    });

    const result = await runPipeline('pipe-3', { onStage: vi.fn() });
    expect(result.status).toBe('human_review');
  });

  it('should produce output ready for approval and context storage', async () => {
    await stateStore.createJob({
      id: 'pipe-4', clientId: 'test', type: 'social_post', status: 'received' as const,
      input: { clientId: 'test', type: 'social_post', topic: 'testing', platform: 'twitter' },
      maxIterations: 3,
    });

    const result = await runPipeline('pipe-4', { onStage: vi.fn() });

    // Pipeline ends at human_review with output ready for approval handler
    // (approval handler stores client context vectors upon completion)
    expect(result.status).toBe('human_review');
    expect(result.output).toBeDefined();
    expect(result.output.content).toBeTruthy();
  });
});
