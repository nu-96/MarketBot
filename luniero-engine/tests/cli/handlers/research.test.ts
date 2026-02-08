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

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Research findings here' }],
      }),
    };
  });
  return { default: MockAnthropic };
});

import { handleResearch } from '../../../src/cli/handlers/research';

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

describe('handleResearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should require a client', async () => {
    const ctx = mockCtx();
    await handleResearch(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('client') && msg.toLowerCase().includes('required'))).toBe(true);
  });

  it('should require a topic', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/research', subcommand: '', args: [], flags: {}, rawInput: '/research', isNLP: false } as ParsedCommand,
      rl: mockRL(['']),
    });

    await handleResearch(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('topic') && msg.toLowerCase().includes('required'))).toBe(true);
  });

  it('should call LLM and show research', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/research', subcommand: '', args: [], flags: {}, rawInput: '/research AI trends', topic: 'AI trends', isNLP: false } as ParsedCommand,
    });

    await handleResearch(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Research findings here'))).toBe(true);
  });

  it('should update lastHandler', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/research', subcommand: '', args: [], flags: {}, rawInput: '/research AI trends', topic: 'AI trends', isNLP: false } as ParsedCommand,
    });

    const result = await handleResearch(ctx);
    expect(result.session.lastHandler).toBe('/research');
  });
});
