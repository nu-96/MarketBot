import { v4 as uuidv4 } from 'uuid';
import { HandlerContext, HandlerResult } from '../router';
import { withLastJob, withLastHandler, withPendingApproval } from '../session';
import { formatError, formatInfo, formatSuccess, formatTaskComplete, shortId, createPulseSpinner, PulseSpinner } from '../formatter';
import { formatErrorWithHint } from './help';
import { promptForClient, promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';
import { clientStore } from '../../memory/client-store';
import { runPipeline } from '../pipeline';

export async function handleWrite(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  // Ensure we have a client (--client flag takes priority)
  const clientFlag = parsed.flags.client as string || undefined;
  const clientId = clientFlag || await promptForClient(rl, session.activeClientId);
  if (!clientId) {
    output(formatErrorWithHint('A client is required. Use /client switch <id> or /client new first.', '/write'));
    return { session };
  }

  // Resolve content parameters from flags and NLP
  const type = (parsed.contentType || parsed.flags.type as string || 'social_post') as 'social_post' | 'blog_post' | 'report' | 'campaign';
  const platform = parsed.platform || parsed.flags.platform as string || undefined;
  const topic = await promptForMissing(rl, 'Topic', parsed.topic || parsed.args.join(' ') || undefined);

  if (!topic) {
    output(formatErrorWithHint('A topic is required.', '/write'));
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

  // Detect document references: check raw input, topic, and args for uploaded filenames
  // This ensures document context survives NLP topic extraction
  const documentRefs: string[] = [];
  try {
    const stats = await clientStore.getVectorStats(clientId);
    if (stats.documents.length > 0) {
      // Check the raw input (before NLP stripping) for any uploaded filename
      const rawLower = parsed.rawInput.toLowerCase();
      for (const doc of stats.documents) {
        const docName = doc.fileName.replace(/\.[^.]+$/, '').toLowerCase();
        // Match with underscores, hyphens, or spaces as interchangeable separators
        const pattern = docName.replace(/[-_]/g, '[-_ ]');
        const regex = new RegExp(`(?:^|\\s|\\b)${pattern}(?:\\.[a-z]+)?(?:\\s|\\b|$)`);
        if (regex.test(rawLower)) {
          documentRefs.push(doc.fileName);
        }
      }
      if (documentRefs.length > 0) {
        output(formatInfo(`Found uploaded document(s): ${documentRefs.join(', ')}`));
      }
    }
  } catch {
    // Non-critical — proceed without document detection
  }

  output(formatInfo(`Creating ${type} job for "${topic}"...`));

  // Create job directly in stateStore (no Redis publish)
  const jobId = uuidv4();
  await stateStore.createJob({
    id: jobId,
    clientId,
    type,
    status: 'received',
    input: { clientId, type, topic, platform, instructions: combinedInstructions, documentRefs: documentRefs.length > 0 ? documentRefs : undefined },
    maxIterations: 5,
  });

  output(formatSuccess(`Job created: ${shortId(jobId)} (full ID: ${jobId})`));
  output(formatInfo('Kicking off the pipeline'));

  // Run pipeline in-process with real-time progress
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
      output(formatSuccess('Content ready — awaiting your approval'));
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

  let newSession = withLastJob(session, jobId);
  newSession = withPendingApproval(newSession, jobId);
  newSession = withLastHandler(newSession, '/write');
  return { session: newSession };
}
