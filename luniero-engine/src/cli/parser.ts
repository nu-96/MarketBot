import { extractPlatform, extractContentType, extractTopic, looksLikeWriteRequest, looksLikeQuickRequest, looksLikeResearchRequest, looksLikeApprovalRequest } from './utils/nlp';

export interface ParsedCommand {
  command: string;       // resolved slash command (e.g., '/write')
  subcommand: string;    // first positional arg after command (e.g., 'list' for '/client list')
  args: string[];        // remaining positional args
  flags: Record<string, string | boolean>; // --flag or --flag=value
  rawInput: string;      // original input
  platform?: string;     // NLP-extracted platform
  contentType?: string;  // NLP-extracted content type
  topic?: string;        // NLP-extracted topic
  isNLP: boolean;        // true if routed via NLP (not a slash command)
}

// Alias map: alias → canonical command
const ALIASES: Record<string, string> = {
  // Content creation
  '/w': '/write',
  '/create': '/write',
  '/draft': '/write',
  '/make': '/write',
  '/q': '/quick',
  '/fast': '/quick',
  '/cal': '/calendar',
  '/plan': '/calendar',
  // Analytics
  '/r': '/report',
  '/analytics': '/report',
  '/stats': '/report',
  '/res': '/research',
  '/find': '/research',
  '/search': '/research',
  // Client
  '/c': '/client',
  // Workflow
  '/a': '/approve',
  '/ok': '/approve',
  '/yes': '/approve',
  '/lgtm': '/approve',
  '/rev': '/revise',
  '/edit': '/revise',
  '/change': '/revise',
  '/fix': '/revise',
  '/rej': '/reject',
  '/sched': '/schedule',
  '/post': '/schedule',
  '/pub': '/publish',
  '/que': '/queue',
  // Export
  '/save': '/export',
  '/out': '/export',
  // Utility
  '/s': '/status',
  '/hist': '/history',
  '/sh': '/show',
  '/h': '/help',
  '/?': '/help',
  '/d': '/debug',
  '/set': '/settings',
  '/exit': '/quit',
  '/bye': '/quit',
};

// All valid commands
const VALID_COMMANDS = new Set([
  '/write', '/quick', '/calendar', '/report', '/research',
  '/client', '/approve', '/revise', '/reject',
  '/schedule', '/publish', '/queue',
  '/status', '/history', '/show',
  '/help', '/settings', '/debug', '/quit',
  '/upload', '/uploads', '/repurpose', '/trending',
  '/export',
]);

export function parse(input: string): ParsedCommand {
  const trimmed = input.trim();
  const rawInput = trimmed;

  if (!trimmed) {
    return emptyCommand(rawInput);
  }

  // Slash command path
  if (trimmed.startsWith('/')) {
    return parseSlashCommand(trimmed, rawInput);
  }

  // NLP path: detect intent from natural language
  return parseNLP(trimmed, rawInput);
}

function parseSlashCommand(input: string, rawInput: string): ParsedCommand {
  const parts = tokenize(input);
  const rawCmd = parts[0].toLowerCase();
  const command = Object.prototype.hasOwnProperty.call(ALIASES, rawCmd) ? ALIASES[rawCmd] : rawCmd;
  const rest = parts.slice(1);

  // Extract flags
  const { positional, flags } = extractFlags(rest);
  const subcommand = positional[0] || '';
  const args = positional.slice(1);

  // NLP extraction from the rest of the input (after command)
  const textAfterCmd = input.replace(/^\/\w+\s*/, '');
  const platform = extractPlatform(textAfterCmd);
  const contentType = extractContentType(textAfterCmd);
  const topic = extractTopic(input);

  return {
    command,
    subcommand,
    args,
    flags,
    rawInput,
    platform,
    contentType,
    topic: topic || undefined,
    isNLP: false,
  };
}

function parseNLP(input: string, rawInput: string): ParsedCommand {
  const platform = extractPlatform(input);
  const contentType = extractContentType(input);
  const topic = extractTopic(input);

  let command = '';

  // Check for approval-style input first (approve, revise, reject, yes, ok, etc.)
  const approvalIntent = looksLikeApprovalRequest(input);
  if (approvalIntent) {
    command = `/${approvalIntent}`;
  } else if (looksLikeWriteRequest(input)) {
    command = '/write';
  } else if (looksLikeQuickRequest(input)) {
    command = '/quick';
  } else if (looksLikeResearchRequest(input)) {
    command = '/research';
  }

  // Extract flags from NLP input too
  const parts = tokenize(input);
  const { flags } = extractFlags(parts);

  return {
    command,
    subcommand: '',
    args: [],
    flags,
    rawInput,
    platform,
    contentType,
    topic: topic || undefined,
    isNLP: true,
  };
}

function emptyCommand(rawInput: string): ParsedCommand {
  return {
    command: '',
    subcommand: '',
    args: [],
    flags: {},
    rawInput,
    isNLP: false,
  };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === quoteChar) {
        inQuotes = false;
        if (current) tokens.push(current);
        current = '';
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      if (current) tokens.push(current);
      current = '';
      inQuotes = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current) tokens.push(current);
  return tokens;
}

function extractFlags(tokens: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (const token of tokens) {
    if (token.startsWith('--')) {
      const eqIdx = token.indexOf('=');
      if (eqIdx > 0) {
        flags[token.substring(2, eqIdx)] = token.substring(eqIdx + 1);
      } else {
        flags[token.substring(2)] = true;
      }
    } else if (token.startsWith('-') && token.length === 2 && /[a-zA-Z]/.test(token[1])) {
      flags[token.substring(1)] = true;
    } else {
      positional.push(token);
    }
  }

  return { positional, flags };
}

export function resolveAlias(input: string): string {
  const lower = input.toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, lower) ? ALIASES[lower] : input;
}

export function isValidCommand(command: string): boolean {
  return VALID_COMMANDS.has(command);
}

export function getSuggestions(input: string, maxSuggestions = 3): string[] {
  const lower = input.toLowerCase();
  const allCommands = [...VALID_COMMANDS, ...Object.keys(ALIASES)];

  // Exact prefix match
  const prefixMatches = allCommands.filter(cmd => cmd.startsWith(lower) && cmd !== lower);
  if (prefixMatches.length > 0) {
    // Deduplicate by resolving aliases
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const m of prefixMatches) {
      const resolved = ALIASES[m] || m;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        unique.push(resolved);
      }
    }
    return unique.slice(0, maxSuggestions);
  }

  // Levenshtein-based fuzzy match
  const scored = [...VALID_COMMANDS]
    .map(cmd => ({ cmd, dist: levenshtein(lower, cmd) }))
    .filter(({ dist }) => dist <= 3)
    .sort((a, b) => a.dist - b.dist);

  return scored.slice(0, maxSuggestions).map(s => s.cmd);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

export { ALIASES, VALID_COMMANDS, tokenize as _tokenize };
