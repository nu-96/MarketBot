import * as readline from 'readline';
import { logger } from '../utils/logger';
import { parse, VALID_COMMANDS, ALIASES, registerCommand, unregisterCommand } from './parser';
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
import { handleHelp } from './handlers/help';
import { handleUpload, handleUploads } from './handlers/upload';
import { handleRepurpose, handleTrending } from './handlers/content';
import { handleExport } from './handlers/export';
import { handleCommand } from './handlers/command';
import { handleRead } from './handlers/read';
import { loadCustomCommands, createCustomHandler } from './custom-commands';

const VERSION = '1.0.0';

const SUBCOMMAND_MAP: Record<string, string[]> = {
  '/client': ['list', 'new', 'switch', 'base', 'voice', 'pillars', 'info'],
  '/command': ['new', 'list', 'delete'],
  '/uploads': ['list', 'show', 'delete', 'search'],
  '/export': ['--format=md', '--format=json', '--format=txt'],
};

function resolveBaseCommand(cmd: string): string {
  const lower = cmd.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, lower) ? ALIASES[lower] : lower;
}

// Map bare words to slash commands for tab completion
const BARE_WORD_MAP: Record<string, string> = {
  write: '/write', create: '/write', draft: '/write', compose: '/write',
  quick: '/quick', suggest: '/quick', brainstorm: '/quick',
  calendar: '/calendar', plan: '/calendar',
  report: '/report', analytics: '/report', stats: '/report',
  research: '/research', analyze: '/research',
  client: '/client', clients: '/client',
  approve: '/approve', yes: '/approve',
  revise: '/revise', edit: '/revise',
  reject: '/reject',
  schedule: '/schedule', publish: '/publish', queue: '/queue',
  status: '/status', progress: '/status',
  history: '/history',
  help: '/help', commands: '/help',
  upload: '/upload', import: '/upload',
  uploads: '/uploads',
  read: '/read', open: '/read', view: '/read',
  repurpose: '/repurpose', convert: '/repurpose',
  trending: '/trending', trends: '/trending',
  export: '/export', save: '/export', download: '/export',
  show: '/show',
};

/**
 * Returns matching commands/subcommands for a partial input line.
 * Shared by both the tab completer and inline autosuggestion.
 * Supports both slash-prefixed commands and bare words.
 */
function getCommandMatches(line: string): string[] {
  // Bare word matching — suggest the slash command equivalent
  if (!line.startsWith('/')) {
    const lower = line.toLowerCase();
    const matches: string[] = [];
    for (const [word, cmd] of Object.entries(BARE_WORD_MAP)) {
      if (word.startsWith(lower) && word !== lower) {
        if (!matches.includes(cmd)) matches.push(cmd);
      }
    }
    // Exact match — return the command itself
    if (BARE_WORD_MAP[lower]) {
      const cmd = BARE_WORD_MAP[lower];
      if (!matches.includes(cmd)) matches.unshift(cmd);
    }
    return matches;
  }

  const spaceIdx = line.indexOf(' ');
  if (spaceIdx > 0) {
    const baseCmd = resolveBaseCommand(line.substring(0, spaceIdx));
    const partial = line.substring(spaceIdx + 1).toLowerCase();
    const subs = SUBCOMMAND_MAP[baseCmd];
    if (!subs) return [];
    return subs
      .filter(s => s.toLowerCase().startsWith(partial))
      .map(s => `${line.substring(0, spaceIdx)} ${s}`);
  }

  const customCommands = loadCustomCommands();
  const allCommands = [...VALID_COMMANDS, ...Object.keys(ALIASES), ...customCommands.keys()].sort();
  return allCommands.filter(cmd => cmd.startsWith(line.toLowerCase()));
}

function createCompleter(): readline.Completer {
  return (line: string): [string[], string] => {
    if (line === '/') {
      const customCommands = loadCustomCommands();
      return [[...VALID_COMMANDS, ...customCommands.keys()].sort(), line];
    }

    const hits = getCommandMatches(line);
    if (hits.length > 0) return [hits, line];

    return [[], line];
  };
}

/**
 * Inline autosuggestion: shows dim completion hints as the user types.
 * The hint appears after the cursor and is automatically cleared by
 * readline's next redraw. TAB accepts the suggestion via the completer.
 */
function setupAutoSuggest(rl: readline.Interface): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  process.stdin.on('keypress', (_str: string, key: { name?: string }) => {
    if (!key) return;
    // Don't interfere with TAB (completer handles it) or Enter
    if (key.name === 'tab' || key.name === 'return' || key.name === 'enter') return;

    // Wait for readline to process the keystroke and update rl.line
    setImmediate(() => {
      const line = rl.line;
      if (!line) return;

      const matches = getCommandMatches(line);
      if (matches.length === 1 && matches[0].length > line.length) {
        const rest = matches[0].substring(line.length);
        // Write dim hint text, then move cursor back to the user's position
        process.stdout.write(`\x1b[2m${rest}\x1b[22m\x1b[${rest.length}D`);
      }
    });
  });
}

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
  router.register('/upload', handleUpload);
  router.register('/uploads', handleUploads);
  router.register('/read', handleRead);
  router.register('/repurpose', handleRepurpose);
  router.register('/trending', handleTrending);
  router.register('/export', handleExport);
  router.register('/save', handleExport);
  // Register custom commands (loaded from ~/.luniero/commands/*.md)
  const customCommands = loadCustomCommands();
  for (const [cmdName, cmd] of customCommands) {
    registerCommand(cmdName);
    router.register(cmdName, createCustomHandler(cmd.promptTemplate));
  }

  // /command handler — wraps handleCommand to live-register/unregister custom commands
  router.register('/command', async (ctx) => {
    const before = new Set(loadCustomCommands().keys());
    const result = await handleCommand(ctx);
    const after = loadCustomCommands();

    // Register newly created commands
    for (const [cmdName, cmd] of after) {
      if (!before.has(cmdName)) {
        registerCommand(cmdName);
        router.register(cmdName, createCustomHandler(cmd.promptTemplate));
      }
    }

    // Unregister deleted commands
    for (const cmdName of before) {
      if (!after.has(cmdName)) {
        unregisterCommand(cmdName);
        router.unregister(cmdName);
      }
    }

    return result;
  });

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
    completer: createCompleter(),
  });

  const output = options?.output || ((text: string) => console.log(text));
  const router = createRouter();
  let session: Session = createSession();

  // Welcome banner
  output(formatWelcome(VERSION));

  // Enable inline autosuggestion (dim hints as you type)
  setupAutoSuggest(rl);

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
