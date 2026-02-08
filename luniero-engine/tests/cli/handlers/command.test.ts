import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as readline from 'readline';
import { HandlerContext } from '../../../src/cli/router';
import { createSession } from '../../../src/cli/session';
import { ParsedCommand } from '../../../src/cli/parser';

vi.mock('../../../src/cli/custom-commands', () => ({
  loadCustomCommands: vi.fn().mockReturnValue(new Map()),
  saveCustomCommand: vi.fn().mockReturnValue('/mock/path/test-cmd.md'),
  deleteCustomCommand: vi.fn().mockReturnValue(true),
}));

import { handleCommand } from '../../../src/cli/handlers/command';
import { loadCustomCommands, saveCustomCommand, deleteCustomCommand } from '../../../src/cli/custom-commands';

function mockRL(answers: string[] = []) {
  let i = 0;
  return {
    question: vi.fn((q: string, cb: (a: string) => void) => cb(answers[i++] || '')),
  } as unknown as readline.Interface;
}

function mockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    session: createSession(),
    parsed: { command: '/command', subcommand: '', args: [], flags: {}, rawInput: '/command', isNLP: false } as ParsedCommand,
    rl: mockRL(),
    output: vi.fn(),
    ...overrides,
  };
}

describe('handleCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show help when no subcommand given', async () => {
    const ctx = mockCtx();

    const result = await handleCommand(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('Manage custom commands'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('/command new'))).toBe(true);
    expect(result.session.lastHandler).toBe('/command');
  });

  it('should require name for /command new', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/command',
        subcommand: 'new',
        args: [],
        flags: {},
        rawInput: '/command new',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleCommand(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('name is required'))).toBe(true);
  });

  it('should create a command with /command new <name>', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/command',
        subcommand: 'new',
        args: ['greeting'],
        flags: {},
        rawInput: '/command new greeting',
        isNLP: false,
      } as ParsedCommand,
      rl: mockRL(['Hello $ARGUMENTS', 'END']),
    });

    const result = await handleCommand(ctx);

    expect(saveCustomCommand).toHaveBeenCalledWith('greeting', 'Hello $ARGUMENTS');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('greeting') && msg.includes('created'))).toBe(true);
  });

  it('should handle empty template for /command new', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/command',
        subcommand: 'new',
        args: ['empty-cmd'],
        flags: {},
        rawInput: '/command new empty-cmd',
        isNLP: false,
      } as ParsedCommand,
      rl: mockRL(['END']),
    });

    const result = await handleCommand(ctx);

    expect(saveCustomCommand).not.toHaveBeenCalled();
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no template'))).toBe(true);
  });

  it('should list custom commands', async () => {
    const mockCommands = new Map([
      ['/greeting', { name: '/greeting', promptTemplate: 'Hello $ARGUMENTS\nLine 2', filePath: '/mock/greeting.md' }],
    ]);
    vi.mocked(loadCustomCommands).mockReturnValue(mockCommands);

    const ctx = mockCtx({
      parsed: {
        command: '/command',
        subcommand: 'list',
        args: [],
        flags: {},
        rawInput: '/command list',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleCommand(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('/greeting'))).toBe(true);
  });

  it('should show message when no custom commands exist', async () => {
    vi.mocked(loadCustomCommands).mockReturnValue(new Map());

    const ctx = mockCtx({
      parsed: {
        command: '/command',
        subcommand: 'list',
        args: [],
        flags: {},
        rawInput: '/command list',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleCommand(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no custom commands'))).toBe(true);
  });

  it('should delete a custom command', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/command',
        subcommand: 'delete',
        args: ['greeting'],
        flags: {},
        rawInput: '/command delete greeting',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleCommand(ctx);

    expect(deleteCustomCommand).toHaveBeenCalledWith('greeting');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('deleted'))).toBe(true);
  });

  it('should show error when deleting non-existent command', async () => {
    vi.mocked(deleteCustomCommand).mockReturnValue(false);

    const ctx = mockCtx({
      parsed: {
        command: '/command',
        subcommand: 'delete',
        args: ['nonexistent'],
        flags: {},
        rawInput: '/command delete nonexistent',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleCommand(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('not found'))).toBe(true);
  });

  it('should require name for /command delete', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/command',
        subcommand: 'delete',
        args: [],
        flags: {},
        rawInput: '/command delete',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleCommand(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('name is required'))).toBe(true);
  });
});
