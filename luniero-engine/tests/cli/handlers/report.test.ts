import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as readline from 'readline';
import { HandlerContext } from '../../../src/cli/router';
import { createSession } from '../../../src/cli/session';

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

import { handleReport } from '../../../src/cli/handlers/report';
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
    parsed: { command: '', subcommand: '', args: [], flags: {}, rawInput: '', isNLP: false },
    rl: mockRL(),
    output: vi.fn(),
    ...overrides,
  };
}

describe('handleReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should require a client', async () => {
    const ctx = mockCtx({ rl: mockRL(['']) });
    const result = await handleReport(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('client is required'),
    );
  });

  it('should show no jobs when empty', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValue([]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/report',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/report',
        isNLP: false,
      },
    });

    const result = await handleReport(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('No jobs'),
    );
  });

  it('should show analytics', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValue([
      {
        id: 'j1',
        clientId: 'acme',
        type: 'social_post',
        status: 'complete',
        input: { topic: 'AI' },
        iteration: 2,
        maxIterations: 3,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 'j2',
        clientId: 'acme',
        type: 'blog_post',
        status: 'failed',
        input: { topic: 'Cloud' },
        iteration: 0,
        maxIterations: 3,
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        error: 'timeout',
      },
      {
        id: 'j3',
        clientId: 'acme',
        type: 'social_post',
        status: 'drafting',
        input: { topic: 'ML' },
        iteration: 1,
        maxIterations: 3,
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      },
    ]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/report',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/report',
        isNLP: false,
      },
    });

    const result = await handleReport(ctx);

    const allOutput = (ctx.output as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0])
      .join('\n');

    expect(allOutput).toContain('Total Jobs:');
    expect(allOutput).toContain('Completed:');
    expect(allOutput).toContain('Failed:');
  });

  it('should update lastHandler', async () => {
    vi.mocked(stateStore.getJobsByClient).mockResolvedValue([]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/report',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/report',
        isNLP: false,
      },
    });

    const result = await handleReport(ctx);

    expect(result.session.lastHandler).toBe('/report');
  });
});
