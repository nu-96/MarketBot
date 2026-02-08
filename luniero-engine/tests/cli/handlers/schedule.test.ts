import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { handleSchedule, handlePublish, handleQueue } from '../../../src/cli/handlers/schedule';
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

const completeJob = {
  id: 'job-1',
  clientId: 'acme',
  type: 'social_post',
  status: 'complete',
  input: { topic: 'AI' },
  iteration: 1,
  maxIterations: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  output: { content: 'Hello' },
};

const draftingJob = {
  ...completeJob,
  status: 'drafting',
};

describe('handleSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should require job ID', async () => {
    const ctx = mockCtx({
      rl: mockRL(['']),
    });

    await handleSchedule(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Job ID') && msg.toLowerCase().includes('required'))).toBe(true);
  });

  it('should require complete status', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(draftingJob as any);

    const ctx = mockCtx({
      parsed: { command: '/schedule', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/schedule job-1', isNLP: false } as ParsedCommand,
    });

    await handleSchedule(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('must be complete'))).toBe(true);
  });

  it('should schedule a complete job and set status to scheduled', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(completeJob as any);

    const ctx = mockCtx({
      parsed: { command: '/schedule', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/schedule job-1', isNLP: false } as ParsedCommand,
      rl: mockRL(['2026-03-01 10:00']),
    });

    await handleSchedule(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'scheduled',
    }));
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Scheduled Successfully');
    expect(allOutput).toContain('scheduled');
  });

  it('should store scheduledAt in output', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(completeJob as any);

    const ctx = mockCtx({
      parsed: { command: '/schedule', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/schedule job-1', isNLP: false } as ParsedCommand,
      rl: mockRL(['2026-03-01 10:00']),
    });

    await handleSchedule(ctx);

    const updateCall = vi.mocked(stateStore.updateJob).mock.calls[0];
    expect(updateCall[1].output.scheduledAt).toBe('2026-03-01 10:00');
  });

  it('should fire alert when schedule time arrives', async () => {
    // Set "now" to a known time
    vi.setSystemTime(new Date('2026-03-01T09:00:00'));
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(completeJob as any);
    vi.mocked(stateStore.updateJob).mockResolvedValue(completeJob as any);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const ctx = mockCtx({
      parsed: { command: '/schedule', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/schedule job-1', isNLP: false } as ParsedCommand,
      rl: mockRL(['2026-03-01 10:00']),
    });

    await handleSchedule(ctx);

    // Advance time to trigger the alert
    vi.advanceTimersByTime(60 * 60 * 1000); // 1 hour

    // Should have written the alert to stdout
    const stdoutCalls = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(stdoutCalls).toContain('SCHEDULED CONTENT READY');

    // Should update status back to complete
    const updateCalls = vi.mocked(stateStore.updateJob).mock.calls;
    const completeUpdate = updateCalls.find(c => c[1].status === 'complete');
    expect(completeUpdate).toBeTruthy();

    writeSpy.mockRestore();
  });
});

describe('handlePublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should publish a complete job', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(completeJob as any);

    const ctx = mockCtx({
      parsed: { command: '/publish', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/publish job-1', isNLP: false } as ParsedCommand,
    });

    await handlePublish(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('coming soon'))).toBe(true);
  });

  it('should require complete status', async () => {
    vi.mocked(stateStore.getJob).mockResolvedValueOnce(draftingJob as any);

    const ctx = mockCtx({
      parsed: { command: '/publish', subcommand: '', args: ['job-1'], flags: {}, rawInput: '/publish job-1', isNLP: false } as ParsedCommand,
    });

    await handlePublish(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('must be complete'))).toBe(true);
  });
});

describe('handleQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should require active client', async () => {
    const ctx = mockCtx();

    await handleQueue(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no active client'))).toBe(true);
  });

  it('should show empty queue', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValueOnce([]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
    });

    await handleQueue(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('No queued'))).toBe(true);
  });

  it('should show in-progress jobs', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValueOnce([
      { ...completeJob, id: 'job-2', status: 'drafting' },
      { ...completeJob, id: 'job-3', status: 'human_review' },
      { ...completeJob, id: 'job-4', status: 'complete' },
      { ...completeJob, id: 'job-5', status: 'failed' },
    ] as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
    });

    await handleQueue(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('In Progress');
    expect(allOutput).toContain('job-2');
    expect(allOutput).toContain('job-3');
    expect(allOutput).not.toContain('job-4');
    expect(allOutput).not.toContain('job-5');
  });

  it('should show scheduled jobs in purple section', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValueOnce([
      { ...completeJob, id: 'job-sched-1', status: 'scheduled', output: { content: 'Hello', scheduledAt: '2026-03-01 10:00' } },
      { ...completeJob, id: 'job-sched-2', status: 'scheduled', output: { content: 'World', scheduledAt: '2026-03-02 14:00' } },
      { ...completeJob, id: 'job-done', status: 'complete' },
    ] as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
    });

    await handleQueue(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Scheduled');
    expect(allOutput).toContain('job-sched-1');
    expect(allOutput).toContain('job-sched-2');
    expect(allOutput).toContain('2026-03-01 10:00');
    expect(allOutput).toContain('2026-03-02 14:00');
    expect(allOutput).not.toContain('job-done');
  });

  it('should show both scheduled and in-progress jobs', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValueOnce([
      { ...completeJob, id: 'job-s', status: 'scheduled', output: { scheduledAt: '2026-03-01 10:00' } },
      { ...completeJob, id: 'job-d', status: 'drafting' },
    ] as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
    });

    await handleQueue(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Scheduled');
    expect(allOutput).toContain('In Progress');
    expect(allOutput).toContain('job-s');
    expect(allOutput).toContain('job-d');
  });
});
