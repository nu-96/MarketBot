import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../src/memory/client-store', () => ({
  clientStore: {
    getProfile: vi.fn().mockResolvedValue({
      id: 'acme',
      name: 'Acme Corp',
      industry: 'B2B SaaS',
      preferences: { contentPillars: ['innovation'] },
    }),
    getBrandVoice: vi.fn().mockResolvedValue({
      tone: 'Professional',
      avoid: ['jargon'],
      examples: ['Clear communication'],
      vocabulary: ['innovative'],
    }),
    getContentPillars: vi.fn().mockResolvedValue(['innovation']),
    getRecentFeedback: vi.fn().mockResolvedValue([]),
    searchClientContext: vi.fn().mockResolvedValue([]),
    searchByFileName: vi.fn().mockResolvedValue([]),
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
        if (mockState.createFn) {
          return mockState.createFn(params);
        }
        const systemPrompt = params.system || '';
        if (systemPrompt.includes('Brief Agent') || systemPrompt.includes('content briefs')) {
          return Promise.resolve({
            content: [{
              type: 'text',
              text: JSON.stringify({
                title: 'Test Brief',
                type: 'social_post',
                targetAudience: 'Devs',
                keyMessages: ['AI rocks'],
                structure: [{ section: 'hook', notes: 'Bold start' }],
                wordCount: 150,
                tone: 'Professional',
                platform: 'linkedin',
                hashtags: ['#AI'],
              }),
            }],
          });
        }
        if (systemPrompt.includes('Draft Agent') || systemPrompt.includes('first drafts')) {
          return Promise.resolve({
            content: [{ type: 'text', text: 'The future of AI is here. Three trends reshaping B2B.' }],
          });
        }
        if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
          return Promise.resolve({
            content: [{ type: 'text', text: 'The future of AI is here. Three trends are fundamentally reshaping B2B.' }],
          });
        }
        if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify({ status: 'approved', score: 90, checks: {}, issues: [], strengths: ['Good'] }) }],
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

function createTestJob(id: string, overrides?: Record<string, any>) {
  return stateStore.createJob({
    id,
    clientId: 'acme',
    type: 'social_post',
    status: 'received' as const,
    input: { clientId: 'acme', type: 'social_post', topic: 'AI trends', platform: 'linkedin' },
    maxIterations: 3,
    ...overrides,
  });
}

describe('Draft Agent (via pipeline)', () => {
  beforeEach(() => {
    jobStore.clear();
    mockState.createFn = null;
    vi.clearAllMocks();
  });

  it('should produce a draft with content and word count', async () => {
    await createTestJob('draft-1');
    const result = await runPipeline('draft-1', { onStage: vi.fn() });

    expect(result.draft).toBeDefined();
    expect(result.draft.content).toBeTruthy();
    expect(result.draft.wordCount).toBeGreaterThan(0);
  });

  it('should pass revision issues to draft prompt on retry', async () => {
    await createTestJob('draft-2');
    let draftCallCount = 0;

    mockState.createFn = vi.fn().mockImplementation(async (params: any) => {
      const systemPrompt = params.system || '';
      const userPrompt = params.messages?.[0]?.content || '';

      if (systemPrompt.includes('Brief Agent') || systemPrompt.includes('content briefs')) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              title: 'Test', type: 'post', targetAudience: 'devs',
              keyMessages: ['msg'], structure: [{ section: 'hook', notes: 'hook' }],
              wordCount: 100, tone: 'casual', platform: 'linkedin', hashtags: [],
            }),
          }],
        };
      }

      if (systemPrompt.includes('Draft Agent') || systemPrompt.includes('first drafts')) {
        draftCallCount++;
        if (draftCallCount === 2) {
          // On revision, the prompt should contain the issues
          expect(userPrompt).toContain('Weak hook');
        }
        return { content: [{ type: 'text', text: 'Draft content here' }] };
      }

      if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
        return { content: [{ type: 'text', text: 'Polished content' }] };
      }

      if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
        if (draftCallCount === 1) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'needs_revision', score: 40,
                checks: {}, issues: ['Weak hook'], strengths: [],
              }),
            }],
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'approved', score: 85,
              checks: {}, issues: [], strengths: ['Improved'],
            }),
          }],
        };
      }

      return { content: [{ type: 'text', text: 'Default' }] };
    });

    const result = await runPipeline('draft-2', { onStage: vi.fn() });

    expect(result.status).toBe('human_review');
    expect(draftCallCount).toBe(2);
  });

  it('should use higher temperature and max tokens for drafting', async () => {
    await createTestJob('draft-3');
    let draftParams: any = null;

    mockState.createFn = vi.fn().mockImplementation(async (params: any) => {
      const systemPrompt = params.system || '';

      if (systemPrompt.includes('Brief Agent') || systemPrompt.includes('content briefs')) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              title: 'Test', type: 'post', targetAudience: 'devs',
              keyMessages: ['msg'], structure: [{ section: 'hook', notes: 'hook' }],
              wordCount: 100, tone: 'casual', platform: 'linkedin', hashtags: [],
            }),
          }],
        };
      }

      if (systemPrompt.includes('Draft Agent') || systemPrompt.includes('first drafts')) {
        draftParams = params;
        return { content: [{ type: 'text', text: 'Draft content' }] };
      }

      if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
        return { content: [{ type: 'text', text: 'Polished' }] };
      }

      if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'approved', score: 85, checks: {}, issues: [], strengths: [] }) }],
        };
      }

      return { content: [{ type: 'text', text: 'Default' }] };
    });

    await runPipeline('draft-3', { onStage: vi.fn() });

    expect(draftParams).not.toBeNull();
    expect(draftParams.max_tokens).toBe(8192);
    expect(draftParams.temperature).toBe(0.8);
  });
});
