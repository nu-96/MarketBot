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
    content: [{ type: 'text', text: 'LLM response content' }],
  });
  return { mockCreate };
});

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = { create: mockCreate };
  });
  return { default: MockAnthropic };
});

import { handleRepurpose, handleTrending } from '../../../src/cli/handlers/content';
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
    parsed: { command: '', subcommand: '', args: [], flags: {}, rawInput: '', isNLP: false } as ParsedCommand,
    rl: mockRL(),
    output: vi.fn(),
    ...overrides,
  };
}

const acmeProfile = {
  id: 'acme',
  name: 'Acme',
  industry: 'SaaS',
  description: '',
  goals: [],
  platforms: [],
  contacts: [],
  preferences: {},
};

describe('handleRepurpose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('should show usage info when no args provided', async () => {
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
    expect(calls.some((msg: string) => msg.includes('<id> from <old-type> to <new-type>'))).toBe(true);
    expect(result.session.lastHandler).toBeNull();
  });

  it('should show error on invalid format (missing from/to)', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/repurpose',
        subcommand: 'blog',
        args: ['to', 'twitter'],
        flags: {},
        rawInput: '/repurpose blog to twitter',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('invalid format'))).toBe(true);
  });

  it('should require a client', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/repurpose',
        subcommand: 'job-12',
        args: ['from', 'blog', 'to', 'twitter', 'thread'],
        flags: {},
        rawInput: '/repurpose job-12 from blog to twitter thread',
        isNLP: false,
      } as ParsedCommand,
      rl: mockRL(['']),
    });

    await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('client') && msg.toLowerCase().includes('required'))).toBe(true);
  });

  it('should error when job not found', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);
    vi.mocked(stateStore.getJob).mockResolvedValue(null);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/repurpose',
        subcommand: 'job-99',
        args: ['from', 'blog', 'to', 'twitter', 'thread'],
        flags: {},
        rawInput: '/repurpose job-99 from blog to twitter thread',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('job-99') && msg.toLowerCase().includes('not found'))).toBe(true);
  });

  it('should error when job has no content', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);
    vi.mocked(stateStore.getJob).mockResolvedValue({
      id: 'job-12', clientId: 'acme', type: 'content', status: 'complete',
      input: {}, iteration: 1, maxIterations: 3,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/repurpose',
        subcommand: 'job-12',
        args: ['from', 'blog', 'to', 'twitter', 'thread'],
        flags: {},
        rawInput: '/repurpose job-12 from blog to twitter thread',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('no content'))).toBe(true);
  });

  it('should repurpose job content and set pending approval', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);
    vi.mocked(stateStore.getJob).mockResolvedValue({
      id: 'job-12', clientId: 'acme', type: 'content', status: 'complete',
      input: {}, output: { content: 'Original blog post about AI trends.' },
      iteration: 1, maxIterations: 3,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any);
    vi.mocked(stateStore.createJob).mockResolvedValue({} as any);
    vi.mocked(stateStore.updateJob).mockResolvedValue({} as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/repurpose',
        subcommand: 'job-12',
        args: ['from', 'blog', 'to', 'twitter', 'thread'],
        flags: {},
        rawInput: '/repurpose job-12 from blog to twitter thread',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleRepurpose(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('LLM response content'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('awaiting approval'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('approve'))).toBe(true);
    expect(result.session.lastHandler).toBe('/repurpose');
    expect(result.session.pendingApproval).toBeTruthy();

    // Verify a job was created with human_review status
    expect(stateStore.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'acme',
        status: 'human_review',
        type: 'repurpose',
      }),
    );
    // Verify output was set via updateJob
    expect(stateStore.updateJob).toHaveBeenCalledWith(
      expect.stringContaining('repurpose-job-12'),
      expect.objectContaining({
        output: { content: 'LLM response content' },
      }),
    );

    // Verify LLM received the source content with from/to types
    const createCall = mockCreate.mock.calls[0];
    const userMsg = createCall[0].messages[createCall[0].messages.length - 1].content;
    expect(userMsg).toContain('blog');
    expect(userMsg).toContain('twitter thread');
    expect(userMsg).toContain('Original blog post about AI trends.');
  });

  it('should fall back to draft content when no output', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);
    vi.mocked(stateStore.getJob).mockResolvedValue({
      id: 'job-5', clientId: 'acme', type: 'content', status: 'drafting',
      input: {}, draft: { content: 'Draft newsletter content.' },
      iteration: 1, maxIterations: 3,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any);
    vi.mocked(stateStore.createJob).mockResolvedValue({} as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/repurpose',
        subcommand: 'job-5',
        args: ['from', 'newsletter', 'to', 'linkedin', 'post'],
        flags: {},
        rawInput: '/repurpose job-5 from newsletter to linkedin post',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleRepurpose(ctx);

    const createCall = mockCreate.mock.calls[0];
    const userMsg = createCall[0].messages[createCall[0].messages.length - 1].content;
    expect(userMsg).toContain('Draft newsletter content.');
    expect(userMsg).toContain('newsletter');
    expect(userMsg).toContain('linkedin post');
  });

  it('should store conversation messages in session', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);
    vi.mocked(stateStore.getJob).mockResolvedValue({
      id: 'job-12', clientId: 'acme', type: 'content', status: 'complete',
      input: {}, output: { content: 'Blog post.' },
      iteration: 1, maxIterations: 3,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as any);
    vi.mocked(stateStore.createJob).mockResolvedValue({} as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/repurpose',
        subcommand: 'job-12',
        args: ['from', 'blog', 'to', 'twitter', 'thread'],
        flags: {},
        rawInput: '/repurpose job-12 from blog to twitter thread',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleRepurpose(ctx);

    expect(result.session.conversationMessages.length).toBe(2);
    expect(result.session.conversationMessages[0].role).toBe('user');
    expect(result.session.conversationMessages[1].role).toBe('assistant');
    expect(result.session.conversationMessages[1].content).toBe('LLM response content');
  });

  it('should continue conversation on follow-up and update pending job', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);
    vi.mocked(stateStore.updateJob).mockResolvedValue({} as any);

    const ctx = mockCtx({
      session: createSession({
        activeClientId: 'acme',
        lastHandler: '/repurpose',
        pendingApproval: 'repurpose-job-12-123',
        conversationMessages: [
          { role: 'user', content: 'Repurpose the following blog content into a twitter thread:\n\nBlog post.' },
          { role: 'assistant', content: 'Here is your twitter thread.' },
        ],
      }),
      parsed: { command: '/approve', subcommand: '', args: [], flags: {}, rawInput: 'make it more casual', isNLP: true } as ParsedCommand,
    });

    const result = await handleRepurpose(ctx);

    expect(result.session.conversationMessages.length).toBe(4);
    expect(result.session.pendingApproval).toBe('repurpose-job-12-123');

    // Verify pending job output was updated
    expect(stateStore.updateJob).toHaveBeenCalledWith('repurpose-job-12-123', {
      output: { content: 'LLM response content' },
    });

    const createCall = mockCreate.mock.calls[0];
    const messages = createCall[0].messages;
    expect(messages.length).toBe(3);
    expect(messages[2].content).toBe('make it more casual');

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Follow-up'))).toBe(true);
  });
});

describe('handleTrending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  it('should require a client', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/trending',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/trending',
        isNLP: false,
      } as ParsedCommand,
      rl: mockRL(['']),
    });

    const result = await handleTrending(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('client') && msg.toLowerCase().includes('required'))).toBe(true);
  });

  it('should call LLM and show trending output', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
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
    expect(calls.some((msg: string) => msg.includes('LLM response content'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('Ready for next command'))).toBe(true);
    expect(result.session.lastHandler).toBe('/trending');
  });

  it('should extract topic from subcommand', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/trending',
        subcommand: 'fintech',
        args: [],
        flags: {},
        rawInput: '/trending fintech',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleTrending(ctx);

    const createCall = mockCreate.mock.calls[0];
    const userMsg = createCall[0].messages[createCall[0].messages.length - 1].content;
    expect(userMsg).toContain('fintech');
  });

  it('should store conversation messages in session', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
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

    expect(result.session.conversationMessages.length).toBe(2);
    expect(result.session.conversationMessages[0].role).toBe('user');
    expect(result.session.conversationMessages[1].role).toBe('assistant');
    expect(result.session.conversationMessages[1].content).toBe('LLM response content');
  });

  it('should continue conversation on follow-up', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValue(acmeProfile);

    const ctx = mockCtx({
      session: createSession({
        activeClientId: 'acme',
        lastHandler: '/trending',
        conversationMessages: [
          { role: 'user', content: 'Analyze trending topics in SaaS' },
          { role: 'assistant', content: 'Here are the top trends.' },
        ],
      }),
      parsed: { command: '/approve', subcommand: '', args: [], flags: {}, rawInput: 'elaborate on trend 3', isNLP: true } as ParsedCommand,
    });

    const result = await handleTrending(ctx);

    expect(result.session.conversationMessages.length).toBe(4);

    const createCall = mockCreate.mock.calls[0];
    const messages = createCall[0].messages;
    expect(messages.length).toBe(3);
    expect(messages[2].content).toBe('elaborate on trend 3');

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Follow-up'))).toBe(true);
  });
});
