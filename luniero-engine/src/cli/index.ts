import * as readline from 'readline';
import { logger } from '../utils/logger';
import { parse } from './parser';
import { CommandRouter, HandlerContext } from './router';
import { createSession, withLastCommand, withLastHandler, Session } from './session';
import { formatWelcome, formatPrompt, formatError, formatInfo } from './formatter';
import { handleWrite } from './handlers/write';
import { handleQuick } from './handlers/quick';
import { handleCalendar } from './handlers/calendar';
import { handleReport } from './handlers/report';
import { handleResearch } from './handlers/research';
import { handleClient } from './handlers/client';
import { handleApprove, handleRevise, handleReject } from './handlers/approval';
import { handleSchedule, handlePublish, handleQueue } from './handlers/schedule';
import { handleStatus, handleHistory, handleShow } from './handlers/status';
import { handleHelp, handleSettings } from './handlers/help';
import { handleDebug } from './handlers/debug';
import { handleUpload, handleUploads } from './handlers/upload';
import { handleRepurpose, handleTrending } from './handlers/content';

const VERSION = '1.0.0';

function createRouter(): CommandRouter {
  const router = new CommandRouter();

  router.register('/write', handleWrite);
  router.register('/quick', handleQuick);
  router.register('/calendar', handleCalendar);
  router.register('/report', handleReport);
  router.register('/research', handleResearch);
  router.register('/client', handleClient);
  router.register('/approve', handleApprove);
  router.register('/revise', handleRevise);
  router.register('/reject', handleReject);
  router.register('/schedule', handleSchedule);
  router.register('/publish', handlePublish);
  router.register('/queue', handleQueue);
  router.register('/status', handleStatus);
  router.register('/history', handleHistory);
  router.register('/show', handleShow);
  router.register('/help', handleHelp);
  router.register('/settings', handleSettings);
  router.register('/debug', handleDebug);
  router.register('/upload', handleUpload);
  router.register('/uploads', handleUploads);
  router.register('/repurpose', handleRepurpose);
  router.register('/trending', handleTrending);

  // NLP fallback: unrecognized natural language shows help hint
  router.registerNLPFallback(async (ctx) => {
    ctx.output(formatInfo('Not sure what you mean. Type /help for available commands, or try "write a post about..."'));
    return { session: ctx.session };
  });

  return router;
}

export async function startREPL(options?: {
  rl?: readline.Interface;
  output?: (text: string) => void;
  onExit?: () => void;
}): Promise<void> {
  const rl = options?.rl || readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const output = options?.output || ((text: string) => console.log(text));
  const router = createRouter();
  let session: Session = createSession();

  // Welcome banner
  output(formatWelcome(VERSION));

  // Main REPL loop
  const promptLoop = (): void => {
    rl.question(formatPrompt(session.activeClientId), async (input) => {
      try {
        const trimmed = input.trim();

        // Handle quit
        if (trimmed === '/quit' || trimmed === '/exit' || trimmed === '/bye') {
          output(formatInfo('Goodbye!'));
          await cleanup(rl);
          if (options?.onExit) {
            options.onExit();
          }
          return;
        }

        // Skip empty input
        if (!trimmed) {
          promptLoop();
          return;
        }

        // Parse and route
        const parsed = parse(trimmed);
        session = withLastCommand(session, trimmed);

        const ctx: HandlerContext = {
          session,
          parsed,
          rl,
          output,
        };

        const result = await router.route(ctx);
        session = result.session;

      } catch (err) {
        // REPL-level error catch (third layer) — never crash
        const message = err instanceof Error ? err.message : String(err);
        output(formatError(`Unexpected error: ${message}`));
        logger.error('REPL error', err);
      }

      promptLoop();
    });
  };

  // Handle Ctrl+C gracefully
  rl.on('close', async () => {
    output(formatInfo('\nGoodbye!'));
    await cleanup(rl);
    if (options?.onExit) {
      options.onExit();
    } else {
      process.exit(0);
    }
  });

  promptLoop();
}

async function cleanup(_rl: readline.Interface): Promise<void> {
  // No external connections to clean up — pipeline runs in-process
}

// Direct execution
if (require.main === module || process.argv[1]?.endsWith('cli/index.ts') || process.argv[1]?.endsWith('cli/index')) {
  startREPL().catch((err) => {
    console.error('CLI Error:', err.message || err);
    process.exit(1);
  });
}
