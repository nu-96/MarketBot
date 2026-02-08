import Anthropic from '@anthropic-ai/sdk';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatContent } from '../formatter';
import { promptForClient, promptForMissing } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';
import { config } from '../../config';

export async function handleResearch(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const clientId = await promptForClient(rl, session.activeClientId);
  if (!clientId) {
    output(formatError('A client is required.'));
    return { session };
  }

  const topic = await promptForMissing(rl, 'Research topic', parsed.topic || parsed.rawInput.replace(/^\/research\s*/i, '').trim() || undefined);
  if (!topic) {
    output(formatError('A topic is required.'));
    return { session };
  }

  output(formatInfo(`Researching "${topic}"...`));

  const [profile, brandVoice] = await Promise.all([
    clientStore.getProfile(clientId),
    clientStore.getBrandVoice(clientId),
  ]);

  const systemPrompt = [
    'You are a marketing research analyst.',
    profile ? `Client: ${profile.name} (${profile.industry})` : '',
    'Provide structured research with:',
    '- Key trends and insights',
    '- Competitor landscape',
    '- Content opportunities',
    '- Recommended angles and topics',
    'Be data-driven and actionable.',
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
        messages: [{ role: 'user', content: `Research: ${topic}` }],
      },
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = response.content.find(b => b.type === 'text')?.text || '';
  output(formatContent(text, `Research: ${topic}`));

  return { session: withLastHandler(session, '/research') };
}
