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
    content: [{ type: 'text', text: 'Calendar content here' }],
  });
  return { mockCreate };
});

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = { create: mockCreate };
  });
  return { default: MockAnthropic };
});

import { handleCalendar } from '../../../src/cli/handlers/calendar';
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
    parsed: { command: '', subcommand: '', args: [], flags: {}, rawInput: '', isNLP: false },
    rl: mockRL(),
    output: vi.fn(),
    ...overrides,
  };
}

const acmeProfile = {
  id: 'acme',
  name: 'Acme',
  industry: 'SaaS',
  description: 'A SaaS company',
  goals: [],
  platforms: [{ platform: 'linkedin', handle: '@acme', frequency: 'daily' }],
  contacts: [],
  preferences: {},
};

describe('handleCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('should require a client', async () => {
    const ctx = mockCtx({ rl: mockRL(['']) });
    const result = await handleCalendar(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('client is required'),
    );
  });

  it('should show usage hint when client is missing', async () => {
    const ctx = mockCtx({ rl: mockRL(['']) });
    await handleCalendar(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('client is required');
    expect(allOutput).toContain('/calendar');
  });

  it('should generate calendar with default 2 weeks', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/calendar',
        isNLP: false,
      },
    });

    await handleCalendar(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('2 weeks'),
    );
    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('Calendar content here'),
    );
  });

  it('should use --weeks flag for custom duration', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: { weeks: '4' },
        rawInput: '/calendar --weeks 4',
        isNLP: false,
      },
    });

    await handleCalendar(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('4 weeks'),
    );
  });

  it('should use positional arg for week count', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: ['3'],
        flags: {},
        rawInput: '/calendar 3',
        isNLP: false,
      },
    });

    await handleCalendar(ctx);

    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('3 weeks'),
    );
  });

  it('should include content pillars in prompt', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);
    vi.mocked(clientStore.getContentPillars).mockResolvedValue(['AI trends', 'Sustainability']);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/calendar',
        isNLP: false,
      },
    });

    await handleCalendar(ctx);

    // Verify the system prompt sent to the LLM includes pillars
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('AI trends'),
      }),
      expect.anything(),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('Sustainability'),
      }),
      expect.anything(),
    );
  });

  it('should include focus theme when provided via NLP topic', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/calendar',
        isNLP: false,
        topic: 'product launches',
      },
    });

    await handleCalendar(ctx);

    const call = mockCreate.mock.calls[0];
    const userMessage = call[0].messages[call[0].messages.length - 1].content;
    expect(userMessage).toContain('product launches');
  });

  it('should set lastHandler to /calendar', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/calendar',
        isNLP: false,
      },
    });

    const result = await handleCalendar(ctx);

    expect(result.session.lastHandler).toBe('/calendar');
  });

  it('should clear pending approval', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme', pendingApproval: 'some-old-job' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/calendar',
        isNLP: false,
      },
    });

    const result = await handleCalendar(ctx);

    expect(result.session.pendingApproval).toBeNull();
  });

  it('should work without a client profile (null profile)', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(null);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/calendar',
        isNLP: false,
      },
    });

    await handleCalendar(ctx);

    // Should still generate a calendar even without profile
    expect(ctx.output).toHaveBeenCalledWith(
      expect.stringContaining('Calendar content here'),
    );
  });

  it('should show task complete indicator', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/calendar',
        isNLP: false,
      },
    });

    await handleCalendar(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Ready for next command');
  });

  it('should store conversation messages in session', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/calendar',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/calendar',
        isNLP: false,
      },
    });

    const result = await handleCalendar(ctx);

    expect(result.session.conversationMessages.length).toBe(2);
    expect(result.session.conversationMessages[0].role).toBe('user');
    expect(result.session.conversationMessages[1].role).toBe('assistant');
    expect(result.session.conversationMessages[1].content).toBe('Calendar content here');
  });

  it('should continue conversation on follow-up', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({
        activeClientId: 'acme',
        lastHandler: '/calendar',
        conversationMessages: [
          { role: 'user', content: 'Create a 2-week content calendar.' },
          { role: 'assistant', content: 'Here is your calendar.' },
        ],
      }),
      parsed: { command: '/approve', subcommand: '', args: [], flags: {}, rawInput: 'add more LinkedIn posts', isNLP: true },
    });

    const result = await handleCalendar(ctx);

    // Should have 4 messages: original 2 + follow-up user + follow-up assistant
    expect(result.session.conversationMessages.length).toBe(4);

    // Verify LLM received full conversation history
    const createCall = mockCreate.mock.calls[0];
    const messages = createCall[0].messages;
    expect(messages.length).toBe(3); // 2 existing + 1 new user message
    expect(messages[0].content).toBe('Create a 2-week content calendar.');
    expect(messages[1].content).toBe('Here is your calendar.');
    expect(messages[2].content).toBe('add more LinkedIn posts');

    // Should label as follow-up
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Follow-up'))).toBe(true);
  });
});
