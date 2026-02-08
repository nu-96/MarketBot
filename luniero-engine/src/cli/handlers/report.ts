import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatJobTable, colors } from '../formatter';
import { promptForClient } from '../utils/prompts';
import { stateStore, Job } from '../../core/state-store';

export async function handleReport(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const clientId = await promptForClient(rl, session.activeClientId);
  if (!clientId) {
    output(formatError('A client is required.'));
    return { session };
  }

  const limit = parseInt(parsed.flags.limit as string || '20', 10);
  output(formatInfo(`Generating report for client "${clientId}"...`));

  const jobs = await stateStore.getJobsByClient(clientId, limit);

  if (jobs.length === 0) {
    output(formatInfo('No jobs found for this client.'));
    return { session: withLastHandler(session, '/report') };
  }

  // Analytics
  const total = jobs.length;
  const completed = jobs.filter(j => j.status === 'complete').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  const inProgress = jobs.filter(j => j.status !== 'complete' && j.status !== 'failed').length;

  const byType: Record<string, number> = {};
  for (const job of jobs) {
    byType[job.type] = (byType[job.type] || 0) + 1;
  }

  const avgIterations = completed > 0
    ? (jobs.filter(j => j.status === 'complete').reduce((sum, j) => sum + j.iteration, 0) / completed).toFixed(1)
    : 'N/A';

  const lines = [
    '',
    colors.bold(colors.cyan(`  Job Report: ${clientId}`)),
    '',
    `  ${colors.bold('Total Jobs:')}      ${total}`,
    `  ${colors.bold('Completed:')}       ${colors.green(String(completed))}`,
    `  ${colors.bold('Failed:')}          ${colors.red(String(failed))}`,
    `  ${colors.bold('In Progress:')}     ${colors.yellow(String(inProgress))}`,
    `  ${colors.bold('Avg Iterations:')} ${avgIterations}`,
    '',
    colors.bold('  By Type:'),
    ...Object.entries(byType).map(([type, count]) => `    ${type}: ${count}`),
    '',
    colors.bold('  Recent Jobs:'),
  ];

  output(lines.join('\n'));
  output(formatJobTable(jobs.slice(0, 10)));

  return { session: withLastHandler(session, '/report') };
}
