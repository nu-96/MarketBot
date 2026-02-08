import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler, withPendingApproval } from '../session';
import { formatError, formatSuccess, formatInfo } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';

export async function handleApprove(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.subcommand || parsed.args[0] || session.pendingApproval || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session };
  }

  if (job.status !== 'human_review' && job.status !== 'brief_pending_approval') {
    output(formatError(`Job is in "${job.status}" state, not awaiting approval.`));
    return { session: withLastHandler(session, '/approve') };
  }

  const newStatus = job.status === 'brief_pending_approval' ? 'drafting' : 'complete';
  await stateStore.updateJob(jobId, { status: newStatus as any });
  output(formatSuccess(`Job ${jobId} approved. Status → ${newStatus}`));

  let newSession = withPendingApproval(session, null);
  newSession = withLastHandler(newSession, '/approve');
  return { session: newSession };
}

export async function handleRevise(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.subcommand || parsed.args[0] || session.pendingApproval || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session };
  }

  const feedback = await promptForMissing(rl, 'Revision notes', parsed.args.join(' ') || undefined);

  await stateStore.updateJob(jobId, {
    status: 'revision',
    review: { ...(job.review || {}), revisionNotes: feedback },
  });

  output(formatSuccess(`Job ${jobId} sent back for revision.`));
  return { session: withLastHandler(session, '/revise') };
}

export async function handleReject(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(rl, 'Job ID', parsed.subcommand || parsed.args[0] || session.pendingApproval || session.lastJobId || undefined);
  if (!jobId) {
    output(formatError('Job ID is required.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${jobId}" not found.`));
    return { session };
  }

  const reason = await promptForMissing(rl, 'Rejection reason', parsed.args.join(' ') || undefined);

  await stateStore.updateJob(jobId, {
    status: 'failed',
    error: `Rejected: ${reason || 'No reason given'}`,
  });

  output(formatSuccess(`Job ${jobId} rejected.`));
  let newSession = withPendingApproval(session, null);
  newSession = withLastHandler(newSession, '/reject');
  return { session: newSession };
}
