import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatSuccess, formatInfo, colors } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';

export async function handleSchedule(ctx: HandlerContext): Promise<HandlerResult> {
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
    output(formatError(`Job must be complete to schedule. Current status: ${job.status}`));
    return { session: withLastHandler(session, '/schedule') };
  }

  const datetime = await promptForMissing(rl, 'Schedule date/time (e.g., 2024-01-15 10:00)', parsed.args[1] || parsed.flags.at as string || undefined);
  if (!datetime) {
    output(formatError('Schedule date/time is required.'));
    return { session };
  }

  await stateStore.updateJob(jobId, {
    output: { ...(typeof job.output === 'object' ? job.output : { content: job.output }), scheduledAt: datetime },
  });

  output(formatSuccess(`Job ${jobId} scheduled for ${datetime}`));
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

  // In a real implementation, this would publish to the platform API
  output(formatInfo(`Publishing job ${jobId}...`));
  output(formatSuccess(`Job ${jobId} marked as published. (Platform integration pending)`));

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
  const pending = jobs.filter(j => j.status !== 'complete' && j.status !== 'failed');

  if (pending.length === 0) {
    output(formatInfo('No queued jobs.'));
  } else {
    output(colors.bold(`\n  Queue for ${clientId}: ${pending.length} job(s)\n`));
    for (const job of pending) {
      output(`  ${colors.dim(job.id.substring(0, 8))} ${job.type} - ${colors.yellow(job.status)} - ${job.input?.topic || 'N/A'}`);
    }
    output('');
  }

  return { session: withLastHandler(session, '/queue') };
}
