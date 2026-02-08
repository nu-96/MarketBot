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
    searchClientContext: vi.fn().mockResolvedValue([]),
    searchByFileName: vi.fn().mockResolvedValue([]),
  },
}));

const { mockCreate } = vi.hoisted(() => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Quick response here' }],
  });
  return { mockCreate };
});

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = { create: mockCreate };
  });
  return { default: MockAnthropic };
});

import { handleQuick } from '../../../src/cli/handlers/quick';
import { clientStore } from '../../../src/memory/client-store';
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

describe('handleQuick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('should require a client', async () => {
    const ctx = mockCtx({ rl: mockRL(['']) });
    const result = await handleQuick(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('client is required'),
    );
  });

  it('should require a prompt', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/quick', subcommand: '', args: [], flags: {}, rawInput: '/quick', isNLP: false },
      rl: mockRL(['']),
    });
    const result = await handleQuick(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('prompt is required'),
    );
  });

  it('should call LLM and show response', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme',
      name: 'Acme',
      industry: 'SaaS',
      description: '',
      goals: [],
      platforms: [],
      contacts: [],
      preferences: {},
    });

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/quick',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/quick give me headline ideas',
        isNLP: false,
      },
    });

    const result = await handleQuick(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('Quick response here'),
    );
    // Should show task complete
    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('Ready for next command'),
    );
    expect(result.session.lastHandler).toBe('/quick');
  });

  it('should include content pillars in system prompt', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });
    vi.mocked(clientStore.getContentPillars).mockResolvedValue(['AI trends', 'Cloud']);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/quick', subcommand: '', args: [], flags: {}, rawInput: '/quick post about AI', isNLP: false },
    });

    await handleQuick(ctx);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('AI trends'),
      }),
      expect.anything(),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Cloud'),
      }),
      expect.anything(),
    );
  });

  it('should include brand voice vocabulary in system prompt', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });
    vi.mocked(clientStore.getBrandVoice).mockResolvedValue({
      tone: 'professional', avoid: ['slang'], examples: [], vocabulary: ['innovation', 'synergy'],
    });

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/quick', subcommand: '', args: [], flags: {}, rawInput: '/quick post ideas', isNLP: false },
    });

    await handleQuick(ctx);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('innovation'),
      }),
      expect.anything(),
    );
  });

  it('should include vector context in system prompt', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });
    vi.mocked(clientStore.searchClientContext).mockResolvedValue([
      { text: 'We focus on enterprise AI solutions', type: 'preference', score: 0.9 },
    ]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/quick', subcommand: '', args: [], flags: {}, rawInput: '/quick post about our products', isNLP: false },
    });

    await handleQuick(ctx);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('enterprise AI solutions'),
      }),
      expect.anything(),
    );
  });

  it('should store conversation messages in session', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/quick', subcommand: '', args: [], flags: {}, rawInput: '/quick tell me about AI', isNLP: false },
    });

    const result = await handleQuick(ctx);

    expect(result.session.conversationMessages.length).toBe(2);
    expect(result.session.conversationMessages[0].role).toBe('user');
    expect(result.session.conversationMessages[1].role).toBe('assistant');
    expect(result.session.conversationMessages[1].content).toBe('Quick response here');
  });

  it('should continue conversation on follow-up', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });

    const ctx = mockCtx({
      session: createSession({
        activeClientId: 'acme',
        lastHandler: '/quick',
        conversationMessages: [
          { role: 'user', content: 'tell me about AI' },
          { role: 'assistant', content: 'AI is transforming marketing.' },
        ],
      }),
      parsed: { command: '/approve', subcommand: '', args: [], flags: {}, rawInput: 'yes tell me more', isNLP: true },
    });

    const result = await handleQuick(ctx);

    // Should have 4 messages: original 2 + follow-up user + follow-up assistant
    expect(result.session.conversationMessages.length).toBe(4);

    // Verify LLM received full conversation history
    const createCall = mockCreate.mock.calls[0];
    const messages = createCall[0].messages;
    expect(messages.length).toBe(3); // 2 existing + 1 new user message
    expect(messages[0].content).toBe('tell me about AI');
    expect(messages[1].content).toBe('AI is transforming marketing.');
    expect(messages[2].content).toBe('yes tell me more');

    // Should label as follow-up
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Follow-up'))).toBe(true);
  });

  it('should include document chunks in system prompt', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });
    vi.mocked(clientStore.searchByFileName).mockResolvedValue([
      { text: 'Q4 revenue grew 30% year-over-year', type: 'content', score: 1.0, metadata: { source: 'file_upload', fileName: 'quarterly-report.pdf' } },
    ]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/quick', subcommand: '', args: [], flags: {}, rawInput: '/quick post based on quarterly-report', isNLP: false, topic: 'quarterly-report' },
    });

    await handleQuick(ctx);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Q4 revenue grew 30%'),
      }),
      expect.anything(),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Source Document Content'),
      }),
      expect.anything(),
    );
  });

  it('should include client task status in system prompt', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue({
      id: 'acme', name: 'Acme', industry: 'SaaS',
      description: '', goals: [], platforms: [], contacts: [], preferences: {},
    });
    vi.mocked(stateStore.getJobsByClient).mockResolvedValue([
      {
        id: 'job-1', clientId: 'acme', type: 'content', status: 'complete',
        input: { topic: 'AI trends' }, iteration: 1, maxIterations: 3,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
      {
        id: 'job-2', clientId: 'acme', type: 'content', status: 'scheduled',
        input: { topic: 'Cloud migration' }, output: { scheduledAt: '2026-02-10T10:00:00Z' },
        iteration: 1, maxIterations: 3,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ] as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/quick', subcommand: '', args: [], flags: {}, rawInput: '/quick what should I post next', isNLP: false },
    });

    await handleQuick(ctx);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Client Task Status'),
      }),
      expect.anything(),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('scheduled for 2026-02-10T10:00:00Z'),
      }),
      expect.anything(),
    );
  });
});
