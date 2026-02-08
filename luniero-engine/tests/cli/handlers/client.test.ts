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

import { handleClient } from '../../../src/cli/handlers/client';
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

describe('handleClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show error for unknown subcommand', async () => {
    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'xyz', args: [], flags: {}, rawInput: '/client xyz', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Unknown subcommand'))).toBe(true);
  });

  it('should switch client when profile exists', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValueOnce({ id: 'acme', name: 'Acme Corp', industry: 'SaaS' } as any);

    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'switch', args: ['acme'], flags: {}, rawInput: '/client switch acme', isNLP: false } as ParsedCommand,
    });

    const result = await handleClient(ctx);

    expect(result.session.activeClientId).toBe('acme');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Switched'))).toBe(true);
  });

  it('should show error switching to unknown client', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValueOnce(null);

    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'switch', args: ['ghost'], flags: {}, rawInput: '/client switch ghost', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('not found'))).toBe(true);
  });

  it('should create new client', async () => {
    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'new', args: ['test', 'Test Corp', 'SaaS'], flags: {}, rawInput: '/client new test "Test Corp" SaaS', isNLP: false } as ParsedCommand,
    });

    const result = await handleClient(ctx);

    expect(clientStore.saveProfile).toHaveBeenCalledWith('test', expect.objectContaining({
      id: 'test',
      name: 'Test Corp',
      industry: 'SaaS',
    }));
    expect(result.session.activeClientId).toBe('test');
  });

  it('should show brand voice', async () => {
    vi.mocked(clientStore.getBrandVoice).mockResolvedValueOnce({
      tone: 'professional',
      avoid: ['slang'],
      examples: [],
      vocabulary: ['innovation'],
    } as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'voice', args: [], flags: {}, rawInput: '/client voice', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('professional'))).toBe(true);
  });

  it('should show content pillars', async () => {
    vi.mocked(clientStore.getContentPillars).mockResolvedValueOnce(['AI', 'Cloud'] as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'pillars', args: [], flags: {}, rawInput: '/client pillars', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('AI');
    expect(allOutput).toContain('Cloud');
  });

  it('should require active client for voice', async () => {
    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'voice', args: [], flags: {}, rawInput: '/client voice', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no active client'))).toBe(true);
  });

  it('should show client info with default subcommand', async () => {
    vi.mocked(clientStore.getProfile).mockResolvedValueOnce({ id: 'acme', name: 'Acme Corp', industry: 'SaaS', description: '', goals: [], platforms: [], contacts: [], preferences: {} } as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: '', args: [], flags: {}, rawInput: '/client', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.length).toBeGreaterThan(0);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Acme Corp');
  });
});
