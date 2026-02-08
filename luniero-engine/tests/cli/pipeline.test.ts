import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory job store for tests
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
      preferences: { contentPillars: ['innovation', 'leadership'] },
    }),
    getBrandVoice: vi.fn().mockResolvedValue({
      tone: 'Professional but approachable',
      avoid: ['jargon'],
      examples: ['Clear communication'],
      vocabulary: ['innovative'],
    }),
    getContentPillars: vi.fn().mockResolvedValue(['innovation', 'leadership']),
    getRecentFeedback: vi.fn().mockResolvedValue([]),
    searchClientContext: vi.fn().mockResolvedValue([]),
    searchByFileName: vi.fn().mockResolvedValue([]),
    storeClientContext: vi.fn().mockResolvedValue(undefined),
  },
}));

// Use a shared object that the mock factory closes over
const mockState = {
  createFn: null as ReturnType<typeof vi.fn> | null,
};

function defaultLLMCreate(params: any) {
  const systemPrompt = params.system || '';

  if (systemPrompt.includes('Brief Agent') || systemPrompt.includes('content briefs')) {
    return Promise.resolve({
      content: [{
        type: 'text',
        text: JSON.stringify({
          title: 'AI Trends 2026',
          type: 'linkedin_post',
          targetAudience: 'B2B decision makers',
          keyMessages: ['AI is transforming business'],
          structure: [
            { section: 'hook', notes: 'Bold opening' },
            { section: 'body', notes: 'Key trends' },
            { section: 'cta', notes: 'Invite discussion' },
          ],
          wordCount: 200,
          tone: 'Professional',
          platform: 'linkedin',
          hashtags: ['#AI'],
        }),
      }],
    });
  }

  if (systemPrompt.includes('Draft Agent') || systemPrompt.includes('first drafts')) {
    return Promise.resolve({
      content: [{ type: 'text', text: 'The AI revolution is here. Three trends reshaping B2B SaaS.' }],
    });
  }

  if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
    return Promise.resolve({
      content: [{ type: 'text', text: 'The AI revolution is here. Three trends are fundamentally reshaping B2B SaaS.' }],
    });
  }

  if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
    return Promise.resolve({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'approved',
          score: 92,
          checks: {
            brief_compliance: { pass: true, notes: 'Good' },
            word_count: { pass: true, actual: 85, target: 200 },
            brand_voice: { pass: true, confidence: 0.9 },
            structure: { pass: true, notes: 'Clear' },
            cta_present: { pass: true },
            hook_strength: { pass: true, notes: 'Strong' },
          },
          issues: [],
          strengths: ['Compelling hook'],
        }),
      }],
    });
  }

  return Promise.resolve({ content: [{ type: 'text', text: 'Default response' }] });
}

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockImplementation((params: any) => {
        if (mockState.createFn) {
          return mockState.createFn(params);
        }
        return defaultLLMCreate(params);
      }),
    };
  }
  return { default: MockAnthropic };
});

import { runPipeline, PipelineProgress } from '../../src/cli/pipeline';
import { stateStore } from '../../src/core/state-store';
import { clientStore } from '../../src/memory/client-store';

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

describe('runPipeline', () => {
  beforeEach(() => {
    jobStore.clear();
    mockState.createFn = null;
    vi.clearAllMocks();
  });

  it('should run all stages and complete the job (happy path)', async () => {
    await createTestJob('job-1');
    const stages: string[] = [];
    const progress: PipelineProgress = {
      onStage: (status, _label) => stages.push(status),
    };

    const result = await runPipeline('job-1', progress);

    // Pipeline always goes to human_review for approved content (requires human approval)
    expect(result.status).toBe('human_review');
    expect(result.output).toBeDefined();
    expect(result.brief).toBeDefined();
    expect(result.draft).toBeDefined();
    expect(result.polishedDraft).toBeDefined();
    expect(result.review).toBeDefined();
    expect(result.review.score).toBe(92);
  });

  it('should fire progress callbacks at each stage', async () => {
    await createTestJob('job-2');
    const stages: string[] = [];
    const progress: PipelineProgress = {
      onStage: (status, _label) => stages.push(status),
    };

    await runPipeline('job-2', progress);

    expect(stages).toContain('context_loading');
    expect(stages).toContain('briefing');
    expect(stages).toContain('drafting');
    expect(stages).toContain('polishing');
    expect(stages).toContain('reviewing');
    expect(stages).toContain('human_review');
  });

  it('should load context in parallel from clientStore', async () => {
    await createTestJob('job-3');
    const progress: PipelineProgress = { onStage: vi.fn() };

    await runPipeline('job-3', progress);

    expect(clientStore.getProfile).toHaveBeenCalledWith('acme');
    expect(clientStore.getBrandVoice).toHaveBeenCalledWith('acme');
    expect(clientStore.getContentPillars).toHaveBeenCalledWith('acme');
    expect(clientStore.getRecentFeedback).toHaveBeenCalledWith('acme', 5);
  });

  it('should trigger revision loop when score < 60 and needs_revision', async () => {
    await createTestJob('job-4');
    let reviewCallCount = 0;
    let llmCallCount = 0;

    mockState.createFn = vi.fn().mockImplementation(async (params: any) => {
      llmCallCount++;
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
        return { content: [{ type: 'text', text: 'Draft content here' }] };
      }

      if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
        return { content: [{ type: 'text', text: 'Polished content here' }] };
      }

      if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
        reviewCallCount++;
        if (reviewCallCount === 1) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: 'needs_revision', score: 45,
                checks: {}, issues: ['Weak hook', 'Missing CTA'], strengths: [],
              }),
            }],
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'approved', score: 85,
              checks: {}, issues: [], strengths: ['Much improved'],
            }),
          }],
        };
      }

      return { content: [{ type: 'text', text: 'Default' }] };
    });

    const stages: string[] = [];
    const progress: PipelineProgress = {
      onStage: (status) => stages.push(status),
    };

    const result = await runPipeline('job-4', progress);

    expect(result.status).toBe('human_review');
    expect(stages).toContain('revision');
    // 1 brief + 2 draft + 2 polish + 2 review = 7 LLM calls
    expect(llmCallCount).toBe(7);
  });

  it('should go to human_review when max iterations reached', async () => {
    await createTestJob('job-5', { maxIterations: 1 });

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
        return { content: [{ type: 'text', text: 'Draft content' }] };
      }

      if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
        return { content: [{ type: 'text', text: 'Polished content' }] };
      }

      if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'needs_revision', score: 40,
              checks: {}, issues: ['Still bad'], strengths: [],
            }),
          }],
        };
      }

      return { content: [{ type: 'text', text: 'Default' }] };
    });

    const stages: string[] = [];
    const progress: PipelineProgress = {
      onStage: (status) => stages.push(status),
    };

    const result = await runPipeline('job-5', progress);

    expect(result.status).toBe('human_review');
    expect(stages).toContain('human_review');
  });

  it('should go to human_review on review parse failure', async () => {
    await createTestJob('job-6');

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
        return { content: [{ type: 'text', text: 'Draft content' }] };
      }

      if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
        return { content: [{ type: 'text', text: 'Polished content' }] };
      }

      if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
        return { content: [{ type: 'text', text: 'This is not JSON at all.' }] };
      }

      return { content: [{ type: 'text', text: 'Default' }] };
    });

    const progress: PipelineProgress = { onStage: vi.fn() };

    const result = await runPipeline('job-6', progress);

    expect(result.status).toBe('human_review');
    expect(result.review.issues).toContain('Failed to parse review response');
  });

  it('should propagate LLM timeout errors', async () => {
    await createTestJob('job-7');

    mockState.createFn = vi.fn().mockImplementation(async () => {
      throw new Error('AbortError: signal timed out');
    });

    const progress: PipelineProgress = { onStage: vi.fn() };

    await expect(runPipeline('job-7', progress)).rejects.toThrow();
  });

  it('should throw if job not found', async () => {
    const progress: PipelineProgress = { onStage: vi.fn() };
    await expect(runPipeline('nonexistent', progress)).rejects.toThrow('Job not found');
  });

  it('should update stateStore at each step', async () => {
    await createTestJob('job-8');
    const progress: PipelineProgress = { onStage: vi.fn() };

    await runPipeline('job-8', progress);

    const updateCalls = (stateStore.updateJob as any).mock.calls;
    const statusUpdates = updateCalls
      .filter((call: any[]) => call[1].status)
      .map((call: any[]) => call[1].status);

    expect(statusUpdates).toContain('context_loading');
    expect(statusUpdates).toContain('briefing');
    expect(statusUpdates).toContain('drafting');
    expect(statusUpdates).toContain('polishing');
    expect(statusUpdates).toContain('reviewing');
    expect(statusUpdates).toContain('human_review');
  });

  it('should merge searchByFileName results into context when topic matches a document', async () => {
    vi.mocked(clientStore.searchByFileName).mockResolvedValue([
      { text: 'Q1 revenue grew 15%', type: 'content', score: 1.0, metadata: { source: 'file_upload', fileName: 'quarterly-report.pdf', chunkIndex: 0 } },
      { text: 'New product launched in March', type: 'content', score: 1.0, metadata: { source: 'file_upload', fileName: 'quarterly-report.pdf', chunkIndex: 1 } },
    ]);
    vi.mocked(clientStore.searchClientContext).mockResolvedValue([
      { text: 'Content pillar: innovation', type: 'preference', score: 0.8, metadata: { source: 'content_pillar' } },
    ]);

    await createTestJob('job-doc', {
      input: { clientId: 'acme', type: 'social_post', topic: 'quarterly-report', platform: 'instagram' },
    });

    const progress: PipelineProgress = { onStage: vi.fn() };
    const result = await runPipeline('job-doc', progress);

    expect(clientStore.searchByFileName).toHaveBeenCalledWith('acme', 'quarterly-report');
    // All 3 context items should be merged (2 document + 1 semantic)
    expect(result.context.relevantHistory).toHaveLength(3);
    // Document chunks should come first
    expect(result.context.relevantHistory[0].text).toBe('Q1 revenue grew 15%');
    expect(result.context.relevantHistory[1].text).toBe('New product launched in March');
    expect(result.context.relevantHistory[2].text).toBe('Content pillar: innovation');
  });

  it('should deduplicate when semantic search returns same text as document search', async () => {
    const sharedText = 'Q1 revenue grew 15%';
    vi.mocked(clientStore.searchByFileName).mockResolvedValue([
      { text: sharedText, type: 'content', score: 1.0, metadata: { source: 'file_upload', fileName: 'quarterly-report.pdf', chunkIndex: 0 } },
    ]);
    vi.mocked(clientStore.searchClientContext).mockResolvedValue([
      { text: sharedText, type: 'content', score: 0.7, metadata: { source: 'file_upload', fileName: 'quarterly-report.pdf' } },
      { text: 'Content pillar: innovation', type: 'preference', score: 0.5, metadata: { source: 'content_pillar' } },
    ]);

    await createTestJob('job-dedup', {
      input: { clientId: 'acme', type: 'social_post', topic: 'quarterly-report', platform: 'linkedin' },
    });

    const progress: PipelineProgress = { onStage: vi.fn() };
    const result = await runPipeline('job-dedup', progress);

    // Should have 2 (no duplicate of shared text)
    expect(result.context.relevantHistory).toHaveLength(2);
    expect(result.context.relevantHistory[0].text).toBe(sharedText);
    expect(result.context.relevantHistory[1].text).toBe('Content pillar: innovation');
  });

  it('should find document chunks when topic is a natural language phrase containing the filename', async () => {
    vi.mocked(clientStore.searchByFileName).mockResolvedValue([
      { text: 'Build Something People Love', type: 'content', score: 1.0, metadata: { source: 'file_upload', fileName: 'simple_marketing_page.pdf', chunkIndex: 0 } },
      { text: 'Fast Setup, Smart Analytics, Secure', type: 'content', score: 1.0, metadata: { source: 'file_upload', fileName: 'simple_marketing_page.pdf', chunkIndex: 1 } },
    ]);

    await createTestJob('job-nlp', {
      input: { clientId: 'acme', type: 'social_post', topic: 'an instagram post based off of simple_marketing_page', platform: 'instagram' },
    });

    const progress: PipelineProgress = { onStage: vi.fn() };
    const result = await runPipeline('job-nlp', progress);

    // searchByFileName should be called with the full NLP topic
    expect(clientStore.searchByFileName).toHaveBeenCalledWith('acme', 'an instagram post based off of simple_marketing_page');
    // Document chunks should be in context
    expect(result.context.relevantHistory.length).toBeGreaterThanOrEqual(2);
    expect(result.context.relevantHistory[0].text).toBe('Build Something People Love');
  });

  it('should handle needs_human_review status from review agent', async () => {
    await createTestJob('job-9');

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
        return { content: [{ type: 'text', text: 'Draft content' }] };
      }

      if (systemPrompt.includes('Polish Agent') || systemPrompt.includes('refine drafts')) {
        return { content: [{ type: 'text', text: 'Polished content' }] };
      }

      if (systemPrompt.includes('Review Agent') || systemPrompt.includes('ensure quality')) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'needs_human_review', score: 55,
              checks: {}, issues: ['Sensitive topic'], strengths: [],
            }),
          }],
        };
      }

      return { content: [{ type: 'text', text: 'Default' }] };
    });

    const progress: PipelineProgress = { onStage: vi.fn() };
    const result = await runPipeline('job-9', progress);

    expect(result.status).toBe('human_review');
  });
});
