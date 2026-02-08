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

import { handleStatus, handleHistory, handleShow } from '../../../src/cli/handlers/status';
import { stateStore } from '../../../src/core/state-store';

const mockJob = {
  id: 'job-1',
  clientId: 'acme',
  type: 'social_post',
  status: 'complete' as const,
  input: { topic: 'AI' },
  iteration: 2,
  maxIterations: 3,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  output: { content: 'Final output' },
  brief: { title: 'AI Brief' },
  draft: { content: 'Draft content' },
  review: { score: 92 },
};

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

describe('handleStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show specific job by ID', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(mockJob);

    const ctx = mockCtx({
      parsed: { command: '/status', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/status job-1', isNLP: false } as ParsedCommand,
    });

    await handleStatus(ctx);

    expect(stateStore.getJob).toHaveBeenCalledWith('job-1');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('job-1');
  });

  it('should show recent jobs for active client', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValueOnce([mockJob]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/status', subcommand: '', args: [], flags: {}, rawInput: '/status', isNLP: false } as ParsedCommand,
    });

    await handleStatus(ctx);

    expect(stateStore.getJobsByClient).toHaveBeenCalledWith('acme', 10);
    expect(ctx.output).toHaveBeenCalled();
  });

  it('should use lastJobId when no args', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(mockJob);

    const ctx = mockCtx({
      session: createSession({ lastJobId: 'job-1' }),
      parsed: { command: '/status', subcommand: '', args: [], flags: {}, rawInput: '/status', isNLP: false } as ParsedCommand,
    });

    await handleStatus(ctx);

    expect(stateStore.getJob).toHaveBeenCalledWith('job-1');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('job-1');
  });

  it('should show info message when no client and no jobId', async () => {
    const ctx = mockCtx({
      parsed: { command: '/status', subcommand: '', args: [], flags: {}, rawInput: '/status', isNLP: false } as ParsedCommand,
    });

    await handleStatus(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('No active client');
  });

  it('should handle job not found', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(null);

    const ctx = mockCtx({
      parsed: { command: '/status', subcommand: '', args: ['ghost'], flags: {}, rawInput: '/status ghost', isNLP: false } as ParsedCommand,
    });

    await handleStatus(ctx);

    expect(stateStore.getJob).toHaveBeenCalledWith('ghost');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('not found');
  });
});

describe('handleHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should require active client', async () => {
    const ctx = mockCtx({
      parsed: { command: '/history', subcommand: '', args: [], flags: {}, rawInput: '/history', isNLP: false } as ParsedCommand,
    });

    await handleHistory(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('No active client');
  });

  it('should show history', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValueOnce([mockJob]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/history', subcommand: '', args: [], flags: {}, rawInput: '/history', isNLP: false } as ParsedCommand,
    });

    await handleHistory(ctx);

    expect(stateStore.getJobsByClient).toHaveBeenCalledWith('acme', 20);
    expect(ctx.output).toHaveBeenCalled();
  });

  it('should respect limit flag', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValueOnce([mockJob]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/history', subcommand: '', args: [], flags: { limit: '5' }, rawInput: '/history --limit=5', isNLP: false } as ParsedCommand,
    });

    await handleHistory(ctx);

    expect(stateStore.getJobsByClient).toHaveBeenCalledWith('acme', 5);
  });
});

describe('handleShow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show full job details', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(mockJob);

    const ctx = mockCtx({
      parsed: { command: '/show', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/show job-1', isNLP: false } as ParsedCommand,
    });

    await handleShow(ctx);

    expect(stateStore.getJob).toHaveBeenCalledWith('job-1');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    // Verify output includes job summary and each section
    expect(allOutput).toContain('job-1');
    expect(allOutput).toContain('Output');
    expect(allOutput).toContain('Brief');
    expect(allOutput).toContain('Draft');
    expect(allOutput).toContain('Review');
    // Multiple output calls: summary + output + brief + draft + review
    expect((ctx.output as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('should require job ID', async () => {
    const ctx = mockCtx({
      parsed: { command: '/show', subcommand: '', args: [], flags: {}, rawInput: '/show', isNLP: false } as ParsedCommand,
      rl: mockRL(['']),
    });

    await handleShow(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Job ID is required');
  });
});
