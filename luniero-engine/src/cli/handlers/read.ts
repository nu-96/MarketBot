import { readFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatContent, colors } from '../formatter';
import { promptForMissing } from '../utils/prompts';

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_DISPLAY_LINES = 200;

export async function handleRead(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  // Build file path from subcommand + args (handles paths with spaces via quotes)
  const rawPath = [parsed.subcommand, ...parsed.args].filter(Boolean).join(' ') || undefined;
  const filePath = await promptForMissing(rl, 'File path', rawPath);

  if (!filePath) {
    output(formatError('File path is required.'));
    output(formatInfo('Usage: /read <path> — Read and display a local file'));
    return { session };
  }

  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    output(formatError(`File not found: ${resolved}`));
    return { session: withLastHandler(session, '/read') };
  }

  const stat = statSync(resolved);
  if (stat.isDirectory()) {
    output(formatError(`"${resolved}" is a directory. Provide a file path.`));
    return { session: withLastHandler(session, '/read') };
  }

  if (stat.size > MAX_FILE_SIZE) {
    output(formatError(`File is too large (${(stat.size / 1024).toFixed(1)}KB). Maximum: ${MAX_FILE_SIZE / 1024}KB.`));
    return { session: withLastHandler(session, '/read') };
  }

  try {
    const content = readFileSync(resolved, 'utf-8');
    const lines = content.split('\n');
    const truncated = lines.length > MAX_DISPLAY_LINES;
    const preview = truncated
      ? lines.slice(0, MAX_DISPLAY_LINES).join('\n') + `\n\n${colors.dim(`... ${lines.length - MAX_DISPLAY_LINES} more lines`)}`
      : content;

    output(formatContent(preview, resolved));
    output(formatInfo(`${lines.length} lines, ${(stat.size / 1024).toFixed(1)}KB`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output(formatError(`Failed to read file: ${message}`));
  }

  return { session: withLastHandler(session, '/read') };
}
