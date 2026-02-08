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
  },
}));

import { handleApprove, handleRevise, handleReject } from '../../../src/cli/handlers/approval';
import { stateStore } from '../../../src/core/state-store';

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
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
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
  });

  it('should send job back for revision', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce({ ...baseJob, status: 'human_review' } as any);

    const ctx = mockCtx({
      parsed: { command: '/revise', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/revise job-1', isNLP: false } as ParsedCommand,
      rl: mockRL(['']),
    });

    await handleRevise(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'revision' }));
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
});
