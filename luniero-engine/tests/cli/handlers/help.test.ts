import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as readline from 'readline';
import { HandlerContext } from '../../../src/cli/router';
import { createSession } from '../../../src/cli/session';
import { ParsedCommand } from '../../../src/cli/parser';

import { handleHelp, getCommandList } from '../../../src/cli/handlers/help';

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

describe('handleHelp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should output help text with commands', async () => {
    const ctx = mockCtx();

    await handleHelp(ctx);

    expect(ctx.output).toHaveBeenCalled();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('/write');
    expect(allOutput).toContain('/help');
  });

  it('should include aliases in help', async () => {
    const ctx = mockCtx();

    await handleHelp(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('/w');
  });

  it('should update lastHandler', async () => {
    const ctx = mockCtx();

    const result = await handleHelp(ctx);

    expect(result.session.lastHandler).toBe('/help');
  });

  it('should show command-specific help for /help write', async () => {
    const ctx = mockCtx({
      parsed: { command: '/help', subcommand: 'write', args: [], flags: {}, rawInput: '/help write', isNLP: false } as ParsedCommand,
    });

    await handleHelp(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('/write');
    expect(allOutput).toContain('--client');
    expect(allOutput).toContain('--tone');
    expect(allOutput).toContain('--length');
    expect(allOutput).toContain('--variations');
  });

  it('should fall back to all commands for unknown topic', async () => {
    const ctx = mockCtx({
      parsed: { command: '/help', subcommand: 'unknown-cmd', args: [], flags: {}, rawInput: '/help unknown-cmd', isNLP: false } as ParsedCommand,
    });

    await handleHelp(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    const allOutput = calls.join('\n');
    expect(allOutput).toContain('/write');
    expect(allOutput).toContain('/help');
  });
});

describe('getCommandList', () => {
  it('should list all commands via getCommandList', () => {
    const commands = getCommandList();

    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBeGreaterThan(15);
  });
});

