import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { stateStore, Job } from '../core/state-store';
import { clientStore } from '../memory/client-store';
import { logger } from '../utils/logger';
import { formatAgentOutput, colors } from './formatter';

export interface PipelineProgress {
  onStage: (status: string, label: string, formattedOutput?: string) => void;
}

const MODEL = 'claude-sonnet-4-20250514';
const LLM_TIMEOUT_MS = 120_000;

function loadSystemPrompt(agentName: string): string {
  try {
    const path = join(__dirname, '../../prompts/system', `${agentName}.md`);
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

async function callLLM(
  anthropic: Anthropic,
  systemPrompt: string,
  userPrompt: string,
  options?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: controller.signal },
    );

    const textBlock = response.content.find(block => block.type === 'text');
    return textBlock?.text || '';
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(response: string): any {
  // Try 1: Extract from markdown code block (```json ... ``` or ``` ... ```)
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* fall through */ }
  }

  // Try 2: Direct parse of the whole response
  try {
    return JSON.parse(response.trim());
  } catch { /* fall through */ }

  // Try 3: Find the outermost balanced JSON object
  const startIdx = response.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < response.length; i++) {
    const ch = response[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(response.substring(startIdx, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

// --- Prompt builders (replicate exact logic from agent classes) ---

function buildBriefPrompt(job: Job): string {
  let sourceDocumentSection = '';
  if (job.context?.relevantHistory?.length > 0) {
    const docChunks = job.context.relevantHistory.filter((h: any) => h.metadata?.source === 'file_upload');
    if (docChunks.length > 0) {
      sourceDocumentSection = `
**SOURCE DOCUMENTS (MANDATORY REFERENCE):**
The user has provided the following source material. The brief MUST be grounded in this content. Extract key messages, themes, and specific details directly from this material. Do NOT invent messages that aren't supported by the source.

${docChunks.map((h: any) => `--- Chunk ${(h.metadata?.chunkIndex ?? 0) + 1}/${h.metadata?.totalChunks ?? '?'} (${h.metadata?.fileName || 'unknown'}) ---\n${h.text}`).join('\n\n')}
--- End of source documents ---
`;
    }
  }

  return `Create a content brief for the following request:

**Request:**
- Type: ${job.input.type}
- Topic: ${job.input.topic}
- Platform: ${job.input.platform || 'general'}
${job.input.instructions ? `- Instructions: ${job.input.instructions}` : ''}
${sourceDocumentSection}
**Client Context:**
- Brand Voice: ${JSON.stringify(job.context?.brandVoice || {})}
- Content Pillars: ${JSON.stringify(job.context?.contentPillars || [])}
- Preferences: ${JSON.stringify(job.context?.preferences || {})}

Output ONLY a single valid JSON object (no markdown, no commentary, no explanation before or after).${sourceDocumentSection ? ' The keyMessages and structure MUST reference specific facts, features, and language from the source documents above. Do not fabricate claims.' : ''}`;
}

function buildDraftPrompt(job: Job, revisionIssues?: string[]): string {
  const brief = job.brief;

  let revisionContext = '';
  // Include human revision notes if present
  if (job.review?.revisionNotes) {
    revisionContext += `
**CLIENT REVISION FEEDBACK:**
The client has specifically requested: "${job.review.revisionNotes}"
This is the most important feedback to address — prioritize it above all else.
`;
  }
  if (revisionIssues && revisionIssues.length > 0) {
    revisionContext += `
**AUTOMATED REVIEW ISSUES:**
Previous draft had these issues:
${revisionIssues.map((i: string) => `- ${i}`).join('\n')}

Please address these issues in your new draft.`;
  }

  let relevantHistoryContext = '';
  if (job.context?.relevantHistory?.length > 0) {
    const docChunks = job.context.relevantHistory.filter((h: any) => h.metadata?.source === 'file_upload');
    const otherContext = job.context.relevantHistory.filter((h: any) => h.metadata?.source !== 'file_upload');

    if (docChunks.length > 0) {
      relevantHistoryContext += `
**SOURCE DOCUMENTS (PRIMARY REFERENCE — DO NOT IGNORE):**
The following is the actual source material the user wants this content based on. You MUST use specific facts, features, language, and details from this material. Do NOT fabricate statistics, claims, or features not present in the source. Every key claim in your output should trace back to something in this source material.

${docChunks.map((h: any) => `${h.text}`).join('\n\n')}
--- End of source documents ---`;
    }
    if (otherContext.length > 0) {
      relevantHistoryContext += `
**Other Relevant Context:**
${otherContext.map((h: any) => `- ${h.text}`).join('\n')}

Use these insights to inform your writing style and approach.`;
    }
  }

  const hasSourceDocs = job.context?.relevantHistory?.some((h: any) => h.metadata?.source === 'file_upload');

  return `Write the ACTUAL ${brief.type} content based on this brief.

**CRITICAL:** Output the real, publishable content itself — NOT tips, advice, or explanations about how to write it. Write it as if you are the copywriter delivering final work.${hasSourceDocs ? '\n\n**GROUNDING RULE:** Source documents are provided below. Your content MUST be grounded in that material. Reference specific features, facts, and language from the source. Do NOT make up statistics, percentages, or claims that are not in the source documents.' : ''}

**Brief:**
- Title: ${brief.title}
- Type: ${brief.type}
- Platform: ${brief.platform || 'general'}
- Target Audience: ${brief.targetAudience}
- Word Count: ${brief.wordCount}
- Tone: ${brief.tone}

**Key Messages:**
${brief.keyMessages.map((m: string) => `- ${m}`).join('\n')}

**Structure:**
${brief.structure.map((s: any) => `- ${s.section}: ${s.notes}`).join('\n')}

**Brand Voice:**
${JSON.stringify(job.context?.brandVoice || {})}
${relevantHistoryContext}
${revisionContext}

Now write the actual ${brief.type}. Output ONLY the content itself — no preamble, no "here's the post", no explanations.`;
}

function buildPolishPrompt(job: Job): string {
  let revisionContext = '';
  if (job.review?.revisionNotes) {
    revisionContext = `
**CLIENT REVISION FEEDBACK:**
The client has specifically requested: "${job.review.revisionNotes}"
Make sure the polished version fully addresses this feedback.
`;
  }

  let relevantHistoryContext = '';
  if (job.context?.relevantHistory?.length > 0) {
    const docChunks = job.context.relevantHistory.filter((h: any) => h.metadata?.source === 'file_upload');
    const otherContext = job.context.relevantHistory.filter((h: any) => h.metadata?.source !== 'file_upload');

    if (docChunks.length > 0) {
      relevantHistoryContext += `
**SOURCE DOCUMENTS (FACTUAL REFERENCE — DO NOT DEVIATE):**
The content below is the original source material. While polishing, do NOT introduce new claims, statistics, or features that are not present in this source. Improve the language and flow, but keep all factual content anchored to this material.

${docChunks.map((h: any) => `${h.text}`).join('\n\n')}
--- End of source documents ---`;
    }
    if (otherContext.length > 0) {
      relevantHistoryContext += `
**Client History & Preferences:**
${otherContext.map((h: any) => `- ${h.text}`).join('\n')}

Factor these preferences into the polished version.`;
    }
  }

  const hasSourceDocs = job.context?.relevantHistory?.some((h: any) => h.metadata?.source === 'file_upload');

  return `Polish this ${job.brief.type} draft to match the brand voice and maximize engagement.

**CRITICAL:** Output the polished content itself — NOT suggestions or tips on how to improve it. You are delivering the final polished version.${hasSourceDocs ? '\n\n**GROUNDING RULE:** Source documents are provided below. Do NOT introduce claims, statistics, or features not present in the source material. Improve delivery, not facts.' : ''}

**Draft to polish:**
${job.draft.content}

**Brief:**
- Type: ${job.brief.type}
- Tone: ${job.brief.tone}
- Platform: ${job.brief.platform || 'general'}

**Brand Voice:**
- Tone: ${job.context?.brandVoice?.tone || 'professional'}
- Avoid: ${JSON.stringify(job.context?.brandVoice?.avoid || [])}
- Examples: ${JSON.stringify(job.context?.brandVoice?.examples || [])}
${relevantHistoryContext}
${revisionContext}
Output ONLY the polished ${job.brief.type} content — no commentary, no "here's the improved version", just the content itself.`;
}

function buildReviewPrompt(job: Job): string {
  let sourceDocSection = '';
  if (job.context?.relevantHistory?.length > 0) {
    const docChunks = job.context.relevantHistory.filter((h: any) => h.metadata?.source === 'file_upload');
    if (docChunks.length > 0) {
      sourceDocSection = `
**SOURCE DOCUMENTS (verify content is grounded in these):**
${docChunks.map((h: any) => `${h.text}`).join('\n\n')}

IMPORTANT: Check that the content references specific facts, features, and details from these source documents. Flag as an issue if the content contains fabricated claims, made-up statistics, or features not present in the source material. Add a "source_fidelity" check to your review.`;
    }
  }

  return `Review this content against the brief and brand guidelines:

**Content:**
${job.polishedDraft?.content || job.draft?.content}

**Brief:**
${JSON.stringify(job.brief, null, 2)}

**Brand Voice:**
${JSON.stringify(job.context?.brandVoice || {}, null, 2)}
${sourceDocSection}

Evaluate and output your review as JSON.`;
}

// --- Main pipeline ---

export async function runPipeline(
  jobId: string,
  progress: PipelineProgress,
): Promise<Job> {
  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

  const briefSystemPrompt = loadSystemPrompt('brief-agent');
  const draftSystemPrompt = loadSystemPrompt('draft-agent');
  const polishSystemPrompt = loadSystemPrompt('polish-agent');
  const reviewSystemPrompt = loadSystemPrompt('review-agent');

  // --- Stage 1: Context ---
  progress.onStage('context_loading', `Pulling up your ${colors.bold('client info')}`);
  let job = await stateStore.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const [clientProfile, brandVoice, contentPillars, recentFeedback] = await Promise.all([
    clientStore.getProfile(job.clientId),
    clientStore.getBrandVoice(job.clientId),
    clientStore.getContentPillars(job.clientId),
    clientStore.getRecentFeedback(job.clientId, 5),
  ]);

  // Semantic search for relevant past interactions
  const relevantContext = await clientStore.searchClientContext(
    job.clientId,
    job.input.topic,
    3,
  );

  // Document-specific search: use explicit documentRefs from write handler (most reliable),
  // then fall back to topic-based filename matching
  let documentChunks: Awaited<ReturnType<typeof clientStore.searchByFileName>> = [];
  if (job.input.documentRefs?.length > 0) {
    for (const ref of job.input.documentRefs) {
      const chunks = await clientStore.searchByFileName(job.clientId, ref);
      documentChunks.push(...chunks);
    }
  }
  if (documentChunks.length === 0) {
    documentChunks = await clientStore.searchByFileName(job.clientId, job.input.topic);
  }

  logger.info(`Document context for job ${jobId}`, {
    documentRefs: job.input.documentRefs || [],
    chunksFound: documentChunks.length,
  });

  // Merge: document chunks first (explicit reference), then semantic results (deduplicated)
  const mergedContext = [
    ...documentChunks,
    ...relevantContext.filter(r => !documentChunks.some(d => d.text === r.text)),
  ];

  const context = {
    profile: clientProfile,
    brandVoice,
    contentPillars,
    recentFeedback,
    relevantHistory: mergedContext,
    preferences: clientProfile?.preferences || {},
  };

  job = await stateStore.updateJob(jobId, { status: 'context_loading', context });

  // --- Stage 2: Brief ---
  progress.onStage('briefing', `Thinking through the ${colors.bold('content brief')}`);
  job = await stateStore.updateJob(jobId, { status: 'briefing' });

  const briefResponse = await callLLM(anthropic, briefSystemPrompt, buildBriefPrompt(job), {
    temperature: 0.4,
  });
  const brief = parseJson(briefResponse);
  if (!brief) throw new Error('Failed to parse brief from LLM response');

  job = await stateStore.updateJob(jobId, { brief });
  progress.onStage('briefing', 'Brief ready', formatAgentOutput('brief', brief));
  logger.info(`Brief created for job ${jobId}`, { title: brief.title });

  // --- Stage 3–5: Draft → Polish → Review loop ---
  const maxIterations = job.maxIterations || 3;
  let revisionIssues: string[] | undefined;

  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    // --- Stage 3: Draft ---
    progress.onStage('drafting', iteration > 0 ? `Taking another pass at the ${colors.bold('draft')} (round ${iteration + 1})` : `Writing the ${colors.bold('first draft')}`);
    job = await stateStore.updateJob(jobId, { status: 'drafting' });

    const draftResponse = await callLLM(anthropic, draftSystemPrompt, buildDraftPrompt(job, revisionIssues), {
      maxTokens: 8192,
      temperature: 0.8,
    });

    const draftWordCount = draftResponse.split(/\s+/).length;
    job = await stateStore.updateJob(jobId, {
      draft: {
        content: draftResponse,
        wordCount: draftWordCount,
        iteration,
      },
    });
    progress.onStage('drafting', 'Draft done', formatAgentOutput('draft', { content: draftResponse, wordCount: draftWordCount }));
    logger.info(`Draft created for job ${jobId}`, { wordCount: draftWordCount, iteration });

    // --- Stage 4: Polish ---
    progress.onStage('polishing', `Polishing it up — tightening ${colors.bold('language')}, matching ${colors.bold('brand voice')}`);
    job = await stateStore.updateJob(jobId, { status: 'polishing' });

    const polishResponse = await callLLM(anthropic, polishSystemPrompt, buildPolishPrompt(job), {
      temperature: 0.5,
    });

    const polishWordCount = polishResponse.split(/\s+/).length;
    job = await stateStore.updateJob(jobId, {
      polishedDraft: {
        content: polishResponse,
        wordCount: polishWordCount,
      },
    });
    progress.onStage('polishing', 'Content polished', formatAgentOutput('polished', { content: polishResponse, wordCount: polishWordCount }));
    logger.info(`Draft polished for job ${jobId}`);

    // --- Stage 5: Review ---
    progress.onStage('reviewing', `Running ${colors.bold('quality checks')}`);
    job = await stateStore.updateJob(jobId, { status: 'reviewing' });

    const reviewResponse = await callLLM(anthropic, reviewSystemPrompt, buildReviewPrompt(job), {
      temperature: 0.3,
    });

    const review = parseJson(reviewResponse);

    if (!review) {
      // Parse failure → human review
      logger.error('Failed to parse review response', { jobId });
      job = await stateStore.updateJob(jobId, {
        status: 'human_review',
        review: {
          status: 'needs_human_review',
          score: 0,
          checks: {},
          issues: ['Failed to parse review response'],
          strengths: [],
        },
      });
      progress.onStage('human_review', 'Couldn\'t parse the review — flagging this for you to look at.');
      return job;
    }

    job = await stateStore.updateJob(jobId, { review });
    progress.onStage('reviewing', 'Review complete', formatAgentOutput('review', review));

    // Decide next action
    if (review.status === 'approved' || review.score >= 60) {
      // Content looks good — but ALWAYS require human approval before completing
      job = await stateStore.updateJob(jobId, {
        status: 'human_review',
        output: job.polishedDraft || job.draft,
      });
      progress.onStage('human_review', `Content ready (score: ${review.score}) — awaiting your approval.`);
      logger.info(`Job ready for approval: ${jobId}`, { score: review.score });
      return job;
    }

    if (review.status === 'needs_revision') {
      const newIteration = await stateStore.incrementIteration(jobId);

      if (newIteration >= maxIterations) {
        // Max iterations reached → human review
        job = await stateStore.updateJob(jobId, { status: 'human_review' });
        review.status = 'needs_human_review';
        review.notes = 'Max iterations reached';
        progress.onStage('human_review', 'Hit the max revision limit — needs your eyes on it.');
        logger.info(`Max iterations reached for job ${jobId}`);
        return job;
      }

      // Loop back for revision
      revisionIssues = review.issues || [];
      progress.onStage('revision', `Not quite there yet, going back for another ${colors.bold('revision')}`);
      job = await stateStore.updateJob(jobId, { status: 'revision' });
      logger.info(`Revision requested for job ${jobId}`, { iteration: newIteration, issues: review.issues });
      continue;
    }

    // needs_human_review or unexpected status
    job = await stateStore.updateJob(jobId, { status: 'human_review' });
    progress.onStage('human_review', 'This one needs your review before we can finalize it.');
    logger.info(`Human review required for job ${jobId}`);
    return job;
  }

  // Fallback: if loop exhausts without returning
  job = await stateStore.updateJob(jobId, { status: 'human_review' });
  progress.onStage('human_review', 'Hit the max revision limit — needs your eyes on it.');
  return job;
}
