import Anthropic from '@anthropic-ai/sdk';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler, withPendingApproval, withConversation, ConversationMessage } from '../session';
import { formatContent, formatTaskComplete, withSpinner, buildTaskStatusContext } from '../formatter';
import { formatErrorWithHint } from './help';
import { promptForClient, promptForMissing } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';
import { stateStore } from '../../core/state-store';
import { config } from '../../config';

export async function handleCalendar(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const existingConversation = session.conversationMessages;
  const isFollowUp = existingConversation.length > 0 && session.lastHandler === '/calendar';

  let clientId: string | null;
  let userMessage: string;

  if (isFollowUp) {
    clientId = session.activeClientId;
    userMessage = parsed.rawInput;
    if (!clientId || !userMessage) {
      return { session };
    }
  } else {
    clientId = await promptForClient(rl, session.activeClientId);
    if (!clientId) {
      output(formatErrorWithHint('A client is required.', '/calendar'));
      return { session };
    }

    const weeks = parsed.args[0] || parsed.flags.weeks as string || '2';
    const focus = await promptForMissing(rl, 'Focus/theme (optional, press Enter to skip)', parsed.topic || undefined);

    const focusPart = focus ? ` Focus on: ${focus}.` : '';
    userMessage = `Create a ${weeks}-week content calendar.${focusPart}`;
  }

  const weeks = isFollowUp ? '' : (parsed.args[0] || parsed.flags.weeks as string || '2');

  const text = await withSpinner(isFollowUp ? 'Thinking...' : `Generating ${weeks}-week content calendar...`, async () => {
    const [profile, brandVoice, pillars, relevantContext, clientJobs] = await Promise.all([
      clientStore.getProfile(clientId!),
      clientStore.getBrandVoice(clientId!),
      clientStore.getContentPillars(clientId!),
      isFollowUp ? Promise.resolve([]) : clientStore.searchClientContext(clientId!, userMessage, 5),
      isFollowUp ? Promise.resolve([]) : stateStore.getJobsByClient(clientId!, 10),
    ]);

    const documentChunks = isFollowUp ? [] : await clientStore.searchByFileName(clientId!, userMessage);
    const allContext = [
      ...documentChunks,
      ...relevantContext.filter(r => !documentChunks.some(d => d.text === r.text)),
    ];
    const docContext = allContext.filter(c => c.metadata?.source === 'file_upload');
    const otherContext = allContext.filter(c => c.metadata?.source !== 'file_upload');

    const systemPrompt = [
      'You are a content calendar strategist.',
      profile ? `Client: ${profile.name} (${profile.industry})` : '',
      brandVoice ? `Tone: ${brandVoice.tone}. Avoid: ${brandVoice.avoid.join(', ')}.${brandVoice.vocabulary?.length ? ` Vocabulary: ${brandVoice.vocabulary.join(', ')}.` : ''}` : '',
      pillars.length > 0 ? `Content pillars: ${pillars.join(', ')}` : '',
      docContext.length > 0
        ? `\nSource Document Content:\n${docContext.map(c => `- ${c.text}`).join('\n')}\n\nBase your calendar on this source material.`
        : '',
      otherContext.length > 0
        ? `\nRelevant Client Context:\n${otherContext.map(c => `- ${c.text}`).join('\n')}`
        : '',
      buildTaskStatusContext(clientJobs),
      'Generate a structured content calendar in markdown table format.',
      'Include: date, platform, content type, topic, and key message for each entry.',
      profile?.platforms?.length ? `Available platforms: ${profile.platforms.map((p: any) => p.platform || p).join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const messages = [
      ...existingConversation.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userMessage },
    ];

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
          messages,
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timer);
    }

    return response.content.find(b => b.type === 'text')?.text || '';
  });

  const label = isFollowUp ? 'Follow-up' : `Content Calendar (${weeks} weeks)`;
  output(formatContent(text, label));
  output(formatTaskComplete());

  const updatedMessages: ConversationMessage[] = [
    ...existingConversation,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: text },
  ];

  let newSession = withPendingApproval(session, null);
  newSession = withLastHandler(newSession, '/calendar');
  newSession = withConversation(newSession, updatedMessages);
  return { session: newSession };
}
