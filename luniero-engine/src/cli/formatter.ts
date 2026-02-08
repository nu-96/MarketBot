import { Job, JobStatus } from '../core/state-store';

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const BG_BLUE = '\x1b[44m';

export const colors = {
  reset: (s: string) => `${RESET}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
  magenta: (s: string) => `${MAGENTA}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  white: (s: string) => `${WHITE}${s}${RESET}`,
  bgRed: (s: string) => `${BG_RED}${WHITE}${s}${RESET}`,
  bgGreen: (s: string) => `${BG_GREEN}${WHITE}${s}${RESET}`,
  bgYellow: (s: string) => `${BG_YELLOW}${WHITE}${s}${RESET}`,
  bgBlue: (s: string) => `${BG_BLUE}${WHITE}${s}${RESET}`,
};

const STATUS_COLORS: Record<JobStatus, (s: string) => string> = {
  received: colors.blue,
  researching: colors.cyan,
  context_loading: colors.cyan,
  briefing: colors.cyan,
  brief_pending_approval: colors.yellow,
  drafting: colors.cyan,
  polishing: colors.magenta,
  reviewing: colors.yellow,
  revision: colors.yellow,
  human_review: colors.yellow,
  complete: colors.green,
  failed: colors.red,
};

export function formatStatus(status: JobStatus): string {
  const colorFn = STATUS_COLORS[status] || colors.white;
  return colorFn(status);
}

export function formatWelcome(version: string): string {
  return [
    '',
    colors.bold(colors.cyan('  Luniero Marketing Engine')),
    colors.dim(`  v${version} — Interactive CLI`),
    '',
    colors.dim('  Type /help for commands or just describe what you need.'),
    colors.dim('  Press Ctrl+C to exit.'),
    '',
  ].join('\n');
}

export function formatError(message: string): string {
  return `${colors.red('Error:')} ${message}`;
}

export function formatIssue(message: string, nextSteps?: string[]): string {
  const lines = [colors.yellow(message)];
  if (nextSteps && nextSteps.length > 0) {
    lines.push('');
    lines.push('What now?');
    for (const step of nextSteps) {
      lines.push(`  → ${step}`);
    }
  }
  return lines.join('\n');
}

export function formatSuccess(message: string): string {
  return `${colors.green('✓')} ${message}`;
}

export function formatWarning(message: string): string {
  return `${colors.yellow('Warning:')} ${message}`;
}

export function formatInfo(message: string): string {
  return `${colors.blue('ℹ')} ${message}`;
}

export function formatJobSummary(job: Job): string {
  const lines = [
    `${colors.bold('Job:')} ${colors.dim(job.id)}`,
    `  ${colors.bold('Client:')} ${job.clientId}`,
    `  ${colors.bold('Type:')}   ${job.type}`,
    `  ${colors.bold('Status:')} ${formatStatus(job.status)}`,
    `  ${colors.bold('Topic:')}  ${job.input?.topic || 'N/A'}`,
  ];
  if (job.iteration > 0) {
    lines.push(`  ${colors.bold('Iter:')}   ${job.iteration}/${job.maxIterations}`);
  }
  if (job.completedAt) {
    lines.push(`  ${colors.bold('Done:')}   ${new Date(job.completedAt).toLocaleString()}`);
  }
  if (job.error) {
    lines.push(`  ${colors.bold(colors.red('Error:'))} ${job.error}`);
  }
  return lines.join('\n');
}

export function formatJobTable(jobs: Job[]): string {
  if (jobs.length === 0) {
    return colors.dim('  No jobs found.');
  }

  const header = `  ${pad('ID', 10)} ${pad('Type', 14)} ${pad('Status', 16)} ${pad('Topic', 30)} ${pad('Created', 20)}`;
  const separator = colors.dim('  ' + '─'.repeat(94));

  const rows = jobs.map(job => {
    const id = job.id.substring(0, 8);
    const topic = (job.input?.topic || 'N/A').substring(0, 28);
    const created = new Date(job.createdAt).toLocaleDateString();
    return `  ${colors.dim(pad(id, 10))} ${pad(job.type, 14)} ${pad(formatStatus(job.status), 16 + 9)} ${pad(topic, 30)} ${colors.dim(pad(created, 20))}`;
  });

  return [colors.bold(header), separator, ...rows].join('\n');
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.substring(0, width);
  return s + ' '.repeat(width - s.length);
}

export function formatCommandSuggestion(input: string, suggestions: string[]): string {
  if (suggestions.length === 0) {
    return formatError(`Unknown command: ${input}. Type /help for available commands.`);
  }
  const list = suggestions.map(s => colors.cyan(s)).join(', ');
  return `${formatError(`Unknown command: ${input}.`)} Did you mean: ${list}?`;
}

export function formatContent(content: string, label?: string): string {
  const border = colors.dim('━'.repeat(50));
  const parts = [border];
  if (label) {
    parts.push(colors.bold(label));
    parts.push('');
  }
  parts.push(content);
  parts.push(border);
  return parts.join('\n');
}

export function formatContentOutput(opts: {
  content: string;
  platform?: string;
  clientName?: string;
  wordCount?: number;
  score?: number;
  hashtags?: string;
}): string {
  const border = colors.dim('━'.repeat(50));
  const lines: string[] = [];

  // Header
  const title = [opts.platform, opts.clientName].filter(Boolean).join(' — ');
  if (title) {
    lines.push(colors.bold(title));
  }
  lines.push(border);
  lines.push(opts.content);
  lines.push(border);

  // Metadata
  const meta: string[] = [];
  if (opts.wordCount != null) meta.push(`Words: ${opts.wordCount}`);
  if (opts.score != null) meta.push(`Score: ${opts.score}/100`);
  if (meta.length > 0) lines.push(meta.join(' | '));

  if (opts.hashtags) {
    lines.push(colors.dim(opts.hashtags));
  }

  // Action prompt
  lines.push('');
  lines.push(`${colors.green('Approve')} / ${colors.yellow('Revise')} / ${colors.cyan('Regenerate')}`);

  return lines.join('\n');
}

export function formatPipelineProgress(stages: { name: string; status: 'done' | 'active' | 'pending' | 'failed'; time?: string }[]): string {
  const lines: string[] = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const isLast = i === stages.length - 1;
    const prefix = isLast ? '└─' : '├─';
    const timeStr = s.time ? ` (${s.time})` : '';

    switch (s.status) {
      case 'done':
        lines.push(`${prefix} ${colors.green('✓')} ${s.name}${timeStr}`);
        break;
      case 'active':
        lines.push(`${prefix} ${colors.cyan('●')} ${s.name}...`);
        break;
      case 'failed':
        lines.push(`${prefix} ${colors.red('✗')} ${s.name}${timeStr}`);
        break;
      default:
        lines.push(`${prefix} ${colors.dim('○')} ${s.name}`);
        break;
    }
  }
  return lines.join('\n');
}

export function formatSpinner(message: string): { start: () => NodeJS.Timeout; stop: (timer: NodeJS.Timeout) => void } {
  // Pulsing circle per spec: ○ ◎ ● ◎
  const frames = ['○', '◎', '●', '◎'];
  let i = 0;

  return {
    start: () => {
      return setInterval(() => {
        process.stdout.write(`\r${colors.cyan(frames[i % frames.length])} ${message}`);
        i++;
      }, 300);
    },
    stop: (timer: NodeJS.Timeout) => {
      clearInterval(timer);
      process.stdout.write('\r' + ' '.repeat(message.length + 4) + '\r');
    },
  };
}

export function formatHelp(commands: { command: string; aliases: string[]; description: string }[]): string {
  const lines = [
    '',
    colors.bold(colors.cyan('  Available Commands')),
    '',
  ];

  for (const cmd of commands) {
    const aliasStr = cmd.aliases.length > 0 ? colors.dim(` (${cmd.aliases.join(', ')})`) : '';
    lines.push(`  ${colors.green(pad(cmd.command, 20))}${cmd.description}${aliasStr}`);
  }

  lines.push('');
  lines.push(colors.dim('  You can also type natural language — e.g., "write a LinkedIn post about AI"'));
  lines.push('');
  return lines.join('\n');
}

export function formatDebugInfo(data: Record<string, unknown>): string {
  const lines = [colors.bold(colors.yellow('  Debug Info'))];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`  ${colors.bold(key + ':')} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
  }
  return lines.join('\n');
}

export function formatClientInfo(profile: { id: string; name: string; industry: string; platforms?: any[]; preferences?: any }): string {
  const lines = [
    colors.bold(colors.cyan(`  Client: ${profile.name}`)),
    `  ${colors.bold('ID:')}       ${profile.id}`,
    `  ${colors.bold('Industry:')} ${profile.industry}`,
  ];
  if (profile.platforms && profile.platforms.length > 0) {
    lines.push(`  ${colors.bold('Platforms:')} ${profile.platforms.map((p: any) => p.platform || p).join(', ')}`);
  }
  if (profile.preferences?.contentPillars?.length > 0) {
    lines.push(`  ${colors.bold('Pillars:')}  ${profile.preferences.contentPillars.join(', ')}`);
  }
  return lines.join('\n');
}

export function formatPrompt(clientId: string | null): string {
  const client = clientId ? colors.cyan(clientId) : colors.dim('no-client');
  return `${client} ${colors.dim('>')} `;
}
