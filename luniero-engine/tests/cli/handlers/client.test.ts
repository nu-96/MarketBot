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
    getAllClients: vi.fn().mockResolvedValue([]),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    getBrandVoice: vi.fn().mockResolvedValue(null),
    saveBrandVoice: vi.fn().mockResolvedValue(undefined),
    saveContentPillars: vi.fn().mockResolvedValue(undefined),
    getContentPillars: vi.fn().mockResolvedValue([]),
    storeClientContext: vi.fn().mockResolvedValue(undefined),
  },
}));

import { handleClient } from '../../../src/cli/handlers/client';
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

describe('handleClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should switch to base (deselect client)', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'base', args: [], flags: {}, rawInput: '/client base', isNLP: false } as ParsedCommand,
    });

    const result = await handleClient(ctx);

    expect(result.session.activeClientId).toBeNull();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('base'))).toBe(true);
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

  it('should create new client with auto-generated ID from name', async () => {
    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'new', args: ['Test Corp', 'SaaS'], flags: {}, rawInput: '/client new "Test Corp" SaaS', isNLP: false } as ParsedCommand,
    });

    const result = await handleClient(ctx);

    expect(clientStore.saveProfile).toHaveBeenCalledWith('test-corp', expect.objectContaining({
      id: 'test-corp',
      name: 'Test Corp',
      industry: 'SaaS',
    }));
    expect(clientStore.storeClientContext).toHaveBeenCalledWith('test-corp', expect.objectContaining({
      type: 'preference',
      metadata: { source: 'profile_creation' },
    }));
    expect(result.session.activeClientId).toBe('test-corp');
  });

  it('should append suffix when auto-generated ID already exists', async () => {
    // First call checks for duplicate (returns existing profile), second call is for saveProfile internals
    vi.mocked(clientStore.getProfile).mockResolvedValueOnce({ id: 'acme-corp', name: 'Acme Corp' } as any);

    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'new', args: ['Acme Corp', 'retail'], flags: {}, rawInput: '/client new "Acme Corp" retail', isNLP: false } as ParsedCommand,
    });

    const result = await handleClient(ctx);

    // ID should have a suffix appended (4 char hex)
    const savedId = vi.mocked(clientStore.saveProfile).mock.calls[0][0];
    expect(savedId).toMatch(/^acme-corp-[a-f0-9]{4}$/);
    expect(result.session.activeClientId).toBe(savedId);
  });

  it('should seed vector space on client creation', async () => {
    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'new', args: ['NewCo', 'technology'], flags: {}, rawInput: '/client new NewCo technology', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    expect(clientStore.storeClientContext).toHaveBeenCalledWith('newco', expect.objectContaining({
      type: 'preference',
      text: expect.stringContaining('technology'),
      metadata: { source: 'profile_creation' },
    }));
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

  it('should set brand voice interactively', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'voice', args: ['set'], flags: {}, rawInput: '/client voice set', isNLP: false } as ParsedCommand,
      rl: mockRL(['witty', 'jargon, buzzwords', 'innovation, disrupt']),
    });

    await handleClient(ctx);

    expect(clientStore.saveBrandVoice).toHaveBeenCalledWith('acme', {
      tone: 'witty',
      avoid: ['jargon', 'buzzwords'],
      examples: [],
      vocabulary: ['innovation', 'disrupt'],
    });
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Brand voice saved'))).toBe(true);
  });

  it('should require active client for voice set', async () => {
    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'voice', args: ['set'], flags: {}, rawInput: '/client voice set', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no active client'))).toBe(true);
  });

  it('should set content pillars interactively', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'pillars', args: ['set'], flags: {}, rawInput: '/client pillars set', isNLP: false } as ParsedCommand,
      rl: mockRL(['AI, Cloud, DevOps']),
    });

    await handleClient(ctx);

    expect(clientStore.saveContentPillars).toHaveBeenCalledWith('acme', ['AI', 'Cloud', 'DevOps']);
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('3 content pillar(s) saved'))).toBe(true);
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

  it('should add a content pillar inline', async () => {
    vi.mocked(clientStore.getContentPillars).mockResolvedValueOnce([]);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'pillars', args: ['add', 'AI', 'automation'], flags: {}, rawInput: '/client pillars add "AI automation"', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    expect(clientStore.saveContentPillars).toHaveBeenCalledWith('acme', ['AI automation']);
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Added pillar'))).toBe(true);
  });

  it('should add a pillar to existing pillars', async () => {
    vi.mocked(clientStore.getContentPillars).mockResolvedValueOnce(['Cloud']);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'pillars', args: ['add', 'DevOps'], flags: {}, rawInput: '/client pillars add DevOps', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    expect(clientStore.saveContentPillars).toHaveBeenCalledWith('acme', ['Cloud', 'DevOps']);
  });

  it('should not add duplicate pillar', async () => {
    vi.mocked(clientStore.getContentPillars).mockResolvedValueOnce(['AI']);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'pillars', args: ['add', 'AI'], flags: {}, rawInput: '/client pillars add AI', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    expect(clientStore.saveContentPillars).not.toHaveBeenCalled();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('already exists'))).toBe(true);
  });

  it('should remove a content pillar', async () => {
    vi.mocked(clientStore.getContentPillars).mockResolvedValueOnce(['AI', 'Cloud', 'DevOps']);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'pillars', args: ['remove', 'Cloud'], flags: {}, rawInput: '/client pillars remove Cloud', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    expect(clientStore.saveContentPillars).toHaveBeenCalledWith('acme', ['AI', 'DevOps']);
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('Removed pillar'))).toBe(true);
  });

  it('should show error removing nonexistent pillar', async () => {
    vi.mocked(clientStore.getContentPillars).mockResolvedValueOnce(['AI']);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'pillars', args: ['remove', 'Blockchain'], flags: {}, rawInput: '/client pillars remove Blockchain', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    expect(clientStore.saveContentPillars).not.toHaveBeenCalled();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('not found'))).toBe(true);
  });

  it('should require active client for pillars add', async () => {
    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'pillars', args: ['add', 'AI'], flags: {}, rawInput: '/client pillars add AI', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no active client'))).toBe(true);
  });

  it('should list all clients with job counts', async () => {
    vi.mocked(clientStore.getAllClients).mockResolvedValue([
      { id: 'acme', name: 'Acme Corp', industry: 'SaaS', description: '', goals: [], platforms: [{ platform: 'linkedin', handle: '@acme', frequency: 'daily' }], contacts: [], preferences: {} },
      { id: 'globex', name: 'Globex Inc', industry: 'Retail', description: '', goals: [], platforms: [], contacts: [], preferences: {} },
    ] as any);
    vi.mocked(stateStore.getJobsByClient)
      .mockResolvedValueOnce([{ id: 'j1', createdAt: '2026-01-15T00:00:00Z' }, { id: 'j2', createdAt: '2026-01-10T00:00:00Z' }] as any)
      .mockResolvedValueOnce([] as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'list', args: [], flags: {}, rawInput: '/client list', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Acme Corp');
    expect(allOutput).toContain('Globex Inc');
    expect(allOutput).toContain('SaaS');
    expect(allOutput).toContain('Retail');
  });

  it('should filter clients by industry', async () => {
    vi.mocked(clientStore.getAllClients).mockResolvedValue([
      { id: 'acme', name: 'Acme Corp', industry: 'SaaS', description: '', goals: [], platforms: [], contacts: [], preferences: {} },
      { id: 'globex', name: 'Globex Inc', industry: 'Retail', description: '', goals: [], platforms: [], contacts: [], preferences: {} },
    ] as any);

    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'list', args: [], flags: { industry: 'SaaS' }, rawInput: '/client list --industry=SaaS', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Acme Corp');
    expect(allOutput).not.toContain('Globex Inc');
  });

  it('should filter clients by search term', async () => {
    vi.mocked(clientStore.getAllClients).mockResolvedValue([
      { id: 'acme', name: 'Acme Corp', industry: 'SaaS', description: '', goals: [], platforms: [], contacts: [], preferences: {} },
      { id: 'globex', name: 'Globex Inc', industry: 'Retail', description: '', goals: [], platforms: [], contacts: [], preferences: {} },
    ] as any);

    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'list', args: ['globex'], flags: {}, rawInput: '/client list globex', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('Globex Inc');
    expect(allOutput).not.toContain('Acme Corp');
  });

  it('should show no clients message when list is empty', async () => {
    vi.mocked(clientStore.getAllClients).mockResolvedValue([]);

    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'list', args: [], flags: {}, rawInput: '/client list', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('No clients found'))).toBe(true);
  });

  it('should show no clients message when filter has no matches', async () => {
    vi.mocked(clientStore.getAllClients).mockResolvedValue([
      { id: 'acme', name: 'Acme Corp', industry: 'SaaS', description: '', goals: [], platforms: [], contacts: [], preferences: {} },
    ] as any);

    const ctx = mockCtx({
      parsed: { command: '/client', subcommand: 'list', args: [], flags: { industry: 'Healthcare' }, rawInput: '/client list --industry=Healthcare', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(calls.some((msg: string) => msg.includes('No clients found') && msg.includes('Healthcare'))).toBe(true);
  });

  it('should mark active client in list', async () => {
    vi.mocked(clientStore.getAllClients).mockResolvedValue([
      { id: 'acme', name: 'Acme Corp', industry: 'SaaS', description: '', goals: [], platforms: [], contacts: [], preferences: {} },
    ] as any);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: { command: '/client', subcommand: 'list', args: [], flags: {}, rawInput: '/client list', isNLP: false } as ParsedCommand,
    });

    await handleClient(ctx);

    // The active client should have a green indicator (●)
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('●');
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
