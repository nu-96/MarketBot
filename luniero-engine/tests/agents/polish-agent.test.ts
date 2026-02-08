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
      id: 'bloom', name: 'Bloom Beauty', industry: 'Cosmetics',
      preferences: { contentPillars: ['Sustainability'] },
    }),
    getBrandVoice: vi.fn().mockResolvedValue({
      tone: 'warm and friendly', avoid: ['harsh standards'],
      examples: ['Glow naturally'], vocabulary: ['nourish', 'glow'],
    }),
    getContentPillars: vi.fn().mockResolvedValue(['Sustainability']),
    getRecentFeedback: vi.fn().mockResolvedValue([]),
    searchClientContext: vi.fn().mockResolvedValue([]),
    storeClientContext: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockState = {
  createFn: null as ReturnType<typeof vi.fn> | null,
};

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockImplementation((params: any) => {
        if (mockState.createFn) return mockState.createFn(params);
        const systemPrompt = params.system || '';
        if (systemPrompt.includes('Brief Agent') || systemPrompt.includes('content briefs')) {
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify({
              title: 'Clean Beauty', type: 'social_post', targetAudience: 'Beauty lovers',
              keyMessages: ['Go clean'], structure: [{ section: 'hook', notes: 'Glow' }],
              wordCount: 120, tone: 'Warm', platform: 'instagram', hashtags: ['#clean'],
            }) }],
          });
        }
        if (systemPrompt.includes('Draft Agent') || systemPrompt.includes('first drafts')) {
          return Promise.resolve({ content: [{ type: 'text', text: 'Your skin deserves better. Here is why clean beauty matters.' }] });
        }
        if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
          return Promise.resolve({ content: [{ type: 'text', text: 'Your skin deserves the very best. Here is why clean beauty is the future.' }] });
        }
        if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify({ status: 'approved', score: 88, checks: {}, issues: [], strengths: ['On brand'] }) }],
          });
        }
        return Promise.resolve({ content: [{ type: 'text', text: 'Default' }] });
      }),
    };
  }
  return { default: MockAnthropic };
});

import { runPipeline } from '../../src/cli/pipeline';
import { stateStore } from '../../src/core/state-store';

describe('Polish Agent (via pipeline)', () => {
  beforeEach(() => {
    jobStore.clear();
    mockState.createFn = null;
    vi.clearAllMocks();
  });

  it('should produce polished content different from draft', async () => {
    await stateStore.createJob({
      id: 'polish-1', clientId: 'bloom', type: 'social_post', status: 'received' as const,
      input: { clientId: 'bloom', type: 'social_post', topic: 'clean beauty', platform: 'instagram' },
      maxIterations: 3,
    });

    const result = await runPipeline('polish-1', { onStage: vi.fn() });

    expect(result.polishedDraft).toBeDefined();
    expect(result.polishedDraft.content).not.toBe(result.draft.content);
  });

  it('should use lower temperature for polishing (0.5)', async () => {
    await stateStore.createJob({
      id: 'polish-2', clientId: 'bloom', type: 'social_post', status: 'received' as const,
      input: { clientId: 'bloom', type: 'social_post', topic: 'skincare', platform: 'instagram' },
      maxIterations: 3,
    });

    let polishParams: any = null;
    mockState.createFn = vi.fn().mockImplementation(async (params: any) => {
      const sp = params.system || '';
      if (sp.includes('Brief Agent') || sp.includes('content briefs')) {
        return { content: [{ type: 'text', text: JSON.stringify({
          title: 'T', type: 'post', targetAudience: 'd', keyMessages: ['m'],
          structure: [{ section: 'h', notes: 'n' }], wordCount: 100, tone: 'c', platform: 'ig', hashtags: [],
        }) }] };
      }
      if (sp.includes('Draft Agent') || sp.includes('first drafts')) {
        return { content: [{ type: 'text', text: 'Draft' }] };
      }
      if (sp.includes('Polish Agent') || sp.includes('refine drafts')) {
        polishParams = params;
        return { content: [{ type: 'text', text: 'Polished' }] };
      }
      if (sp.includes('Review Agent') || sp.includes('ensure quality')) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'approved', score: 80, checks: {}, issues: [], strengths: [] }) }] };
      }
      return { content: [{ type: 'text', text: 'Default' }] };
    });

    await runPipeline('polish-2', { onStage: vi.fn() });

    expect(polishParams).not.toBeNull();
    expect(polishParams.temperature).toBe(0.5);
  });

  it('should track polished word count', async () => {
    await stateStore.createJob({
      id: 'polish-3', clientId: 'bloom', type: 'social_post', status: 'received' as const,
      input: { clientId: 'bloom', type: 'social_post', topic: 'beauty', platform: 'instagram' },
      maxIterations: 3,
    });

    const result = await runPipeline('polish-3', { onStage: vi.fn() });

    expect(result.polishedDraft.wordCount).toBeGreaterThan(0);
  });
});
