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

vi.mock('../../../src/config', () => ({
  config: {
    nodeEnv: 'test',
    localMode: true,
    redisUrl: 'redis://localhost:6379',
    supabaseUrl: '',
    supabaseKey: '',
    anthropicApiKey: 'test-key',
  },
}));

import { handleDebug } from '../../../src/cli/handlers/debug';
import { stateStore } from '../../../src/core/state-store';

const baseMockJob = {
  id: 'job-1',
  clientId: 'acme',
  type: 'social_post',
  input: { topic: 'AI' },
  iteration: 1,
  maxIterations: 3,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
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

describe('handleDebug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show usage for empty subcommand', async () => {
    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: '', args: [], flags: {}, rawInput: '/debug', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Usage');
  });

  it('should show error for unknown subcommand', async () => {
    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'xyz', args: [], flags: {}, rawInput: '/debug xyz', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Unknown debug command');
  });

  it('should show system status', async () => {
    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'status', args: [], flags: {}, rawInput: '/debug status', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    expect(ctx.output).toHaveBeenCalled();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('SYSTEM STATUS');
  });

  it('should show raw job data', async () => {
    const job = { ...baseMockJob, status: 'complete' as const };
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(job);

    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'job', args: ['job-1'], flags: {}, rawInput: '/debug job job-1', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    expect(stateStore.getJob).toHaveBeenCalledWith('job-1');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    // Raw JSON dump should contain the job data
    expect(allOutput).toContain('job-1');
    expect(allOutput).toContain('acme');
  });

  it('should show job trace', async () => {
    const job = { ...baseMockJob, status: 'complete' as const };
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(job);

    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'trace', args: ['job-1'], flags: {}, rawInput: '/debug trace job-1', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    expect(stateStore.getJob).toHaveBeenCalledWith('job-1');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('EVENT TRACE');
  });

  it('should show logs/history', async () => {
    const ctx = mockCtx({
      session: createSession(),
      parsed: { command: '/debug', subcommand: 'logs', args: [], flags: {}, rawInput: '/debug logs', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput.toLowerCase()).toContain('history');
  });

  it('should retry a failed job', async () => {
    const failedJob = { ...baseMockJob, status: 'failed' as const, error: 'Something went wrong' };
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(failedJob);

    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'retry', args: ['job-1'], flags: {}, rawInput: '/debug retry job-1', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', { status: 'received', error: undefined });
  });

  it('should reject retry of non-failed job', async () => {
    const draftingJob = { ...baseMockJob, status: 'drafting' as const };
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(draftingJob);

    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'retry', args: ['job-1'], flags: {}, rawInput: '/debug retry job-1', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    expect(stateStore.updateJob).not.toHaveBeenCalled();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('not in failed state');
  });

  it('should cancel an in-progress job', async () => {
    const draftingJob = { ...baseMockJob, status: 'drafting' as const };
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(draftingJob);

    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'cancel', args: ['job-1'], flags: {}, rawInput: '/debug cancel job-1', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', { status: 'failed', error: 'Cancelled by user' });
  });

  it('should reject cancel of terminal job', async () => {
    const completeJob = { ...baseMockJob, status: 'complete' as const };
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(completeJob);

    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'cancel', args: ['job-1'], flags: {}, rawInput: '/debug cancel job-1', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    expect(stateStore.updateJob).not.toHaveBeenCalled();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('terminal state');
  });

  it('should show connections info', async () => {
    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'connections', args: [], flags: {}, rawInput: '/debug connections', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    expect(ctx.output).toHaveBeenCalled();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('CONNECTION TEST');
  });

  it('should show agent health', async () => {
    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'agents', args: [], flags: {}, rawInput: '/debug agents', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('AGENT HEALTH');
    expect(allOutput).toContain('ROUTER');
    expect(allOutput).toContain('Running');
  });

  it('should show configuration', async () => {
    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'config', args: [], flags: {}, rawInput: '/debug config', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('CONFIGURATION');
    expect(allOutput).toContain('SENSITIVE VALUES HIDDEN');
  });

  it('should dump job data as JSON', async () => {
    const job = { ...baseMockJob, status: 'complete' as const };
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(job);

    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'dump', args: ['job-1'], flags: {}, rawInput: '/debug dump job-1', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('job-1');
    expect(allOutput).toContain('Full Job Data');
  });

  it('should show debug shell message', async () => {
    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'shell', args: [], flags: {}, rawInput: '/debug shell', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('not yet available');
  });

  it('should handle job not found for debug job', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(null);

    const ctx = mockCtx({
      parsed: { command: '/debug', subcommand: 'job', args: ['job-1'], flags: {}, rawInput: '/debug job job-1', isNLP: false } as ParsedCommand,
    });

    await handleDebug(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('not found');
  });
});
