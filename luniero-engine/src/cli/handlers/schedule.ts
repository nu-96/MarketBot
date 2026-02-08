import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatStatus, colors } from '../formatter';
import { formatErrorWithHint } from './help';
import { promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';

// Active schedule timers — keyed by job ID
const activeTimers = new Map<string, NodeJS.Timeout>();

function parseScheduleDate(input: string): Date | null {
  // Try direct parse first (handles ISO and "YYYY-MM-DD HH:MM" formats)
  const direct = new Date(input);
  if (!isNaN(direct.getTime())) return direct;

  // Try common relative patterns
  const lower = input.toLowerCase().trim();
  const now = new Date();

  // "tomorrow 9am", "tomorrow 3:45pm"
  const tomorrowMatch = lower.match(/^tomorrow\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    let hours = parseInt(tomorrowMatch[1], 10);
    const mins = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
    if (tomorrowMatch[3]?.toLowerCase() === 'pm' && hours < 12) hours += 12;
    if (tomorrowMatch[3]?.toLowerCase() === 'am' && hours === 12) hours = 0;
    d.setHours(hours, mins, 0, 0);
    return d;
  }

  // "today 3:45", "today 5pm"
  const todayMatch = lower.match(/^today\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (todayMatch) {
    const d = new Date(now);
    let hours = parseInt(todayMatch[1], 10);
    const mins = todayMatch[2] ? parseInt(todayMatch[2], 10) : 0;
    if (todayMatch[3]?.toLowerCase() === 'pm' && hours < 12) hours += 12;
    if (todayMatch[3]?.toLowerCase() === 'am' && hours === 12) hours = 0;
    d.setHours(hours, mins, 0, 0);
    return d;
  }

  // "YYYY-MM-DD H:MM" (without leading zero — new Date may fail on some engines)
  const dateTimeMatch = input.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/);
  if (dateTimeMatch) {
    const d = new Date(dateTimeMatch[1]);
    if (!isNaN(d.getTime())) {
      d.setHours(parseInt(dateTimeMatch[2], 10), parseInt(dateTimeMatch[3], 10), 0, 0);
      return d;
    }
  }

  return null;
}

function startScheduleTimer(jobId: string, scheduledDate: Date, topic: string) {
  // Cancel any existing timer for this job
  const existing = activeTimers.get(jobId);
  if (existing) clearTimeout(existing);

  const delay = scheduledDate.getTime() - Date.now();

  if (delay <= 0) {
    // Already past — fire immediately
    fireScheduleAlert(jobId, scheduledDate, topic);
    return;
  }

  // Cap at ~24.8 days (setTimeout max)
  const safeDelay = Math.min(delay, 2_147_483_647);

  const timer = setTimeout(() => {
    activeTimers.delete(jobId);
    fireScheduleAlert(jobId, scheduledDate, topic);
  }, safeDelay);

  // Don't block process exit
  if (timer.unref) timer.unref();

  activeTimers.set(jobId, timer);
}

function fireScheduleAlert(jobId: string, scheduledDate: Date, topic: string) {
  const bell = '\x07';
  const border = colors.magenta('━'.repeat(50));
  const timeStr = scheduledDate.toLocaleString();

  const alert = [
    bell,
    '',
    border,
    colors.bold(colors.magenta('  SCHEDULED CONTENT READY')),
    border,
    `  ${colors.bold('Job:')}       ${jobId}`,
    `  ${colors.bold('Topic:')}     ${topic}`,
    `  ${colors.bold('Scheduled:')} ${timeStr}`,
    '',
    `  ${colors.dim('/show ' + jobId.substring(0, 8) + ' — view content')}`,
    `  ${colors.dim('/publish ' + jobId.substring(0, 8) + ' — publish now')}`,
    border,
    '',
  ].join('\n');

  // Write directly to stdout (async alert outside REPL turn)
  process.stdout.write(alert + '\n');

  // Update job status to complete
  stateStore.updateJob(jobId, { status: 'complete' }).catch(() => {});
}

export async function handleSchedule(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.subcommand || parsed.args[0] || session.lastJobId || undefined);
  if (!jobId) {
    output(formatErrorWithHint('Job ID is required.', '/schedule'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session };
  }

  if (job.status !== 'complete') {
    output(formatErrorWithHint(`Job must be complete to schedule. Current status: ${job.status}`, '/schedule'));
    return { session: withLastHandler(session, '/schedule') };
  }

  const datetime = await promptForMissing(rl, 'Schedule date/time (e.g., 2026-03-15 10:00)', parsed.args[1] || parsed.flags.at as string || undefined);
  if (!datetime) {
    output(formatErrorWithHint('Schedule date/time is required.', '/schedule'));
    return { session };
  }

  // Update job status to scheduled
  await stateStore.updateJob(jobId, {
    status: 'scheduled',
    output: { ...(typeof job.output === 'object' ? job.output : { content: job.output }), scheduledAt: datetime },
  });

  // Start timer for the alert
  const scheduledDate = parseScheduleDate(datetime);
  if (scheduledDate) {
    startScheduleTimer(jobId, scheduledDate, job.input?.topic || 'N/A');
  }

  const border = colors.dim('━'.repeat(40));
  output([
    '',
    border,
    colors.green('  Scheduled Successfully'),
    border,
    `  ${colors.bold('Job:')}          ${jobId}`,
    `  ${colors.bold('Topic:')}        ${job.input?.topic || 'N/A'}`,
    `  ${colors.bold('Scheduled for:')} ${datetime}`,
    `  ${colors.bold('Status:')}       ${colors.magenta('scheduled')}`,
    border,
    '',
    colors.dim('  /queue — view scheduled jobs'),
    '',
  ].join('\n'));

  return { session: withLastHandler(session, '/schedule') };
}

export async function handlePublish(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.subcommand || parsed.args[0] || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session };
  }

  if (job.status !== 'complete') {
    output(formatError(`Job must be complete to publish. Current status: ${job.status}`));
    return { session: withLastHandler(session, '/publish') };
  }

  output(formatInfo('Direct publishing is coming soon. Use /export to get your content.'));

  return { session: withLastHandler(session, '/publish') };
}

export async function handleQueue(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const clientId = session.activeClientId;
  if (!clientId) {
    output(formatError('No active client. Use /client switch first.'));
    return { session };
  }

  const jobs = await stateStore.getJobsByClient(clientId);
  const inProgress = jobs.filter(j => j.status !== 'complete' && j.status !== 'failed' && j.status !== 'scheduled');
  const scheduled = jobs.filter(j => j.status === 'scheduled');

  if (inProgress.length === 0 && scheduled.length === 0) {
    output(formatInfo('No queued or scheduled jobs.'));
    return { session: withLastHandler(session, '/queue') };
  }

  output(colors.bold(`\n  Queue for ${clientId}\n`));

  // Show scheduled jobs
  if (scheduled.length > 0) {
    output(colors.bold(`  ${colors.magenta('Scheduled')} (${scheduled.length})\n`));
    for (const job of scheduled) {
      const scheduledAt = job.output?.scheduledAt || 'N/A';
      output(`  ${colors.dim(job.id)} ${colors.magenta('scheduled')} ${colors.dim('→')} ${scheduledAt}`);
      output(`    ${job.input?.topic || 'N/A'}`);
    }
    output('');
  }

  // Show in-progress jobs
  if (inProgress.length > 0) {
    output(colors.bold(`  In Progress (${inProgress.length})\n`));
    for (const job of inProgress) {
      output(`  ${colors.dim(job.id)} ${job.type} - ${formatStatus(job.status)} - ${job.input?.topic || 'N/A'}`);
    }
    output('');
  }

  return { session: withLastHandler(session, '/queue') };
}
