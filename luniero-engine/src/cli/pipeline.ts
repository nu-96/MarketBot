import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config';
import { stateStore, Job } from '../core/state-store';
import { clientStore } from '../memory/client-store';
import { logger } from '../utils/logger';

export interface PipelineProgress {
  onStage: (status: string, label: string) => void;
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
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found in response');
  } catch {
    return null;
  }
}

// --- Prompt builders (replicate exact logic from agent classes) ---

function buildBriefPrompt(job: Job): string {
  return `Create a content brief for the following request:

**Request:**
- Type: ${job.input.type}
- Topic: ${job.input.topic}
- Platform: ${job.input.platform || 'general'}
${job.input.instructions ? `- Instructions: ${job.input.instructions}` : ''}

**Client Context:**
- Brand Voice: ${JSON.stringify(job.context?.brandVoice || {})}
- Content Pillars: ${JSON.stringify(job.context?.contentPillars || [])}
- Preferences: ${JSON.stringify(job.context?.preferences || {})}

Create a detailed brief in JSON format.`;
}

function buildDraftPrompt(job: Job, revisionIssues?: string[]): string {
  const brief = job.brief;

  let revisionContext = '';
  if (revisionIssues && revisionIssues.length > 0) {
    revisionContext = `
**REVISION REQUESTED:**
Previous draft had these issues:
${revisionIssues.map((i: string) => `- ${i}`).join('\n')}

Please address these issues in your new draft.`;
  }

  return `Write content based on this brief:

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
${revisionContext}

Write the content now. Output ONLY the final content, nothing else.`;
}

function buildPolishPrompt(job: Job): string {
  return `Polish this draft to match the brand voice and maximize engagement:

**Draft:**
${job.draft.content}

**Brief:**
- Type: ${job.brief.type}
- Tone: ${job.brief.tone}
- Platform: ${job.brief.platform || 'general'}

**Brand Voice:**
- Tone: ${job.context?.brandVoice?.tone || 'professional'}
- Avoid: ${JSON.stringify(job.context?.brandVoice?.avoid || [])}
- Examples: ${JSON.stringify(job.context?.brandVoice?.examples || [])}

Polish the content while maintaining the core message. Output ONLY the polished content.`;
}

function buildReviewPrompt(job: Job): string {
  return `Review this content against the brief and brand guidelines:

**Content:**
${job.polishedDraft?.content || job.draft?.content}

**Brief:**
${JSON.stringify(job.brief, null, 2)}

**Brand Voice:**
${JSON.stringify(job.context?.brandVoice || {}, null, 2)}

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
  progress.onStage('context_loading', 'Loading client context');
  let job = await stateStore.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const [clientProfile, brandVoice, contentPillars, recentFeedback] = await Promise.all([
    clientStore.getProfile(job.clientId),
    clientStore.getBrandVoice(job.clientId),
    clientStore.getContentPillars(job.clientId),
    clientStore.getRecentFeedback(job.clientId, 5),
  ]);

  const context = {
    profile: clientProfile,
    brandVoice,
    contentPillars,
    recentFeedback,
    preferences: clientProfile?.preferences || {},
  };

  job = await stateStore.updateJob(jobId, { status: 'context_loading', context });

  // --- Stage 2: Brief ---
  progress.onStage('briefing', 'Creating brief');
  job = await stateStore.updateJob(jobId, { status: 'briefing' });

  const briefResponse = await callLLM(anthropic, briefSystemPrompt, buildBriefPrompt(job));
  const brief = parseJson(briefResponse);
  if (!brief) throw new Error('Failed to parse brief from LLM response');

  job = await stateStore.updateJob(jobId, { brief });
  logger.info(`Brief created for job ${jobId}`, { title: brief.title });

  // --- Stage 3–5: Draft → Polish → Review loop ---
  const maxIterations = job.maxIterations || 3;
  let revisionIssues: string[] | undefined;

  for (let iteration = 0; iteration <= maxIterations; iteration++) {
    // --- Stage 3: Draft ---
    progress.onStage('drafting', iteration > 0 ? `Revising draft (iteration ${iteration + 1})` : 'Writing draft');
    job = await stateStore.updateJob(jobId, { status: 'drafting' });

    const draftResponse = await callLLM(anthropic, draftSystemPrompt, buildDraftPrompt(job, revisionIssues), {
      maxTokens: 8192,
      temperature: 0.8,
    });

    job = await stateStore.updateJob(jobId, {
      draft: {
        content: draftResponse,
        wordCount: draftResponse.split(/\s+/).length,
        iteration,
      },
    });
    logger.info(`Draft created for job ${jobId}`, { wordCount: draftResponse.split(/\s+/).length, iteration });

    // --- Stage 4: Polish ---
    progress.onStage('polishing', 'Polishing content');
    job = await stateStore.updateJob(jobId, { status: 'polishing' });

    const polishResponse = await callLLM(anthropic, polishSystemPrompt, buildPolishPrompt(job), {
      temperature: 0.5,
    });

    job = await stateStore.updateJob(jobId, {
      polishedDraft: {
        content: polishResponse,
        wordCount: polishResponse.split(/\s+/).length,
      },
    });
    logger.info(`Draft polished for job ${jobId}`);

    // --- Stage 5: Review ---
    progress.onStage('reviewing', 'Reviewing content');
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
      progress.onStage('human_review', 'Ready for your review');
      return job;
    }

    job = await stateStore.updateJob(jobId, { review });

    // Decide next action
    if (review.status === 'approved' || review.score >= 60) {
      // Approved — mark complete
      job = await stateStore.updateJob(jobId, {
        status: 'complete',
        output: job.polishedDraft || job.draft,
        completedAt: new Date().toISOString(),
      });
      progress.onStage('complete', 'Pipeline complete');
      logger.info(`Job completed: ${jobId}`, { score: review.score });
      return job;
    }

    if (review.status === 'needs_revision') {
      const newIteration = await stateStore.incrementIteration(jobId);

      if (newIteration >= maxIterations) {
        // Max iterations reached → human review
        job = await stateStore.updateJob(jobId, { status: 'human_review' });
        review.status = 'needs_human_review';
        review.notes = 'Max iterations reached';
        progress.onStage('human_review', 'Ready for your review (max iterations reached)');
        logger.info(`Max iterations reached for job ${jobId}`);
        return job;
      }

      // Loop back for revision
      revisionIssues = review.issues || [];
      progress.onStage('revision', 'Revising based on feedback');
      job = await stateStore.updateJob(jobId, { status: 'revision' });
      logger.info(`Revision requested for job ${jobId}`, { iteration: newIteration, issues: review.issues });
      continue;
    }

    // needs_human_review or unexpected status
    job = await stateStore.updateJob(jobId, { status: 'human_review' });
    progress.onStage('human_review', 'Ready for your review');
    logger.info(`Human review required for job ${jobId}`);
    return job;
  }

  // Fallback: if loop exhausts without returning
  job = await stateStore.updateJob(jobId, { status: 'human_review' });
  progress.onStage('human_review', 'Ready for your review (max iterations reached)');
  return job;
}
