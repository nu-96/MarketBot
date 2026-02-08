import Anthropic from '@anthropic-ai/sdk';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatContent } from '../formatter';
import { promptForClient, promptForMissing } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';
import { config } from '../../config';

export async function handleCalendar(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const clientId = await promptForClient(rl, session.activeClientId);
  if (!clientId) {
    output(formatError('A client is required.'));
    return { session };
  }

  const weeks = parsed.args[0] || parsed.flags.weeks as string || '2';
  const focus = await promptForMissing(rl, 'Focus/theme (optional, press Enter to skip)', parsed.topic || undefined);

  output(formatInfo(`Generating ${weeks}-week content calendar...`));

  const [profile, pillars] = await Promise.all([
    clientStore.getProfile(clientId),
    clientStore.getContentPillars(clientId),
  ]);

  const systemPrompt = [
    'You are a content calendar strategist.',
    profile ? `Client: ${profile.name} (${profile.industry})` : '',
    pillars.length > 0 ? `Content pillars: ${pillars.join(', ')}` : '',
    'Generate a structured content calendar in markdown table format.',
    'Include: date, platform, content type, topic, and key message for each entry.',
  ].filter(Boolean).join('\n');

  const userPrompt = [
    `Create a ${weeks}-week content calendar.`,
    focus ? `Focus on: ${focus}` : '',
    profile?.platforms?.length ? `Platforms: ${profile.platforms.map((p: any) => p.platform || p).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let response;
  try {
    response = await anthropic.messages.create(
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = response.content.find(b => b.type === 'text')?.text || '';
  output(formatContent(text, `Content Calendar (${weeks} weeks)`));
  output('');
  output('Approve this calendar? (yes/edit/regenerate)');

  return { session: withLastHandler(session, '/calendar') };
}
