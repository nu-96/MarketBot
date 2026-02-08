import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler, withLastJob, withPendingApproval } from '../session';
import { formatError, formatSuccess, formatInfo, shortId } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';
import { clientStore } from '../../memory/client-store';

export async function handleApprove(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  let jobId = parsed.subcommand || parsed.args[0] || session.pendingApproval || session.lastJobId;
  if (!jobId) {
    output(formatError('No pending job to approve. Run /write first or specify a job ID.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${shortId(jobId)}" not found.`));
    return { session };
  }

  if (job.status !== 'human_review' && job.status !== 'brief_pending_approval') {
    output(formatError(`Job is in "${job.status}" state, not awaiting approval.`));
    return { session: withLastHandler(session, '/approve') };
  }

  const newStatus = job.status === 'brief_pending_approval' ? 'drafting' : 'complete';
  await stateStore.updateJob(jobId, { 
    status: newStatus as any,
    completedAt: newStatus === 'complete' ? new Date().toISOString() : undefined,
  });
  
  // Store interaction for future personalization when content is approved
  if (newStatus === 'complete' && job.review?.score) {
    await clientStore.storeClientContext(job.clientId, {
      type: 'content',
      text: `Created ${job.type} about "${job.input.topic}" for ${job.input.platform || 'general'}. Score: ${job.review.score}`,
      metadata: { jobId: job.id, score: job.review.score },
    });
  }
  
  output(formatSuccess(`Job ${shortId(jobId)} approved. Status → ${newStatus}`));
  output(formatInfo('Task complete. Ready for next command.'));

  let newSession = withPendingApproval(session, null);
  newSession = withLastJob(newSession, null as any);
  newSession = withLastHandler(newSession, null as any);
  return { session: newSession };
}

export async function handleRevise(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  let jobId = parsed.subcommand || parsed.args[0] || session.pendingApproval || session.lastJobId;
  if (!jobId) {
    output(formatError('No pending job to revise. Run /write first or specify a job ID.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${shortId(jobId)}" not found.`));
    return { session };
  }

  const feedback = await promptForMissing(rl, 'Revision notes', parsed.args.join(' ') || undefined);

  await stateStore.updateJob(jobId, {
    status: 'revision',
    review: { ...(job.review || {}), revisionNotes: feedback },
  });

  output(formatSuccess(`Job ${shortId(jobId)} sent back for revision.`));
  return { session: withLastHandler(session, '/revise') };
}

export async function handleReject(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  let jobId = parsed.subcommand || parsed.args[0] || session.pendingApproval || session.lastJobId;
  if (!jobId) {
    output(formatError('No pending job to reject. Run /write first or specify a job ID.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${shortId(jobId)}" not found.`));
    return { session };
  }

  const reason = await promptForMissing(rl, 'Rejection reason', parsed.args.join(' ') || undefined);

  await stateStore.updateJob(jobId, {
    status: 'failed',
    error: `Rejected: ${reason || 'No reason given'}`,
  });

  output(formatSuccess(`Job ${shortId(jobId)} rejected.`));
  let newSession = withPendingApproval(session, null);
  newSession = withLastHandler(newSession, '/reject');
  return { session: newSession };
}
