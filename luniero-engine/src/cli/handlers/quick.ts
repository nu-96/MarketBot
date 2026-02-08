import Anthropic from '@anthropic-ai/sdk';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler } from '../session';
import { formatError, formatInfo, formatContent } from '../formatter';
import { promptForClient, promptForMissing } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';
import { config } from '../../config';

export async function handleQuick(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const clientId = await promptForClient(rl, session.activeClientId);
  if (!clientId) {
    output(formatError('A client is required.'));
    return { session };
  }

  const prompt = await promptForMissing(rl, 'What do you need?', parsed.topic || parsed.rawInput.replace(/^\/quick\s*/i, '').trim() || undefined);
  if (!prompt) {
    output(formatError('A prompt is required.'));
    return { session };
  }

  output(formatInfo('Thinking...'));

  // Load client context in parallel
  const [profile, brandVoice] = await Promise.all([
    clientStore.getProfile(clientId),
    clientStore.getBrandVoice(clientId),
  ]);

  const systemPrompt = [
    'You are a marketing content assistant.',
    profile ? `Client: ${profile.name} (${profile.industry})` : '',
    brandVoice ? `Tone: ${brandVoice.tone}. Avoid: ${brandVoice.avoid.join(', ')}` : '',
    'Be concise and actionable.',
  ].filter(Boolean).join('\n');

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await anthropic.messages.create(
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = response.content.find(b => b.type === 'text')?.text || '';
  output(formatContent(text, 'Quick Response'));

  return { session: withLastHandler(session, '/quick') };
}
