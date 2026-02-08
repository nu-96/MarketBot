import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatHelp, formatInfo, formatError, colors } from '../formatter';
import { loadCustomCommands } from '../custom-commands';

const COMMANDS = [
  { command: '/write', aliases: ['/w', '/create', '/draft', '/make'], description: 'Create content through the full pipeline' },
  { command: '/quick', aliases: ['/q', '/fast'], description: 'Quick single-shot content generation' },
  { command: '/calendar', aliases: ['/cal', '/plan'], description: 'Generate a content calendar' },
  { command: '/report', aliases: ['/r', '/analytics', '/stats'], description: 'Generate reports and analytics' },
  { command: '/research', aliases: ['/res', '/find', '/search'], description: 'Research a topic' },
  { command: '/client', aliases: ['/c'], description: 'Manage clients' },
  { command: '/approve', aliases: ['/a', '/ok', '/yes', '/lgtm'], description: 'Approve pending content' },
  { command: '/revise', aliases: ['/rev', '/edit', '/change', '/fix'], description: 'Revise with feedback' },
  { command: '/reject', aliases: ['/rej'], description: 'Reject content' },
  { command: '/schedule', aliases: ['/sched', '/post'], description: 'Schedule content for publishing' },
  { command: '/publish', aliases: ['/pub'], description: 'Publish content now' },
  { command: '/queue', aliases: ['/que'], description: 'View pending jobs' },
  { command: '/status', aliases: ['/s'], description: 'Check job status' },
  { command: '/history', aliases: ['/hist'], description: 'Show job history' },
  { command: '/show', aliases: ['/sh'], description: 'Show full job output' },
  { command: '/upload', aliases: [], description: 'Upload a file to client memory' },
  { command: '/uploads', aliases: [], description: 'Manage uploaded files' },
  { command: '/read', aliases: [], description: 'Read a local file' },
  { command: '/repurpose', aliases: [], description: 'Convert content between formats' },
  { command: '/trending', aliases: [], description: 'Get trending topics' },
  { command: '/export', aliases: ['/save'], description: 'Export job content' },
  { command: '/command', aliases: [], description: 'Manage custom commands' },
  { command: '/help', aliases: ['/h', '/?'], description: 'Show help' },
  { command: '/quit', aliases: ['/exit', '/bye'], description: 'Exit the CLI' },
];

const COMMAND_HELP: Record<string, string> = {
  '/write': [
    '',
    colors.bold(colors.cyan('  /write <description>')),
    '',
    '  Create content through the full Brief → Draft → Polish → Review pipeline.',
    '  The agent parses your intent (platform, content type, topic), loads client',
    '  context, and runs each stage with real-time progress.',
    '',
    colors.bold('  Examples:'),
    '    /write a LinkedIn post about AI trends for 2026',
    '    /write a Twitter thread on why startups should use AI automation',
    '    /write Instagram captions for our new product launch (5 variations)',
    '    /write email sequence for new client onboarding (3 emails)',
    '    /write blog post based on uploaded-brief.pdf',
    '',
    colors.bold('  Flags:'),
    '    --client <id>       Specify client',
    '    --platform <name>   Force platform (linkedin, twitter, etc.)',
    '    --tone <tone>       Override tone (casual, formal, etc.)',
    '    --length <len>      Adjust length (short, medium, long)',
    '    --variations <n>    Generate multiple versions',
    '    --instructions <s>  Additional instructions for the agent',
    '',
    colors.dim('  Aliases: /w, /create, /draft, /make'),
    '',
  ].join('\n'),
  '/quick': [
    '',
    colors.bold(colors.cyan('  /quick <description>')),
    '',
    '  Fast single-shot content. Skips the full pipeline for speed.',
    '  Best for simple, time-sensitive content that doesn\'t need multi-stage review.',
    '',
    colors.bold('  Examples:'),
    '    /quick LinkedIn post about our new feature',
    '    /quick tweet celebrating 1000 followers',
    '    /quick Instagram story caption for team photo',
    '',
    colors.dim('  Aliases: /q, /fast'),
    '',
  ].join('\n'),
  '/calendar': [
    '',
    colors.bold(colors.cyan('  /calendar <timeframe> [platform]')),
    '',
    '  Generate a content calendar with post ideas for a specific timeframe.',
    '  Uses your client\'s content pillars and trending topics to create a',
    '  structured schedule with dates, platforms, content types, and topics.',
    '',
    colors.bold('  Examples:'),
    '    /calendar this week',
    '    /calendar next week linkedin',
    '    /calendar february instagram',
    '    /calendar q1 all',
    '',
    colors.bold('  Options:'),
    '    --weeks <n>    Number of weeks to plan (default: 2)',
    '',
    colors.dim('  Aliases: /cal, /plan'),
    '',
  ].join('\n'),
  '/report': [
    '',
    colors.bold(colors.cyan('  /report <type> [timeframe]')),
    '',
    '  Generate analytics reports with metrics, insights, and recommendations.',
    '',
    colors.bold('  Types:'),
    '    weekly, monthly, campaign, performance, competitor analysis',
    '',
    colors.bold('  Examples:'),
    '    /report weekly',
    '    /report monthly',
    '    /report campaign "Summer Launch"',
    '    /report performance last 30 days',
    '',
    colors.dim('  Aliases: /r, /analytics, /stats'),
    '',
  ].join('\n'),
  '/research': [
    '',
    colors.bold(colors.cyan('  /research <topic>')),
    '',
    '  Research a topic and return actionable insights.',
    '  Searches web, social platforms, and news for trends and competitor activity.',
    '',
    colors.bold('  Examples:'),
    '    /research trending topics in B2B SaaS',
    '    /research what competitors are posting this week',
    '    /research best hashtags for project management content',
    '    /research audience sentiment about AI tools',
    '',
    colors.dim('  Aliases: /res, /find, /search'),
    '',
  ].join('\n'),
  '/client': [
    '',
    colors.bold(colors.cyan('  /client <action> [details]')),
    '',
    '  Manage clients. One client is "active" at a time — all commands default',
    '  to the active client. Switch with /client switch <id>.',
    '',
    colors.bold('  Actions:'),
    '    list               Show all clients',
    '    switch <id>        Change active client',
    '    new <name> <industry>  Create new client',
    '    voice              Show brand voice',
    '    voice set           Set brand voice (interactive)',
    '    pillars            Show content pillars',
    '    pillars add <text>  Add a content pillar',
    '    pillars remove <text>  Remove a content pillar',
    '    pillars set         Replace all pillars (interactive)',
    '    info               Show client details',
    '',
    colors.dim('  Aliases: /c'),
    '',
  ].join('\n'),
  '/approve': [
    '',
    colors.bold(colors.cyan('  /approve [job_id]')),
    '',
    '  Approve content that is pending review. Moves it to completion.',
    '  If no job ID is given, approves the most recent pending job.',
    '',
    colors.bold('  Examples:'),
    '    /approve',
    '    /approve job_abc123',
    '',
    colors.dim('  Aliases: /a, /ok, /yes, /lgtm'),
    '',
  ].join('\n'),
  '/revise': [
    '',
    colors.bold(colors.cyan('  /revise <feedback>')),
    '',
    '  Send content back for revision with your feedback.',
    '  The Draft/Polish agent will incorporate your notes and regenerate.',
    '',
    colors.bold('  Examples:'),
    '    /revise make it more casual and add a statistic',
    '    /revise stronger hook, remove the question at the end',
    '',
    colors.dim('  Aliases: /rev, /edit, /change, /fix'),
    '',
  ].join('\n'),
  '/schedule': [
    '',
    colors.bold(colors.cyan('  /schedule <job_id> <when>')),
    '',
    '  Schedule approved content for a specific date and time.',
    '',
    colors.bold('  Examples:'),
    '    /schedule tomorrow 9am',
    '    /schedule monday 10am EST',
    '',
    colors.dim('  Aliases: /sched, /post'),
    '',
  ].join('\n'),
  '/upload': [
    '',
    colors.bold(colors.cyan('  /upload <file_path>')),
    '',
    '  Upload a file to the active client\'s memory. Content is chunked and',
    '  vectorized so it can be referenced in /write commands.',
    '',
    colors.bold('  Supported formats:'),
    '    PDF, DOCX, TXT, MD, CSV, XLSX, JSON',
    '',
    colors.bold('  Examples:'),
    '    /upload brand-guidelines.pdf',
    '    /upload competitor-report.pdf',
    '    /upload analytics-export.csv',
    '',
    colors.bold('  Then reference in /write:'),
    '    /write a LinkedIn post based on brand-guidelines',
    '',
  ].join('\n'),
  '/uploads': [
    '',
    colors.bold(colors.cyan('  /uploads [action] [args]')),
    '',
    '  List and manage uploaded files for the active client.',
    '',
    colors.bold('  Actions:'),
    '    (no args)           List all uploads',
    '    show <file_id>      Preview file content',
    '    delete <file_id>    Delete an uploaded file',
    '    search <query>      Search uploads by name',
    '',
  ].join('\n'),
  '/read': [
    '',
    colors.bold(colors.cyan('  /read <file_path>')),
    '',
    '  Read and display a local file\'s contents in the CLI.',
    '  Useful for previewing files before uploading or referencing.',
    '',
    colors.bold('  Examples:'),
    '    /read ./report.txt',
    '    /read /Users/me/Documents/brief.md',
    '',
    colors.bold('  Limits:'),
    '    Max file size: 100KB, Max display: 200 lines',
    '',
  ].join('\n'),
  '/command': [
    '',
    colors.bold(colors.cyan('  /command <action> [name]')),
    '',
    '  Create, list, and manage custom prompt commands.',
    '',
    colors.bold('  Actions:'),
    '    new <name>          Create a new custom command (interactive)',
    '    list                Show all custom commands',
    '    delete <name>       Delete a custom command',
    '',
    colors.bold('  How it works:'),
    '    Custom commands are stored as .md files in ~/.luniero/commands/',
    '    Use $ARGUMENTS in the template to reference user input.',
    '',
    colors.bold('  Example:'),
    '    /command new social-audit → enter template → /social-audit acme',
    '',
  ].join('\n'),
};

// Map command → short usage line for error messages
const USAGE_HINTS: Record<string, string> = {
  '/write': '/write <description> — describe what content you need (e.g., /write a LinkedIn post about AI)',
  '/quick': '/quick <description> — describe what you need (e.g., /quick tweet about our launch)',
  '/calendar': '/calendar <timeframe> — specify a timeframe (e.g., /calendar this week)',
  '/report': '/report <type> — specify report type: weekly, monthly, campaign, performance',
  '/research': '/research <topic> — describe what to research (e.g., /research trending B2B topics)',
  '/client': '/client <action> — use: list, switch <id>, new, voice, pillars, info',
  '/schedule': '/schedule <job_id> <when> — specify job and date/time',
  '/upload': '/upload <file_path> — path to the file to upload',
  '/read': '/read <file_path> — path to the file to read',
  '/approve': '/approve [job_id] — approve the last or a specific pending job',
  '/revise': '/revise <feedback> — describe what to change',
};

export function getUsageHint(command: string): string | undefined {
  return USAGE_HINTS[command];
}

export function formatErrorWithHint(message: string, command: string): string {
  const hint = USAGE_HINTS[command];
  if (hint) {
    return `${formatError(message)}\n  ${colors.dim('Usage: ' + hint)}`;
  }
  return formatError(message);
}

export function getCommandList() {
  return COMMANDS;
}

export async function handleHelp(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, output } = ctx;

  // Command-specific help: /help write
  const topic = parsed.subcommand || parsed.args[0] || '';
  if (topic) {
    const key = topic.startsWith('/') ? topic : `/${topic}`;
    if (COMMAND_HELP[key]) {
      output(COMMAND_HELP[key]);
      return { session: withLastHandler(session, '/help') };
    }
    // Try to find the command in COMMANDS
    const found = COMMANDS.find(c => c.command === key || c.aliases.includes(key));
    if (found) {
      output(`\n  ${colors.bold(found.command)} — ${found.description}`);
      if (found.aliases.length > 0) {
        output(`  ${colors.dim('Aliases: ' + found.aliases.join(', '))}`);
      }
      output('');
      return { session: withLastHandler(session, '/help') };
    }
    output(formatInfo(`No help found for "${topic}". Showing all commands.`));
  }

  output(formatHelp(COMMANDS));

  // Show custom commands if any exist
  const customCommands = loadCustomCommands();
  if (customCommands.size > 0) {
    const lines = [
      colors.bold(colors.cyan('  Custom Commands')),
      '',
    ];
    for (const [cmdName, cmd] of customCommands) {
      const preview = cmd.promptTemplate.split('\n')[0].substring(0, 40);
      lines.push(`  ${colors.green(cmdName)}  ${colors.dim(preview)}`);
    }
    lines.push('');
    output(lines.join('\n'));
  }

  return { session: withLastHandler(session, '/help') };
}

