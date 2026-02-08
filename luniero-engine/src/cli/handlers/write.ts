import { v4 as uuidv4 } from 'uuid';
import { HandlerContext, HandlerResult } from '../router';
import { withLastJob, withLastHandler, withPendingApproval } from '../session';
import { formatError, formatInfo, formatSuccess, formatJobSummary, formatContentOutput } from '../formatter';
import { promptForClient, promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';
import { runPipeline } from '../pipeline';

export async function handleWrite(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  // Ensure we have a client (--client flag takes priority)
  const clientFlag = parsed.flags.client as string || undefined;
  const clientId = clientFlag || await promptForClient(rl, session.activeClientId);
  if (!clientId) {
    output(formatError('A client is required. Use /client switch <id> or /client new first.'));
    return { session };
  }

  // Resolve content parameters from flags and NLP
  const type = (parsed.contentType || parsed.flags.type as string || 'social_post') as 'social_post' | 'blog_post' | 'report' | 'campaign';
  const platform = parsed.platform || parsed.flags.platform as string || undefined;
  const topic = await promptForMissing(rl, 'Topic', parsed.topic || parsed.args.join(' ') || undefined);

  if (!topic) {
    output(formatError('A topic is required.'));
    return { session };
  }

  // Spec flags: --tone, --length, --variations
  const tone = parsed.flags.tone as string || undefined;
  const length = parsed.flags.length as string || undefined;
  const variations = parseInt(parsed.flags.variations as string || '1', 10);
  const instructions = parsed.flags.instructions as string || undefined;

  // Build instructions string from flags
  const extraInstructions: string[] = [];
  if (tone) extraInstructions.push(`Tone: ${tone}`);
  if (length) extraInstructions.push(`Length: ${length}`);
  if (variations > 1) extraInstructions.push(`Generate ${variations} variations`);
  if (instructions) extraInstructions.push(instructions);

  const combinedInstructions = extraInstructions.length > 0 ? extraInstructions.join('. ') : undefined;

  output(formatInfo(`Creating ${type} job for "${topic}"...`));

  // Create job directly in stateStore (no Redis publish)
  const jobId = uuidv4();
  await stateStore.createJob({
    id: jobId,
    clientId,
    type,
    status: 'received',
    input: { clientId, type, topic, platform, instructions: combinedInstructions },
    maxIterations: 5,
  });

  output(formatSuccess(`Job created: ${jobId}`));
  output(formatInfo('Running pipeline...'));

  // Run pipeline in-process with real-time progress
  try {
    const finalJob = await runPipeline(jobId, {
      onStage: (status, label) => {
        output(formatInfo(label));
      },
    });

    if (finalJob.status === 'complete' || finalJob.status === 'human_review') {
      output(formatSuccess('Pipeline complete'));
    }
    output(formatJobSummary(finalJob));

    if (finalJob.output) {
      const content = typeof finalJob.output === 'string' ? finalJob.output : finalJob.output.content || JSON.stringify(finalJob.output);
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      output(formatContentOutput({
        content,
        platform: platform?.charAt(0).toUpperCase() + (platform?.slice(1) || ''),
        clientName: clientId,
        wordCount,
        score: finalJob.review?.score,
      }));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stateStore.updateJob(jobId, { status: 'failed', error: message });
    output(formatError(`Pipeline failed: ${message}`));
  }

  let newSession = withLastJob(session, jobId);
  newSession = withPendingApproval(newSession, jobId);
  newSession = withLastHandler(newSession, '/write');
  return { session: newSession };
}
