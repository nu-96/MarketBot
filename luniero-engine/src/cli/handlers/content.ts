import Anthropic from '@anthropic-ai/sdk';
import { HandlerContext, HandlerResult } from '../router';
import { withLastHandler, withPendingApproval, withConversation, ConversationMessage } from '../session';
import { formatError, formatInfo, formatSuccess, formatContent, formatTaskComplete, withSpinner, buildTaskStatusContext } from '../formatter';
import { promptForClient } from '../utils/prompts';
import { clientStore } from '../../memory/client-store';
import { stateStore } from '../../core/state-store';
import { config } from '../../config';

function extractJobContent(job: any): string {
  if (job.output) {
    return typeof job.output === 'string' ? job.output : job.output.content || '';
  }
  if (job.polishedDraft) return job.polishedDraft.content || '';
  if (job.draft) return job.draft.content || '';
  return '';
}

export async function handleRepurpose(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const existingConversation = session.conversationMessages;
  const isFollowUp = existingConversation.length > 0 && session.lastHandler === '/repurpose';

  let clientId: string | null;
  let userMessage: string;
  let sourceJobId: string | undefined;
  let toType: string | undefined;

  if (isFollowUp) {
    clientId = session.activeClientId;
    userMessage = parsed.rawInput;
    if (!clientId || !userMessage) {
      return { session };
    }
  } else {
    // Parse: /repurpose <id> from <old-type> to <new-type>
    const rawArgs = [parsed.subcommand, ...parsed.args].filter(Boolean).join(' ').trim()
      || parsed.rawInput.replace(/^\/repurpose\s*/i, '').trim();

    if (!rawArgs) {
      output(formatInfo('Repurpose content between formats.'));
      output(formatInfo('Usage: /repurpose <id> from <old-type> to <new-type>'));
      output(formatInfo('Example: /repurpose job-12 from blog to twitter thread'));
      return { session };
    }

    // Extract id, from-type, to-type
    const match = rawArgs.match(/^(\S+)\s+from\s+(.+?)\s+to\s+(.+)$/i);
    if (!match) {
      output(formatError('Invalid format.'));
      output(formatInfo('Usage: /repurpose <id> from <old-type> to <new-type>'));
      output(formatInfo('Example: /repurpose job-12 from blog to twitter thread'));
      return { session };
    }

    const [, parsedJobId, fromType, parsedToType] = match;
    sourceJobId = parsedJobId;
    toType = parsedToType;

    clientId = await promptForClient(rl, session.activeClientId);
    if (!clientId) {
      output(formatError('A client is required.'));
      return { session };
    }

    // Look up the job and extract its content
    const job = await stateStore.getJob(sourceJobId);
    if (!job) {
      output(formatError(`Job "${sourceJobId}" not found.`));
      return { session };
    }

    const sourceContent = extractJobContent(job);
    if (!sourceContent) {
      output(formatError(`Job "${sourceJobId}" has no content to repurpose.`));
      return { session };
    }

    userMessage = `Repurpose the following ${fromType} content into a ${toType}:\n\n${sourceContent}`;
  }

  const text = await withSpinner(isFollowUp ? 'Thinking...' : 'Repurposing...', async () => {
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
      'You are a content repurposing specialist.',
      'Transform content from one format to another while maintaining the core message and adapting to the target platform\'s best practices.',
      profile ? `Client: ${profile.name} (${profile.industry})` : '',
      brandVoice ? `Tone: ${brandVoice.tone}. Avoid: ${brandVoice.avoid.join(', ')}.${brandVoice.vocabulary?.length ? ` Vocabulary: ${brandVoice.vocabulary.join(', ')}.` : ''}` : '',
      contentPillars.length > 0 ? `Content pillars: ${contentPillars.join(', ')}` : '',
      docContext.length > 0
        ? `\nSource Document Content:\n${docContext.map(c => `- ${c.text}`).join('\n')}\n\nBase your repurposing on this source material.`
        : '',
      otherContext.length > 0
        ? `\nRelevant Client Context:\n${otherContext.map(c => `- ${c.text}`).join('\n')}`
        : '',
      buildTaskStatusContext(clientJobs),
      'Provide the repurposed content ready to use.',
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

  output(formatContent(text, isFollowUp ? 'Follow-up' : 'Repurposed Content'));

  const updatedMessages: ConversationMessage[] = [
    ...existingConversation,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: text },
  ];

  // On first repurpose (not follow-up), create a job for approval
  // On follow-up, update the existing pending job's output
  let repurposeJobId = session.pendingApproval;

  if (!isFollowUp && clientId && sourceJobId) {
    const newJobId = `repurpose-${sourceJobId}-${Date.now()}`;
    try {
      await stateStore.createJob({
        id: newJobId,
        clientId,
        type: 'repurpose',
        status: 'human_review',
        input: { sourceJobId, toType },
        maxIterations: 1,
      });
      await stateStore.updateJob(newJobId, {
        output: { content: text },
      });
      repurposeJobId = newJobId;
    } catch {
      // If job creation fails, still show the content — just skip approval tracking
    }
    output(formatSuccess('Repurposed content ready — awaiting approval'));
    output(formatInfo('Type "approve", "revise <feedback>", or "reject". Or continue chatting to refine.'));
  } else if (isFollowUp && session.pendingApproval) {
    try {
      await stateStore.updateJob(session.pendingApproval, {
        output: { content: text },
      });
    } catch {
      // Silently continue if update fails
    }
    output(formatInfo('Content updated. Type "approve" to finalize, or keep chatting.'));
  } else {
    output(formatTaskComplete());
  }

  let newSession = withPendingApproval(session, repurposeJobId || null);
  newSession = withLastHandler(newSession, '/repurpose');
  newSession = withConversation(newSession, updatedMessages);
  return { session: newSession };
}

export async function handleTrending(ctx: HandlerContext): Promise<HandlerResult> {
  const { session, parsed, rl, output } = ctx;

  const existingConversation = session.conversationMessages;
  const isFollowUp = existingConversation.length > 0 && session.lastHandler === '/trending';

  let clientId: string | null;
  let userMessage: string;

  if (isFollowUp) {
    clientId = session.activeClientId;
    userMessage = parsed.rawInput;
    if (!clientId || !userMessage) {
      return { session };
    }
  } else {
    const topic = parsed.topic || parsed.subcommand || parsed.rawInput.replace(/^\/trending\s*/i, '').trim();

    clientId = await promptForClient(rl, session.activeClientId);
    if (!clientId) {
      output(formatError('A client is required.'));
      return { session };
    }

    userMessage = topic
      ? `Analyze trending topics related to: ${topic}`
      : 'Analyze current trending topics in the client\'s industry';
  }

  const text = await withSpinner(isFollowUp ? 'Thinking...' : 'Analyzing trending topics...', async () => {
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
      'You are a social media trend analyst.',
      'Identify current trending topics, hashtags, and content opportunities relevant to the client\'s industry.',
      profile ? `Client: ${profile.name} (${profile.industry})` : '',
      brandVoice ? `Tone: ${brandVoice.tone}. Avoid: ${brandVoice.avoid.join(', ')}.${brandVoice.vocabulary?.length ? ` Vocabulary: ${brandVoice.vocabulary.join(', ')}.` : ''}` : '',
      pillars.length > 0 ? `Content pillars: ${pillars.join(', ')}` : '',
      docContext.length > 0
        ? `\nSource Document Content:\n${docContext.map(c => `- ${c.text}`).join('\n')}\n\nBase your analysis on this source material.`
        : '',
      otherContext.length > 0
        ? `\nRelevant Client Context:\n${otherContext.map(c => `- ${c.text}`).join('\n')}`
        : '',
      buildTaskStatusContext(clientJobs),
      'Provide actionable trend insights with content angle suggestions.',
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

  output(formatContent(text, isFollowUp ? 'Follow-up' : 'Trending Topics'));
  output(formatTaskComplete());

  const updatedMessages: ConversationMessage[] = [
    ...existingConversation,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: text },
  ];

  let newSession = withPendingApproval(session, null);
  newSession = withLastHandler(newSession, '/trending');
  newSession = withConversation(newSession, updatedMessages);
  return { session: newSession };
}
