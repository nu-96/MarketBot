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
    searchClientContext: vi.fn().mockResolvedValue([]),
    searchByFileName: vi.fn().mockResolvedValue([]),
  },
}));

const { mockCreate } = vi.hoisted(() => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Research findings here' }],
  });
  return { mockCreate };
});

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = { create: mockCreate };
  });
  return { default: MockAnthropic };
});

import { handleResearch } from '../../../src/cli/handlers/research';
import { clientStore } from '../../../src/memory/client-store';

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
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
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

  it('should store conversation messages in session', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/research', subcommand: '', args: [], flags: {}, rawInput: '/research AI trends', topic: 'AI trends', isNLP: false } as ParsedCommand,
    });

    const result = await handleResearch(ctx);

    expect(result.session.conversationMessages.length).toBe(2);
    expect(result.session.conversationMessages[0].role).toBe('user');
    expect(result.session.conversationMessages[1].role).toBe('assistant');
    expect(result.session.conversationMessages[1].content).toBe('Research findings here');
  });

  it('should continue conversation on follow-up', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });

    const ctx = mockCtx({
      session: createSession({
        activeClientId: 'acme',
        lastHandler: '/research',
        conversationMessages: [
          { role: 'user', content: 'Research: AI trends' },
          { role: 'assistant', content: 'Here are the AI trends.' },
        ],
      }),
      parsed: { command: '/approve', subcommand: '', args: [], flags: {}, rawInput: 'tell me more about point 2', isNLP: true } as ParsedCommand,
    });

    const result = await handleResearch(ctx);

    // Should have 4 messages: original 2 + follow-up user + follow-up assistant
    expect(result.session.conversationMessages.length).toBe(4);

    // Verify LLM received full conversation history
    const createCall = mockCreate.mock.calls[0];
    const messages = createCall[0].messages;
    expect(messages.length).toBe(3); // 2 existing + 1 new user message
    expect(messages[0].content).toBe('Research: AI trends');
    expect(messages[1].content).toBe('Here are the AI trends.');
    expect(messages[2].content).toBe('tell me more about point 2');

    // Should label as follow-up
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Follow-up'))).toBe(true);
  });

  it('should include brand voice in system prompt', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });
    vi.mocked(clientStore.getBrandVoice).mockResolvedValue({
      tone: 'professional', avoid: ['slang'], examples: [], vocabulary: ['innovation'],
    });

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/research', subcommand: '', args: [], flags: {}, rawInput: '/research AI trends', topic: 'AI trends', isNLP: false } as ParsedCommand,
    });

    await handleResearch(ctx);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('professional'),
      }),
      expect.anything(),
    );
  });
});
