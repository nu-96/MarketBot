import * as readline from 'readline';
import { ParsedCommand, isValidCommand, getSuggestions } from './parser';
import { Session } from './session';
import { formatError, formatCommandSuggestion } from './formatter';

export interface HandlerContext {
  session: Session;
  parsed: ParsedCommand;
  rl: readline.Interface;
  output: (text: string) => void;
}

export interface HandlerResult {
  session: Session;
  output?: string;
}

export type CommandHandler = (ctx: HandlerContext) => Promise<HandlerResult>;

export class CommandRouter {
  private handlers: Map<string, CommandHandler> = new Map();
  private nlpFallback: CommandHandler | null = null;

  register(command: string, handler: CommandHandler): void {
    this.handlers.set(command, handler);
  }

  registerNLPFallback(handler: CommandHandler): void {
    this.nlpFallback = handler;
  }

  async route(ctx: HandlerContext): Promise<HandlerResult> {
    const { parsed, session } = ctx;

    try {
      // Empty input - ignore
      if (!parsed.command && !parsed.isNLP) {
        return { session };
      }

      // NLP-detected command
      if (parsed.isNLP && parsed.command) {
        const handler = this.handlers.get(parsed.command);
        if (handler) {
          return await this.safeExecute(handler, ctx);
        }
      }

      // NLP with no command detected → conversational follow-up or fallback
      if (parsed.isNLP && !parsed.command) {
        // Try last handler for conversational follow-up
        if (session.lastHandler) {
          const handler = this.handlers.get(session.lastHandler);
          if (handler) {
            return await this.safeExecute(handler, ctx);
          }
        }
        // Use NLP fallback if available
        if (this.nlpFallback) {
          return await this.safeExecute(this.nlpFallback, ctx);
        }
        ctx.output(formatError('Not sure what you mean. Type /help for available commands.'));
        return { session };
      }

      // Slash command
      if (parsed.command) {
        // Check if valid
        if (!isValidCommand(parsed.command)) {
          const suggestions = getSuggestions(parsed.command);
          ctx.output(formatCommandSuggestion(parsed.command, suggestions));
          return { session };
        }

        const handler = this.handlers.get(parsed.command);
        if (handler) {
          return await this.safeExecute(handler, ctx);
        }

        ctx.output(formatError(`Command ${parsed.command} is recognized but has no handler.`));
        return { session };
      }

      return { session };
    } catch (err) {
      // Router-level error catch (second layer)
      const message = err instanceof Error ? err.message : String(err);
      ctx.output(formatError(`Router error: ${message}`));
      return { session };
    }
  }

  private async safeExecute(handler: CommandHandler, ctx: HandlerContext): Promise<HandlerResult> {
    try {
      return await handler(ctx);
    } catch (err) {
      // Handler-level error catch (first layer)
      const message = err instanceof Error ? err.message : String(err);
      ctx.output(formatError(`Command failed: ${message}`));
      return { session: ctx.session };
    }
  }

  getRegisteredCommands(): string[] {
    return [...this.handlers.keys()];
  }
}
