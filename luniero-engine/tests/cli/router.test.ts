import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRouter, HandlerContext, HandlerResult } from '../../src/cli/router';
import { ParsedCommand } from '../../src/cli/parser';
import { createSession, Session, withLastHandler } from '../../src/cli/session';
import * as readline from 'readline';

function mockContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    session: createSession(),
    parsed: {
      command: '',
      subcommand: '',
      args: [],
      flags: {},
      rawInput: '',
      isNLP: false,
    },
    rl: {} as readline.Interface,
    output: vi.fn(),
    ...overrides,
  };
}

function mockParsed(overrides: Partial<ParsedCommand> = {}): ParsedCommand {
  return {
    command: '',
    subcommand: '',
    args: [],
    flags: {},
    rawInput: '',
    isNLP: false,
    ...overrides,
  };
}

describe('CommandRouter', () => {
  let router: CommandRouter;

  beforeEach(() => {
    router = new CommandRouter();
  });

  describe('register and route', () => {
    it('should route to registered handler', async () => {
      const handler = vi.fn(async (ctx: HandlerContext): Promise<HandlerResult> => {
        ctx.output('handled!');
        return { session: ctx.session };
      });

      router.register('/help', handler);
      const ctx = mockContext({ parsed: mockParsed({ command: '/help' }) });
      await router.route(ctx);

      expect(handler).toHaveBeenCalledOnce();
      expect(ctx.output).toHaveBeenCalledWith('handled!');
    });

    it('should return session from handler', async () => {
      const newSession = createSession({ activeClientId: 'acme' });
      const handler = vi.fn(async (): Promise<HandlerResult> => {
        return { session: newSession };
      });

      router.register('/client', handler);
      const ctx = mockContext({ parsed: mockParsed({ command: '/client' }) });
      const result = await router.route(ctx);

      expect(result.session.activeClientId).toBe('acme');
    });
  });

  describe('empty input', () => {
    it('should return session without output for empty command', async () => {
      const ctx = mockContext({ parsed: mockParsed({ command: '', isNLP: false }) });
      const result = await router.route(ctx);
      expect(result.session).toBe(ctx.session);
      expect(ctx.output).not.toHaveBeenCalled();
    });
  });

  describe('invalid commands', () => {
    it('should show error for unknown slash command', async () => {
      const ctx = mockContext({ parsed: mockParsed({ command: '/foobar' }) });
      await router.route(ctx);
      expect(ctx.output).toHaveBeenCalled();
      const msg = (ctx.output as any).mock.calls[0][0] as string;
      expect(msg).toContain('Unknown command');
    });

    it('should show suggestions for close matches', async () => {
      const ctx = mockContext({ parsed: mockParsed({ command: '/writ' }) });
      await router.route(ctx);
      const msg = (ctx.output as any).mock.calls[0][0] as string;
      expect(msg).toContain('/write');
    });
  });

  describe('NLP routing', () => {
    it('should route NLP-detected command to handler', async () => {
      const handler = vi.fn(async (ctx: HandlerContext): Promise<HandlerResult> => {
        return { session: ctx.session };
      });

      router.register('/write', handler);
      const ctx = mockContext({
        parsed: mockParsed({ command: '/write', isNLP: true }),
      });
      await router.route(ctx);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should use lastHandler for conversational follow-up', async () => {
      const writeHandler = vi.fn(async (ctx: HandlerContext): Promise<HandlerResult> => {
        return { session: ctx.session };
      });

      router.register('/write', writeHandler);
      const session = withLastHandler(createSession(), '/write');
      const ctx = mockContext({
        session,
        parsed: mockParsed({ command: '', isNLP: true, rawInput: 'make it shorter' }),
      });

      await router.route(ctx);
      expect(writeHandler).toHaveBeenCalledOnce();
    });

    it('should use NLP fallback when no lastHandler', async () => {
      const fallback = vi.fn(async (ctx: HandlerContext): Promise<HandlerResult> => {
        ctx.output('fallback');
        return { session: ctx.session };
      });

      router.registerNLPFallback(fallback);
      const ctx = mockContext({
        parsed: mockParsed({ command: '', isNLP: true }),
      });

      await router.route(ctx);
      expect(fallback).toHaveBeenCalledOnce();
    });

    it('should show error when NLP has no match and no fallback', async () => {
      const ctx = mockContext({
        parsed: mockParsed({ command: '', isNLP: true }),
      });

      await router.route(ctx);
      const msg = (ctx.output as any).mock.calls[0][0] as string;
      expect(msg).toContain('Not sure');
    });
  });

  describe('error handling', () => {
    it('should catch handler errors (first layer)', async () => {
      const handler = vi.fn(async (): Promise<HandlerResult> => {
        throw new Error('handler boom');
      });

      router.register('/write', handler);
      const ctx = mockContext({ parsed: mockParsed({ command: '/write' }) });
      const result = await router.route(ctx);

      // Should not throw
      expect(result.session).toBe(ctx.session);
      const msg = (ctx.output as any).mock.calls[0][0] as string;
      expect(msg).toContain('Command failed');
      expect(msg).toContain('handler boom');
    });

    it('should catch non-Error throws', async () => {
      const handler = vi.fn(async (): Promise<HandlerResult> => {
        throw 'string error';
      });

      router.register('/help', handler);
      const ctx = mockContext({ parsed: mockParsed({ command: '/help' }) });
      await router.route(ctx);

      const msg = (ctx.output as any).mock.calls[0][0] as string;
      expect(msg).toContain('string error');
    });

    it('should show error for valid command with no handler', async () => {
      // /write is valid but not registered
      const ctx = mockContext({ parsed: mockParsed({ command: '/write' }) });
      await router.route(ctx);
      const msg = (ctx.output as any).mock.calls[0][0] as string;
      expect(msg).toContain('no handler');
    });
  });

  describe('getRegisteredCommands', () => {
    it('should return list of registered commands', () => {
      router.register('/write', vi.fn());
      router.register('/help', vi.fn());
      expect(router.getRegisteredCommands()).toEqual(['/write', '/help']);
    });

    it('should return empty for no registrations', () => {
      expect(router.getRegisteredCommands()).toEqual([]);
    });
  });
});
