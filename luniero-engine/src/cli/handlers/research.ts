import Anthropic from '@anthropic-ai/sdk';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler, withPendingApproval, withConversation, ConversationMessage } from '../session';
import { formatError, formatContent, formatTaskComplete, withSpinner, buildTaskStatusContext } from '../formatter';
import { promptForClient, promptForMissing } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';
import { stateStore } from '../../core/state-store';
import { config } from '../../config';

export async function handleResearch(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const existingConversation = session.conversationMessages;
  const isFollowUp = existingConversation.length > 0 && session.lastHandler === '/research';

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
      output(formatError('A client is required.'));
      return { session };
    }

    const topic = await promptForMissing(rl, 'Research topic', parsed.topic || parsed.rawInput.replace(/^\/research\s*/i, '').trim() || undefined);
    if (!topic) {
      output(formatError('A topic is required.'));
      return { session };
    }
    userMessage = `Research: ${topic}`;
  }

  const text = await withSpinner(isFollowUp ? 'Thinking...' : `Researching...`, async () => {
    const [profile, brandVoice, contentPillars, relevantContext, clientJobs] = await Promise.all([
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
      'You are a marketing research analyst.',
      profile ? `Client: ${profile.name} (${profile.industry})` : '',
      brandVoice ? `Tone: ${brandVoice.tone}. Avoid: ${brandVoice.avoid.join(', ')}.${brandVoice.vocabulary?.length ? ` Vocabulary: ${brandVoice.vocabulary.join(', ')}.` : ''}` : '',
      contentPillars.length > 0 ? `Content pillars: ${contentPillars.join(', ')}` : '',
      docContext.length > 0
        ? `\nSource Document Content:\n${docContext.map(c => `- ${c.text}`).join('\n')}\n\nBase your research on this source material.`
        : '',
      otherContext.length > 0
        ? `\nRelevant Client Context:\n${otherContext.map(c => `- ${c.text}`).join('\n')}`
        : '',
      buildTaskStatusContext(clientJobs),
      'Provide structured research with:',
      '- Key trends and insights',
      '- Competitor landscape',
      '- Content opportunities',
      '- Recommended angles and topics',
      'Be data-driven and actionable.',
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

  output(formatContent(text, isFollowUp ? 'Follow-up' : 'Research'));
  output(formatTaskComplete());

  const updatedMessages: ConversationMessage[] = [
    ...existingConversation,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: text },
  ];

  let newSession = withPendingApproval(session, null);
  newSession = withLastHandler(newSession, '/research');
  newSession = withConversation(newSession, updatedMessages);
  return { session: newSession };
}
