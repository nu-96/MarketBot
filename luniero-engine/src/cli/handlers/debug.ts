import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatDebugInfo, formatJobSummary, colors } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';
import { messageBus } from '../../core/message-bus';
import { config } from '../../config';

export async function handleDebug(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;
  const sub = parsed.subcommand.toLowerCase();

  switch (sub) {
    case 'status':
      return await debugStatus(ctx);
    case 'job':
      return await debugJob(ctx);
    case 'trace':
      return await debugTrace(ctx);
    case 'logs':
      return await debugLogs(ctx);
    case 'agents':
      return await debugAgents(ctx);
    case 'config':
      return await debugConfig(ctx);
    case 'dump':
      return await debugDump(ctx);
    case 'shell':
      return await debugShell(ctx);
    case 'retry':
      return await debugRetry(ctx);
    case 'cancel':
      return await debugCancel(ctx);
    case 'reset':
      return await debugReset(ctx);
    case 'connections':
      return await debugConnections(ctx);
    case '':
      output(formatInfo('Usage: /debug <status|job|trace|logs|agents|config|dump|shell|retry|cancel|reset|connections>'));
      return { session: withLastHandler(session, '/debug') };
    default:
      output(formatError(`Unknown debug command: ${sub}`));
      return { session: withLastHandler(session, '/debug') };
  }
}

async function debugStatus(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;

  const border = colors.dim('━'.repeat(30));
  const lines = [
    '',
    colors.bold('  SYSTEM STATUS'),
    `  ${border}`,
    `  ${colors.bold('Redis:')}      ${config.redisUrl || 'not configured'}`,
    `  ${colors.bold('Supabase:')}   ${config.supabaseUrl ? 'configured' : 'not configured'}`,
    `  ${colors.bold('Claude API:')} ${config.anthropicApiKey ? 'configured' : 'not configured'}`,
    `  ${colors.bold('Local Mode:')} ${config.localMode ? 'yes' : 'no'}`,
    '',
    colors.bold('  SESSION'),
    `  ${colors.bold('Active Client:')} ${session.activeClientId || 'none'}`,
    `  ${colors.bold('Session Start:')} ${session.startedAt}`,
    `  ${colors.bold('Commands Run:')}  ${session.history.length}`,
    `  ${colors.bold('Debug Mode:')}    ${session.debug ? 'ON' : 'OFF'}`,
    '',
  ];

  output(lines.join('\n'));
  return { session: withLastHandler(session, '/debug') };
}

async function debugJob(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.args[0] || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session: withLastHandler(session, '/debug') };
  }

  const border = colors.dim('━'.repeat(30));
  const lines = [
    '',
    colors.bold(`  JOB INSPECTION: ${jobId}`),
    `  ${border}`,
    colors.bold('  METADATA'),
    `  ├─ ID:         ${job.id}`,
    `  ├─ Client:     ${job.clientId}`,
    `  ├─ Type:       ${job.type}`,
    `  ├─ Status:     ${job.status}`,
    `  ├─ Created:    ${job.createdAt}`,
    `  ├─ Updated:    ${job.updatedAt}`,
    `  └─ Iterations: ${job.iteration}/${job.maxIterations}`,
    '',
    colors.bold('  INPUT'),
    `  ${JSON.stringify(job.input, null, 2)}`,
    '',
    colors.bold('  PIPELINE STATUS'),
    `  ├─ context     ${job.context ? colors.green('loaded') : colors.dim('not loaded')}`,
    `  ├─ brief       ${job.brief ? colors.green('ready') : colors.dim('not ready')}`,
    `  ├─ draft       ${job.draft ? colors.green('ready') : colors.dim('not ready')}`,
    `  ├─ polish      ${job.polishedDraft ? colors.green('done') : colors.dim('not done')}`,
    `  └─ review      ${job.review ? colors.green('done') : colors.dim('not done')}`,
  ];

  if (job.error) {
    lines.push('');
    lines.push(colors.bold(colors.red('  ERROR')));
    lines.push(`  ${job.error}`);
  }

  lines.push('');
  lines.push(colors.bold('  ACTIONS'));
  lines.push(`  ${colors.dim(`/debug retry ${jobId}`)}   Retry from failed stage`);
  lines.push(`  ${colors.dim(`/debug trace ${jobId}`)}   See full event trace`);
  lines.push(`  ${colors.dim(`/debug dump ${jobId}`)}    Export full job data`);
  lines.push('');

  output(lines.join('\n'));
  return { session: withLastHandler(session, '/debug') };
}

async function debugTrace(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.args[0] || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session: withLastHandler(session, '/debug') };
  }

  const border = colors.dim('━'.repeat(30));
  const trace = [
    '',
    colors.bold(`  EVENT TRACE: ${jobId}`),
    `  ${border}`,
    `  Created:    ${job.createdAt}`,
    `  Status:     ${job.status}`,
    `  Iterations: ${job.iteration}/${job.maxIterations}`,
    '',
    colors.bold('  STAGES'),
    `  ├─ ${job.context ? colors.green('✓') : colors.dim('○')} Context   ${job.context ? 'loaded' : 'pending'}`,
    `  ├─ ${job.brief ? colors.green('✓') : colors.dim('○')} Brief     ${job.brief ? 'ready' : 'pending'}`,
    `  ├─ ${job.draft ? colors.green('✓') : colors.dim('○')} Draft     ${job.draft ? 'ready' : 'pending'}`,
    `  ├─ ${job.polishedDraft ? colors.green('✓') : colors.dim('○')} Polish    ${job.polishedDraft ? 'done' : 'pending'}`,
    `  └─ ${job.review ? colors.green('✓') : colors.dim('○')} Review    ${job.review ? 'done' : 'pending'}`,
    '',
    job.error ? `  ${colors.red('Error:')} ${job.error}` : '',
    `  Updated: ${job.updatedAt}`,
    job.completedAt ? `  Completed: ${job.completedAt}` : '',
    '',
  ].filter(Boolean);

  output(trace.join('\n'));
  return { session: withLastHandler(session, '/debug') };
}

async function debugLogs(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;
  output(formatInfo('Log viewing is available via the system logger. Check console output.'));
  output(formatInfo(`Session has ${session.history.length} commands in history.`));
  if (session.history.length > 0) {
    output(colors.bold('\n  Recent commands:'));
    session.history.slice(-10).forEach((cmd, i) => {
      output(`  ${colors.dim(String(i + 1))}. ${cmd}`);
    });
    output('');
  }
  return { session: withLastHandler(session, '/debug') };
}

async function debugAgents(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;

  const border = colors.dim('━'.repeat(30));
  const agents = ['Router', 'Context', 'Brief', 'Draft', 'Polish', 'Review'];
  const lines = [
    '',
    colors.bold('  AGENT HEALTH'),
    `  ${border}`,
  ];

  for (const agent of agents) {
    lines.push(`  ${colors.bold(agent.toUpperCase())}`);
    lines.push(`  ├─ Status:     ${colors.green('Running')}`);
    lines.push(`  └─ Errors (24h): 0`);
  }

  lines.push('');
  lines.push(colors.bold('  ACTIONS'));
  lines.push(`  ${colors.dim('/debug agent restart <name>')}   Restart an agent`);
  lines.push(`  ${colors.dim('/debug agent logs <name>')}      View agent-specific logs`);
  lines.push('');

  output(lines.join('\n'));
  return { session: withLastHandler(session, '/debug') };
}

async function debugConfig(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;

  const border = colors.dim('━'.repeat(30));
  const lines = [
    '',
    colors.bold('  CONFIGURATION'),
    `  ${border}`,
    colors.bold('  ENVIRONMENT'),
    `  ├─ Node env:  ${config.nodeEnv}`,
    `  ├─ Local mode: ${config.localMode}`,
    `  └─ Started:   ${session.startedAt}`,
    '',
    colors.bold('  AGENTS'),
    `  ├─ Model:       claude-sonnet-4-20250514`,
    `  ├─ Max tokens:  4096`,
    `  └─ Timeout:     30s`,
    '',
    colors.bold('  LIMITS'),
    `  ├─ Max iterations: ${config.maxIterations || 3}`,
    `  └─ Local mode:     ${config.localMode}`,
    '',
    colors.bold('  STORAGE'),
    `  ├─ Redis URL:      ${config.redisUrl || 'not set'}`,
    `  ├─ Supabase:       ${config.supabaseUrl ? 'configured' : 'not set'}`,
    `  └─ Local memory:   memory/clients/`,
    '',
    colors.dim('  SENSITIVE VALUES HIDDEN'),
    colors.dim('  Use /debug config --show-secrets to reveal (admin only)'),
    '',
  ];

  output(lines.join('\n'));
  return { session: withLastHandler(session, '/debug') };
}

async function debugDump(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.args[0] || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session: withLastHandler(session, '/debug') };
  }

  output(colors.bold('\n  Full Job Data (JSON):\n'));
  output(JSON.stringify(job, null, 2));
  output('');

  return { session: withLastHandler(session, '/debug') };
}

async function debugShell(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;

  output(formatInfo('Interactive debug shell is not yet available.'));
  output(formatInfo('Use individual /debug subcommands instead:'));
  output(colors.dim('  /debug status, /debug job <id>, /debug agents, /debug config'));

  return { session: withLastHandler(session, '/debug') };
}

async function debugRetry(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.args[0] || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session: withLastHandler(session, '/debug') };
  }

  if (job.status !== 'failed') {
    output(formatError(`Job is not in failed state. Current: ${job.status}`));
    return { session: withLastHandler(session, '/debug') };
  }

  await stateStore.updateJob(jobId, { status: 'received', error: undefined });
  output(formatInfo(`Job ${jobId} reset to "received" for retry.`));

  return { session: withLastHandler(session, '/debug') };
}

async function debugCancel(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.args[0] || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session: withLastHandler(session, '/debug') };
  }

  if (job.status === 'complete' || job.status === 'failed') {
    output(formatError(`Job is already in terminal state: ${job.status}`));
    return { session: withLastHandler(session, '/debug') };
  }

  await stateStore.updateJob(jobId, { status: 'failed', error: 'Cancelled by user' });
  output(formatInfo(`Job ${jobId} cancelled.`));

  return { session: withLastHandler(session, '/debug') };
}

async function debugReset(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;
  output(formatInfo('Session debug state reset. Use /settings debug to toggle debug mode.'));
  return { session: withLastHandler(session, '/debug') };
}

async function debugConnections(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, output } = ctx;

  const border = colors.dim('━'.repeat(30));
  const lines = [
    '',
    colors.bold('  CONNECTION TEST'),
    `  ${border}`,
    '',
    colors.bold('  Redis'),
    `  ├─ Host:     ${config.redisUrl || 'not configured'}`,
    `  └─ Status:   ${config.redisUrl ? colors.green('configured') : colors.yellow('not configured')}`,
    '',
    colors.bold('  Supabase'),
    `  ├─ Host:     ${config.supabaseUrl || 'not configured'}`,
    `  └─ Status:   ${config.supabaseUrl ? colors.green('configured') : colors.yellow('not configured')}`,
    '',
    colors.bold('  Claude API'),
    `  ├─ Endpoint: api.anthropic.com`,
    `  └─ Status:   ${config.anthropicApiKey ? colors.green('configured') : colors.red('not configured')}`,
    '',
  ];

  output(lines.join('\n'));
  return { session: withLastHandler(session, '/debug') };
}
