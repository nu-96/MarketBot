import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatSuccess, formatInfo, shortId } from '../formatter';
import { promptForMissing } from '../utils/prompts';
import { stateStore } from '../../core/state-store';

const EXPORT_DIR = join(__dirname, '../../../exports');

export async function handleExport(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const jobId = await promptForMissing(
    rl,
    'Job ID',
    parsed.args[0] || session.lastJobId || session.pendingApproval || undefined,
  );

  if (!jobId) {
    output(formatError('Job ID required. Usage: /export <jobId> [--format=md|json|txt]'));
    return { session };
  }

  const job = await stateStore.getJob(jobId);
  if (!job) {
    output(formatError(`Job "${shortId(jobId)}" not found.`));
    return { session };
  }

  if (!job.output && !job.polishedDraft && !job.draft) {
    output(formatError('Job has no content to export yet.'));
    return { session };
  }

  const format = (parsed.flags.format as string) || 'md';
  const content = job.output?.content || job.polishedDraft?.content || job.draft?.content || '';

  if (!existsSync(EXPORT_DIR)) {
    mkdirSync(EXPORT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `${job.clientId}-${job.type}-${timestamp}-${jobId.slice(0, 8)}.${format}`;
  const filepath = join(EXPORT_DIR, filename);

  let exportContent: string;

  switch (format) {
    case 'json':
      exportContent = JSON.stringify({
        id: job.id,
        client: job.clientId,
        type: job.type,
        platform: job.input?.platform,
        topic: job.input?.topic,
        content,
        brief: job.brief,
        review: job.review,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      }, null, 2);
      break;

    case 'txt':
      exportContent = content;
      break;

    case 'md':
    default:
      exportContent = `# ${job.brief?.title || job.input?.topic || 'Content'}

**Client:** ${job.clientId}
**Type:** ${job.type}
**Platform:** ${job.input?.platform || 'General'}
**Created:** ${new Date(job.createdAt).toLocaleDateString()}
${job.review?.score ? `**Score:** ${job.review.score}/100` : ''}

---

${content}

---

*Exported from Luniero Marketing Engine*
`;
      break;
  }

  writeFileSync(filepath, exportContent);
  output(formatSuccess(`Exported to: ${filepath}`));

  return { session: withLastHandler(session, '/export') };
}
