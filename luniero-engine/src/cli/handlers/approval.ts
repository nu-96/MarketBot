import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler, withLastJob, withPendingApproval } from '../session';
import { formatError, formatSuccess, formatInfo, formatTaskComplete, shortId, createPulseSpinner, PulseSpinner } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';
import { clientStore } from '../../memory/client-store';
import { runPipeline } from '../pipeline';

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

  // Store the actual output content as a vector for future similarity matching
  if (newStatus === 'complete' && job.output) {
    const content = typeof job.output === 'string' ? job.output : job.output.content;
    if (content) {
      await clientStore.storeClientContext(job.clientId, {
        type: 'content',
        text: content.substring(0, 500),
        metadata: { jobId: job.id, type: job.type, topic: job.input?.topic },
      });
    }
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

  // Resolve job ID and inline feedback
  // When session has a pending job, all parsed text is feedback (e.g. "/revise Make this shorter")
  // When no session job, first arg is the job ID (e.g. "/revise job-1 Make it punchier")
  let jobId: string | undefined;
  let inlineFeedback: string | undefined;

  if (session.pendingApproval || session.lastJobId) {
    jobId = session.pendingApproval || session.lastJobId;
    inlineFeedback = [parsed.subcommand, ...parsed.args].filter(Boolean).join(' ') || undefined;
  } else {
    jobId = parsed.subcommand || parsed.args[0];
    inlineFeedback = parsed.subcommand
      ? parsed.args.join(' ') || undefined
      : parsed.args.slice(1).join(' ') || undefined;
  }

  if (!jobId) {
    output(formatError('No pending job to revise. Run /write first or specify a job ID.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${shortId(jobId)}" not found.`));
    return { session };
  }

  const feedback = await promptForMissing(rl, 'Revision notes', inlineFeedback);

  await stateStore.updateJob(jobId, {
    status: 'revision',
    review: { ...(job.review || {}), revisionNotes: feedback },
  });

  output(formatSuccess(`Job ${shortId(jobId)} sent back for revision.`));
  output(formatInfo('Re-running pipeline with your feedback'));

  // Re-run the pipeline with spinner feedback
  let activeSpinner: PulseSpinner | null = null;
  try {
    const finalJob = await runPipeline(jobId, {
      onStage: (status, label, formattedOutput) => {
        if (activeSpinner) { activeSpinner.stop(); activeSpinner = null; }
        if (formattedOutput) {
          output(formattedOutput);
        } else {
          activeSpinner = createPulseSpinner(label);
          activeSpinner.start();
        }
      },
    });

    if (activeSpinner) { activeSpinner.stop(); activeSpinner = null; }

    if (finalJob.status === 'human_review') {
      output(formatSuccess('Revised content ready — awaiting your approval'));
      output(formatInfo('Type "approve", "revise <feedback>", or "reject" to continue.'));
    }

    output(formatTaskComplete());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stateStore.updateJob(jobId, { status: 'failed', error: message });
    output(formatError(`Pipeline failed: ${message}`));
  } finally {
    if (activeSpinner) { activeSpinner.stop(); activeSpinner = null; }
  }

  let newSession = withPendingApproval(session, jobId);
  newSession = withLastJob(newSession, jobId);
  newSession = withLastHandler(newSession, '/revise');
  return { session: newSession };
}

export async function handleReject(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  // Same pattern as handleRevise: session-resolved job → all text is the reason
  let jobId: string | undefined;
  let inlineReason: string | undefined;

  if (session.pendingApproval || session.lastJobId) {
    jobId = session.pendingApproval || session.lastJobId;
    inlineReason = [parsed.subcommand, ...parsed.args].filter(Boolean).join(' ') || undefined;
  } else {
    jobId = parsed.subcommand || parsed.args[0];
    inlineReason = parsed.subcommand
      ? parsed.args.join(' ') || undefined
      : parsed.args.slice(1).join(' ') || undefined;
  }

  if (!jobId) {
    output(formatError('No pending job to reject. Run /write first or specify a job ID.'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${shortId(jobId)}" not found.`));
    return { session };
  }

  const reason = await promptForMissing(rl, 'Rejection reason', inlineReason);

  await stateStore.updateJob(jobId, {
    status: 'failed',
    error: `Rejected: ${reason || 'No reason given'}`,
  });

  output(formatSuccess(`Job ${shortId(jobId)} rejected.`));
  let newSession = withPendingApproval(session, null);
  newSession = withLastHandler(newSession, '/reject');
  return { session: newSession };
}
