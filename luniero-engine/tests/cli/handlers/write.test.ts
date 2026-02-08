import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as readline from 'readline';
import { HandlerContext } from '../../../src/cli/router';
import { createSession } from '../../../src/cli/session';

vi.mock('../../../src/core/state-store', () => ({
  stateStore: {
    getJob: vi.fn(),
    updateJob: vi.fn(),
    getJobsByClient: vi.fn().mockResolvedValue([]),
    createJob: vi.fn().mockImplementation(async (job: any) => ({
      ...job,
      iteration: 0,
      maxIterations: job.maxIterations || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  },
}));

vi.mock('../../../src/memory/client-store', () => ({
  clientStore: {
    getProfile: vi.fn().mockResolvedValue(null),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    getBrandVoice: vi.fn().mockResolvedValue(null),
    getContentPillars: vi.fn().mockResolvedValue([]),
    searchClientContext: vi.fn().mockResolvedValue([]),
    searchByFileName: vi.fn().mockResolvedValue([]),
    storeClientContext: vi.fn().mockResolvedValue(undefined),
    getVectorStats: vi.fn().mockResolvedValue({ totalVectors: 0, documents: [] }),
  },
}));

vi.mock('../../../src/cli/pipeline', () => ({
  runPipeline: vi.fn().mockResolvedValue({
    id: 'job-123',
    status: 'complete',
    clientId: 'acme',
    type: 'social_post',
    input: { topic: 'AI' },
    iteration: 1,
    maxIterations: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    output: { content: 'Hello world' },
    review: { score: 85 },
  }),
}));

import { handleWrite } from '../../../src/cli/handlers/write';
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
    parsed: { command: '', subcommand: '', args: [], flags: {}, rawInput: '', isNLP: false },
    rl: mockRL(),
    output: vi.fn(),
    ...overrides,
  };
}

describe('handleWrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('should require a client', async () => {
    const ctx = mockCtx({ rl: mockRL(['']) });
    const result = await handleWrite(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('client is required'),
    );
    expect(result.session.lastJobId).toBeNull();
  });

  it('should require a topic', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      rl: mockRL(['']),
    });
    const result = await handleWrite(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('topic is required'),
    );
  });

  it('should create job and run pipeline', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/write',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/write',
        isNLP: false,
        topic: 'AI trends',
      },
    });

    const result = await handleWrite(ctx);

    expect(runPipeline).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ onStage: expect.any(Function) }),
    );
    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('Job created'),
    );
    expect(result.session.lastJobId).toBeDefined();
  });

  it('should update session lastHandler', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/write',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/write',
        isNLP: false,
        topic: 'AI trends',
      },
    });

    const result = await handleWrite(ctx);

    expect(result.session.lastHandler).toBe('/write');
  });
});
