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

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Quick response here' }],
      }),
    };
  });
  return { default: MockAnthropic };
});

import { handleQuick } from '../../../src/cli/handlers/quick';
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

describe('handleQuick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(result.session.lastHandler).toBe('/quick');
  });
});
