import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, colors } from '../formatter';
import { promptForMissing, promptForClient } from '../utils/prompts';

export async function handleRepurpose(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const description = parsed.topic || parsed.rawInput.replace(/^\/repurpose\s*/i, '').trim();
  if (!description) {
    output(formatInfo('Repurpose content between formats.'));
    output(formatInfo('Usage: /repurpose <source> to <target>'));
    output(formatInfo('Example: /repurpose blog to twitter thread'));
    return { session };
  }

  output(formatInfo(`Repurposing: ${description}`));
  output(formatInfo('Content repurposing is not yet implemented.'));
  output(formatInfo('This will convert content between platforms and formats (e.g., blog → Twitter thread).'));

  return { session: withLastHandler(session, '/repurpose') };
}

export async function handleTrending(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const topic = parsed.topic || parsed.subcommand || parsed.rawInput.replace(/^\/trending\s*/i, '').trim();

  output(formatInfo('Fetching trending topics...'));
  output(formatInfo('Trending topic analysis is not yet implemented.'));
  output(formatInfo('This will show trending topics in your industry from social platforms and news sources.'));

  if (topic) {
    output(formatInfo(`Filter: "${topic}"`));
  }

  return { session: withLastHandler(session, '/trending') };
}
