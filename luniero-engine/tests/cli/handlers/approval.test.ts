import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as readline from 'readline';
import { HandlerContext } from '../../../src/cli/router';
import { createSession } from '../../../src/cli/session';
import { ParsedCommand } from '../../../src/cli/parser';

vi.mock('../../../src/core/state-store', () => ({
  stateStore: {
    getJob: vi.fn(),
    updateJob: vi.fn(),
    getJobsByClient: vi.fn().mockResolvedValue([]),
    createJob: vi.fn(),
  },
}));

vi.mock('../../../src/core/message-bus', () => ({
  messageBus: {
    publish: vi.fn().mockResolvedValue('evt-1'),
    subscribe: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/memory/client-store', () => ({
  clientStore: {
    getProfile: vi.fn().mockResolvedValue(null),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    getBrandVoice: vi.fn().mockResolvedValue(null),
    getContentPillars: vi.fn().mockResolvedValue([]),
    storeClientContext: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/cli/pipeline', () => ({
  runPipeline: vi.fn().mockResolvedValue({
    id: 'job-1',
    status: 'human_review',
    clientId: 'acme',
    type: 'social_post',
    input: { topic: 'AI' },
    iteration: 1,
    maxIterations: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    output: { content: 'Revised content' },
    review: { score: 85 },
  }),
}));

import { handleApprove, handleRevise, handleReject } from '../../../src/cli/handlers/approval';
import { stateStore } from '../../../src/core/state-store';
import { runPipeline } from '../../../src/cli/pipeline';

function mockRL(answers: string[] = []) {
  let i = 0;
  return {
    question: vi.fn((q: string, cb: (a: string) => void) => cb(answers[i++] || '')),
  } as unknown as readline.Interface;
}

function mockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    session: createSession(),
    parsed: { command: '', subcommand: '', args: [], flags: {}, rawInput: '', isNLP: false } as ParsedCommand,
    rl: mockRL(),
    output: vi.fn(),
    ...overrides,
  };
}

const baseJob = {
  id: 'job-1',
  clientId: 'acme',
  type: 'social_post',
  input: {},
  iteration: 0,
  maxIterations: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('handleApprove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should require job ID', async () => {
    const ctx = mockCtx({
      rl: mockRL(['']),
    });

    await handleApprove(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('No pending job'))).toBe(true);
  });

  it('should approve job in human_review', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review' } as any);

    const ctx = mockCtx({
      parsed: { command: '/approve', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/approve job-1', isNLP: false } as ParsedCommand,
    });

    await handleApprove(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'complete' }));
  });

  it('should store content as vector on approval', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({
      ...baseJob,
      status: 'human_review',
      review: { score: 85 },
      output: { content: 'Great article about AI trends in marketing.' },
      input: { topic: 'AI trends' },
    } as any);

    const ctx = mockCtx({
      parsed: { command: '/approve', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/approve job-1', isNLP: false } as ParsedCommand,
    });

    const { clientStore } = await import('../../../src/memory/client-store');
    await handleApprove(ctx);

    // Should store the score-based context
    expect(clientStore.storeClientContext).toHaveBeenCalledWith('acme', expect.objectContaining({
      type: 'content',
      text: expect.stringContaining('Score: 85'),
    }));
    // Should store the actual content
    expect(clientStore.storeClientContext).toHaveBeenCalledWith('acme', expect.objectContaining({
      type: 'content',
      text: 'Great article about AI trends in marketing.',
      metadata: expect.objectContaining({ jobId: 'job-1', topic: 'AI trends' }),
    }));
  });

  it('should approve brief_pending_approval', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'brief_pending_approval' } as any);

    const ctx = mockCtx({
      parsed: { command: '/approve', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/approve job-1', isNLP: false } as ParsedCommand,
    });

    await handleApprove(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'drafting' }));
  });

  it('should reject non-reviewable job', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'drafting' } as any);

    const ctx = mockCtx({
      parsed: { command: '/approve', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/approve job-1', isNLP: false } as ParsedCommand,
    });

    await handleApprove(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('not awaiting approval'))).toBe(true);
  });
});

describe('handleRevise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('should send job back for revision and re-run pipeline', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review' } as any);

    const ctx = mockCtx({
      parsed: { command: '/revise', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/revise job-1', isNLP: false } as ParsedCommand,
      rl: mockRL(['Make this shorter']),
    });

    await handleRevise(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'revision' }));
    expect(runPipeline).toHaveBeenCalledWith('job-1', expect.objectContaining({ onStage: expect.any(Function) }));
  });

  it('should store revision notes', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review', review: { score: 70 } } as any);

    const ctx = mockCtx({
      parsed: { command: '/revise', subcommand: 'job-1', args: ['Make', 'it', 'punchier'], flags: {}, rawInput: '/revise job-1 Make it punchier', isNLP: false } as ParsedCommand,
    });

    await handleRevise(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      review: expect.objectContaining({ revisionNotes: 'Make it punchier' }),
    }));
  });

  it('should show approval prompt after pipeline completes with human_review', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review' } as any);

    const ctx = mockCtx({
      parsed: { command: '/revise', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/revise job-1', isNLP: false } as ParsedCommand,
      rl: mockRL(['']),
    });

    await handleRevise(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Revised content ready'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('Ready for next command'))).toBe(true);
  });

  it('should update session with job and pending approval', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review' } as any);

    const ctx = mockCtx({
      parsed: { command: '/revise', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/revise job-1', isNLP: false } as ParsedCommand,
      rl: mockRL(['']),
    });

    const result = await handleRevise(ctx);

    expect(result.session.lastHandler).toBe('/revise');
    expect(result.session.lastJobId).toBe('job-1');
    expect(result.session.pendingApproval).toBe('job-1');
  });

  it('should accept inline feedback when session has pending job', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review' } as any);

    const ctx = mockCtx({
      session: createSession({ pendingApproval: 'job-1', lastJobId: 'job-1' }),
      parsed: { command: '/revise', subcommand: 'Make', args: ['this', 'shorter'], flags: {}, rawInput: '/revise Make this shorter', isNLP: false } as ParsedCommand,
    });

    await handleRevise(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      review: expect.objectContaining({ revisionNotes: 'Make this shorter' }),
    }));
    expect(runPipeline).toHaveBeenCalledWith('job-1', expect.objectContaining({ onStage: expect.any(Function) }));
  });
});

describe('handleReject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject job', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review' } as any);

    const ctx = mockCtx({
      parsed: { command: '/reject', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/reject job-1', isNLP: false } as ParsedCommand,
      rl: mockRL(['']),
    });

    await handleReject(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('Rejected'),
    }));
  });

  it('should accept inline reason when session has pending job', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review' } as any);

    const ctx = mockCtx({
      session: createSession({ pendingApproval: 'job-1', lastJobId: 'job-1' }),
      parsed: { command: '/reject', subcommand: 'Not', args: ['good', 'enough'], flags: {}, rawInput: '/reject Not good enough', isNLP: false } as ParsedCommand,
    });

    await handleReject(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'failed',
      error: 'Rejected: Not good enough',
    }));
  });
});
