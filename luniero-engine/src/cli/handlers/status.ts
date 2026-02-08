import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatJobSummary, formatJobTable, formatContent, colors } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';

export async function handleStatus(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, output } = ctx;

  // If a job ID is given, show that specific job
  const jobId = parsed.subcommand || parsed.args[0] || session.lastJobId;
  if (jobId) {
    const job = await stateStore.getJob(jobId);
    if (!job) {
      output(formatError(`Job "${jobId}" not found.`));
      return { session: withLastHandler(session, '/status') };
    }
    output(formatJobSummary(job));
    return { session: withLastHandler(session, '/status') };
  }

  // Otherwise show recent jobs for active client
  if (!session.activeClientId) {
    output(formatInfo('No active client. Use /client switch <id> or /status <jobId>.'));
    return { session: withLastHandler(session, '/status') };
  }

  const jobs = await stateStore.getJobsByClient(session.activeClientId, 10);
  if (jobs.length === 0) {
    output(formatInfo(`No jobs found for client "${session.activeClientId}".`));
  } else {
    output(colors.bold(`\n  Recent jobs for ${session.activeClientId}:\n`));
    output(formatJobTable(jobs));
  }

  return { session: withLastHandler(session, '/status') };
}

export async function handleHistory(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, output } = ctx;

  if (!session.activeClientId) {
    output(formatError('No active client. Use /client switch first.'));
    return { session: withLastHandler(session, '/history') };
  }

  const limit = parseInt(parsed.flags.limit as string || '20', 10);
  const jobs = await stateStore.getJobsByClient(session.activeClientId, limit);

  if (jobs.length === 0) {
    output(formatInfo('No job history.'));
  } else {
    output(colors.bold(`\n  Job History for ${session.activeClientId} (${jobs.length} jobs):\n`));
    output(formatJobTable(jobs));
  }

  return { session: withLastHandler(session, '/history') };
}

export async function handleShow(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.subcommand || parsed.args[0] || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session: withLastHandler(session, '/show') };
  }

  output(formatJobSummary(job));

  if (job.output) {
    const content = typeof job.output === 'string' ? job.output : job.output.content || JSON.stringify(job.output, null, 2);
    output(formatContent(content, 'Output'));
  }
  if (job.brief) {
    const brief = typeof job.brief === 'string' ? job.brief : JSON.stringify(job.brief, null, 2);
    output(formatContent(brief, 'Brief'));
  }
  if (job.draft) {
    const draft = typeof job.draft === 'string' ? job.draft : job.draft.content || JSON.stringify(job.draft, null, 2);
    output(formatContent(draft, 'Draft'));
  }
  if (job.review) {
    output(formatContent(JSON.stringify(job.review, null, 2), 'Review'));
  }

  return { session: withLastHandler(session, '/show') };
}
