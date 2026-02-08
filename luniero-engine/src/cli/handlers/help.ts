import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler, withDebug } from '../session';
import { formatHelp, formatInfo, colors } from '../formatter';

const COMMANDS = [
  { command: '/write', aliases: ['/w', '/create', '/draft', '/make'], description: 'Create content through the full pipeline' },
  { command: '/quick', aliases: ['/q', '/fast'], description: 'Quick single-shot LLM response' },
  { command: '/calendar', aliases: ['/cal', '/plan'], description: 'Generate a content calendar' },
  { command: '/report', aliases: ['/r', '/analytics', '/stats'], description: 'Generate reports and analytics' },
  { command: '/research', aliases: ['/res', '/find', '/search'], description: 'Research a topic via LLM' },
  { command: '/client', aliases: ['/c'], description: 'Manage clients (list/switch/new/voice/pillars)' },
  { command: '/approve', aliases: ['/a', '/ok', '/yes', '/lgtm'], description: 'Approve a job in review' },
  { command: '/revise', aliases: ['/rev', '/edit', '/change', '/fix'], description: 'Send a job back for revision' },
  { command: '/reject', aliases: ['/rej'], description: 'Reject a job' },
  { command: '/schedule', aliases: ['/sched', '/post'], description: 'Schedule a completed job' },
  { command: '/publish', aliases: ['/pub'], description: 'Publish a completed job' },
  { command: '/queue', aliases: ['/que'], description: 'View pending jobs queue' },
  { command: '/status', aliases: ['/s'], description: 'Show job status' },
  { command: '/history', aliases: ['/hist'], description: 'Show job history for client' },
  { command: '/show', aliases: ['/sh'], description: 'Show full job details and output' },
  { command: '/upload', aliases: [], description: 'Upload a file for processing' },
  { command: '/uploads', aliases: [], description: 'List and manage uploaded files' },
  { command: '/repurpose', aliases: [], description: 'Convert content between formats' },
  { command: '/trending', aliases: [], description: 'Get trending topics' },
  { command: '/help', aliases: ['/h', '/?'], description: 'Show this help message' },
  { command: '/settings', aliases: ['/set'], description: 'View/toggle settings' },
  { command: '/debug', aliases: ['/d'], description: 'Debug tools (status/job/trace/logs/agents/config/connections)' },
  { command: '/quit', aliases: ['/exit', '/bye'], description: 'Exit the CLI' },
];

const COMMAND_HELP: Record<string, string> = {
  '/write': [
    '',
    colors.bold(colors.cyan('  /write <description>')),
    '',
    '  Create content through the full Brief → Draft → Polish → Review pipeline.',
    '',
    colors.bold('  Examples:'),
    '    /write a LinkedIn post about AI trends for 2026',
    '    /write a Twitter thread on why startups should use AI automation',
    '    /write Instagram captions for our new product launch (5 variations)',
    '    /write email sequence for new client onboarding (3 emails)',
    '',
    colors.bold('  Flags:'),
    '    --client <id>       Specify client',
    '    --platform <name>   Force platform (linkedin, twitter, etc.)',
    '    --tone <tone>       Override tone (casual, formal, etc.)',
    '    --length <len>      Adjust length (short, medium, long)',
    '    --variations <n>    Generate multiple versions',
    '',
    colors.dim('  Aliases: /w, /create, /draft, /make'),
    '',
  ].join('\n'),
  '/quick': [
    '',
    colors.bold(colors.cyan('  /quick <description>')),
    '',
    '  Fast single-shot content. Skips the full pipeline for speed.',
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
    '  Generate a content calendar with post ideas.',
    '',
    colors.bold('  Examples:'),
    '    /calendar this week',
    '    /calendar next week linkedin',
    '    /calendar february instagram',
    '    /calendar q1 all',
    '',
    colors.dim('  Aliases: /cal, /plan'),
    '',
  ].join('\n'),
  '/report': [
    '',
    colors.bold(colors.cyan('  /report <type> [timeframe]')),
    '',
    '  Generate analytics reports.',
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
    '  Research a topic and get actionable insights.',
    '',
    colors.bold('  Examples:'),
    '    /research trending topics in B2B SaaS',
    '    /research what competitors are posting this week',
    '    /research best hashtags for project management content',
    '',
    colors.dim('  Aliases: /res, /find, /search'),
    '',
  ].join('\n'),
  '/client': [
    '',
    colors.bold(colors.cyan('  /client <action> [details]')),
    '',
    colors.bold('  Actions:'),
    '    list               Show all clients',
    '    switch <id>        Change active client',
    '    new <id> <name> <industry>  Create new client',
    '    voice              Show brand voice',
    '    pillars            Show content pillars',
    '    info               Show client details',
    '',
    colors.dim('  Aliases: /c'),
    '',
  ].join('\n'),
  '/debug': [
    '',
    colors.bold(colors.cyan('  /debug <action> [options]')),
    '',
    colors.bold('  Actions:'),
    '    status             System health overview',
    '    job <job_id>       Deep inspect a job',
    '    agents             Agent status and health',
    '    logs [count]       Recent system logs',
    '    trace <job_id>     Full event trace for a job',
    '    config             Show current configuration',
    '    connections        Test all API connections',
    '    retry <job_id>     Retry a failed job',
    '    cancel <job_id>    Cancel a stuck job',
    '    reset <job_id>     Reset job state',
    '    dump <job_id>      Export full job data',
    '    shell              Interactive debug mode',
    '',
    colors.bold('  Global debug flags (add to any command):'),
    '    --verbose          Extra output',
    '    --timing           Show timing breakdown',
    '    --raw              Show raw API responses',
    '    --dry-run          Simulate without executing',
    '',
    colors.dim('  Aliases: /d'),
    '',
  ].join('\n'),
};

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
  return { session: withLastHandler(session, '/help') };
}

export async function handleSettings(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, output } = ctx;

  const setting = parsed.subcommand.toLowerCase();

  if (setting === 'debug') {
    const newDebug = !session.debug;
    output(formatInfo(`Debug mode: ${newDebug ? 'ON' : 'OFF'}`));
    return { session: withDebug(withLastHandler(session, '/settings'), newDebug) };
  }

  // Show current settings
  const lines = [
    '',
    colors.bold(colors.cyan('  Settings')),
    '',
    `  ${colors.bold('Active Client:')} ${session.activeClientId || colors.dim('none')}`,
    `  ${colors.bold('Debug Mode:')}    ${session.debug ? colors.green('ON') : colors.dim('OFF')}`,
    `  ${colors.bold('Session Start:')} ${session.startedAt}`,
    `  ${colors.bold('History:')}       ${session.history.length} commands`,
    '',
    colors.dim('  Toggle: /settings debug'),
    '',
  ];

  output(lines.join('\n'));
  return { session: withLastHandler(session, '/settings') };
}
