import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as readline from 'readline';

// Mock all external dependencies
vi.mock('../../src/core/state-store', () => ({
  stateStore: {
    createJob: vi.fn().mockImplementation(async (job: any) => ({
      ...job,
      iteration: 0,
      maxIterations: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    getJob: vi.fn().mockResolvedValue(null),
    updateJob: vi.fn().mockImplementation(async (id: string, updates: any) => ({
      id,
      ...updates,
      updatedAt: new Date().toISOString(),
    })),
    getJobsByClient: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../src/memory/client-store', () => ({
  clientStore: {
    getProfile: vi.fn().mockResolvedValue(null),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    getBrandVoice: vi.fn().mockResolvedValue(null),
    getContentPillars: vi.fn().mockResolvedValue([]),
    searchClientContext: vi.fn().mockResolvedValue([]),
    searchByFileName: vi.fn().mockResolvedValue([]),
    storeClientContext: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/cli/pipeline', () => ({
  runPipeline: vi.fn().mockResolvedValue({
    id: 'job-int-123',
    status: 'complete',
    clientId: 'acme',
    type: 'social_post',
    input: { topic: 'AI' },
    iteration: 1,
    maxIterations: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    output: { content: 'Integration test response' },
    review: { score: 92 },
  }),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Integration test response' }],
      }),
    },
  })),
}));

import { parse } from '../../src/cli/parser';
import { CommandRouter, HandlerContext } from '../../src/cli/router';
import { createSession, withClient, withLastCommand, Session } from '../../src/cli/session';
import { handleHelp } from '../../src/cli/handlers/help';
import { handleClient } from '../../src/cli/handlers/client';
import { handleStatus } from '../../src/cli/handlers/status';
import { handleWrite } from '../../src/cli/handlers/write';
import { handleApprove } from '../../src/cli/handlers/approval';
import { clientStore } from '../../src/memory/client-store';
import { stateStore } from '../../src/core/state-store';

function mockRL(answers: string[] = []) {
  let i = 0;
  return {
    question: vi.fn((_q: string, cb: (a: string) => void) => cb(answers[i++] || '')),
  } as unknown as readline.Interface;
}

function buildCtx(input: string, session: Session, rlAnswers: string[] = []): { ctx: HandlerContext; outputLines: string[] } {
  const parsed = parse(input);
  const outputLines: string[] = [];
  return {
    ctx: {
      session,
      parsed,
      rl: mockRL(rlAnswers),
      output: (text: string) => outputLines.push(text),
    },
    outputLines,
  };
}

describe('CLI Integration Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete a full session flow: help → client create → client switch → status', async () => {
    let session = createSession();
    let outputLines: string[];
    let ctx: HandlerContext;

    // Step 1: /help
    ({ ctx, outputLines } = buildCtx('/help', session));
    const helpResult = await handleHelp(ctx);
    session = helpResult.session;
    expect(outputLines.some(l => l.includes('/write'))).toBe(true);
    expect(session.lastHandler).toBe('/help');

    // Step 2: /client new "Test Corp" SaaS (auto-generates ID "test-corp")
    ({ ctx, outputLines } = buildCtx('/client new "Test Corp" SaaS', session));
    const clientResult = await handleClient(ctx);
    session = clientResult.session;
    expect(clientStore.saveProfile).toHaveBeenCalledWith('test-corp', expect.objectContaining({
      id: 'test-corp',
      name: 'Test Corp',
      industry: 'SaaS',
    }));
    expect(session.activeClientId).toBe('test-corp');

    // Step 3: /client switch test-corp
    (clientStore.getProfile as any).mockResolvedValueOnce({
      id: 'test-corp', name: 'Test Corp', industry: 'SaaS',
    });
    ({ ctx, outputLines } = buildCtx('/client switch test-corp', session));
    const switchResult = await handleClient(ctx);
    session = switchResult.session;
    expect(session.activeClientId).toBe('test-corp');
    expect(outputLines.some(l => l.includes('Switched'))).toBe(true);

    // Step 4: /status (no jobs yet)
    ({ ctx, outputLines } = buildCtx('/status', session));
    const statusResult = await handleStatus(ctx);
    session = statusResult.session;
    expect(outputLines.some(l => l.includes('No jobs'))).toBe(true);
  });

  it('should parse and route NLP input to /write', async () => {
    const router = new CommandRouter();
    const writeHandler = vi.fn(async (ctx: HandlerContext) => {
      ctx.output('write called');
      return { session: ctx.session };
    });
    router.register('/write', writeHandler);

    const session = withClient(createSession(), 'acme');
    const parsed = parse('write a LinkedIn post about AI trends');
    expect(parsed.command).toBe('/write');
    expect(parsed.isNLP).toBe(true);
    expect(parsed.platform).toBe('linkedin');

    const outputLines: string[] = [];
    const ctx: HandlerContext = {
      session,
      parsed,
      rl: mockRL(),
      output: (t) => outputLines.push(t),
    };

    await router.route(ctx);
    expect(writeHandler).toHaveBeenCalled();
  });

  it('should handle aliases correctly through parsing', () => {
    expect(parse('/w').command).toBe('/write');
    expect(parse('/q').command).toBe('/quick');
    expect(parse('/c list').command).toBe('/client');
    expect(parse('/c list').subcommand).toBe('list');
    expect(parse('/s').command).toBe('/status');
    expect(parse('/?').command).toBe('/help');
  });

  it('should handle invalid commands gracefully', async () => {
    const router = new CommandRouter();
    const session = createSession();
    const outputLines: string[] = [];
    const parsed = parse('/foobar');

    const ctx: HandlerContext = {
      session,
      parsed,
      rl: mockRL(),
      output: (t) => outputLines.push(t),
    };

    const result = await router.route(ctx);
    expect(result.session).toBe(session); // session unchanged
    expect(outputLines.some(l => l.includes('Unknown command'))).toBe(true);
  });

  it('should not crash on any input through the full pipeline', async () => {
    const router = new CommandRouter();
    router.register('/help', handleHelp);
    router.register('/status', handleStatus);

    const tricky = [
      '', '  ', '/unknown', '////', '/help', '/status',
      'random text', '🚀', '/write --flag=',
      'write a post about nothing',
    ];

    for (const input of tricky) {
      const parsed = parse(input);
      const ctx: HandlerContext = {
        session: createSession(),
        parsed,
        rl: mockRL(),
        output: vi.fn(),
      };

      // Should never throw
      await expect(router.route(ctx)).resolves.toBeDefined();
    }
  });

  it('should maintain session state across commands', async () => {
    let session = createSession();

    // /help
    const { ctx: helpCtx } = buildCtx('/help', session);
    const helpResult = await handleHelp(helpCtx);
    session = helpResult.session;
    expect(session.lastHandler).toBe('/help');

    // /status — session carries forward
    const { ctx: statusCtx } = buildCtx('/status', session);
    const statusResult = await handleStatus(statusCtx);
    session = statusResult.session;
    expect(session.lastHandler).toBe('/status');
  });

  it('should handle approval flow', async () => {
    const session = createSession();

    // Mock a job in human_review
    (stateStore.getJob as any).mockResolvedValueOnce({
      id: 'job-1', clientId: 'acme', type: 'social_post', status: 'human_review',
      input: { topic: 'AI' }, iteration: 1, maxIterations: 3,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    });

    const { ctx, outputLines } = buildCtx('/approve job-1', session);
    const result = await handleApprove(ctx);

    expect(stateStore.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'complete' }));
    expect(outputLines.some(l => l.includes('approved'))).toBe(true);
  });
});
