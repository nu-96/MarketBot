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

import { handleRepurpose, handleTrending } from '../../../src/cli/handlers/content';

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

describe('handleRepurpose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept a description via topic in parsed and show repurpose info', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/repurpose',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/repurpose blog to twitter thread',
        isNLP: false,
        topic: 'blog to twitter thread',
      } as ParsedCommand,
    });

    const result = await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('blog to twitter thread'))).toBe(true);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('not yet implemented'))).toBe(true);
    expect(result.session.lastHandler).toBe('/repurpose');
  });

  it('should extract description from rawInput when topic is not set', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/repurpose',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/repurpose newsletter to linkedin post',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('newsletter to linkedin post'))).toBe(true);
    expect(result.session.lastHandler).toBe('/repurpose');
  });

  it('should show usage info when no description is provided', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/repurpose',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/repurpose',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('Usage:'))).toBe(true);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('repurpose'))).toBe(true);
    // Should not set lastHandler since it showed usage and returned early
    expect(result.session.lastHandler).toBeNull();
  });

  it('should show usage example with blog to twitter', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/repurpose',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/repurpose',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('Example:'))).toBe(true);
  });

  it('should mention content repurposing is not yet implemented', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/repurpose',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/repurpose article to instagram captions',
        isNLP: false,
        topic: 'article to instagram captions',
      } as ParsedCommand,
    });

    await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('not yet implemented'))).toBe(true);
  });
});

describe('handleTrending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should output trending info message', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/trending',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/trending',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleTrending(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('trending'))).toBe(true);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('not yet implemented'))).toBe(true);
    expect(result.session.lastHandler).toBe('/trending');
  });

  it('should show filter when a topic is provided via parsed.topic', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/trending',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/trending AI marketing',
        isNLP: false,
        topic: 'AI marketing',
      } as ParsedCommand,
    });

    const result = await handleTrending(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('AI marketing'))).toBe(true);
    expect(result.session.lastHandler).toBe('/trending');
  });

  it('should show filter when a topic is provided via subcommand', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/trending',
        subcommand: 'fintech',
        args: [],
        flags: {},
        rawInput: '/trending fintech',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleTrending(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('fintech'))).toBe(true);
    expect(result.session.lastHandler).toBe('/trending');
  });

  it('should mention social platforms and news sources in not-implemented message', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/trending',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/trending',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleTrending(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('social platforms') || msg.toLowerCase().includes('news sources'))).toBe(true);
  });

  it('should not show filter line when no topic is given', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/trending',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/trending',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleTrending(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.every((msg: string) => !msg.includes('Filter:'))).toBe(true);
  });

  it('should extract topic from rawInput when topic and subcommand are not set', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/trending',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/trending content marketing',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleTrending(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('content marketing'))).toBe(true);
    expect(result.session.lastHandler).toBe('/trending');
  });
});
