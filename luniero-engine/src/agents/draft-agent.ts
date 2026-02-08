import { BaseAgent } from '../core/agent-base';
import { stateStore } from '../core/state-store';
import { eventTypes, AgentEvent } from '../core/event-types';
import { logger } from '../utils/logger';

class DraftAgent extends BaseAgent {
  constructor() {
    super('draft-agent');
  }

  protected getDefaultSystemPrompt(): string {
    return `You are the Draft Agent for a marketing agency. You write compelling first drafts.

Your job:
1. Follow the brief EXACTLY
2. Match the client's brand voice
3. Hit the word count target (within 10%)
4. Write engaging content that achieves the goal

Rules:
- Hook the reader in the first sentence
- Every section should flow into the next
- Include keywords naturally (never stuff)
- End with a clear call-to-action
- Match the specified tone

Output the content only. No explanations or meta-commentary.`;
  }

  protected getSubscribedEvents() {
    return [eventTypes.BRIEF_READY, eventTypes.BRIEF_APPROVED, eventTypes.REVISION_REQUESTED];
  }

  protected async handleEvent(event: AgentEvent, job: any) {
    await stateStore.updateJob(event.jobId, { status: 'drafting' });

    // Handle revision requests
    let revisionContext = '';
    if (event.eventType === eventTypes.REVISION_REQUESTED) {
      const revision = event.payload;
      revisionContext = `
**REVISION REQUESTED:**
Previous draft had these issues:
${revision.issues.map((i: string) => `- ${i}`).join('\n')}

Please address these issues in your new draft.`;
    }

    const prompt = this.buildPrompt(job, revisionContext);
    const response = await this.callLLM([{ role: 'user', content: prompt }], {
      maxTokens: 8192,
      temperature: 0.8,
    });

    // Update job with draft
    await stateStore.updateJob(event.jobId, {
      draft: {
        content: response,
        wordCount: response.split(/\s+/).length,
        iteration: job.iteration,
      },
    });

    // Publish draft.ready
    await this.publish(
      eventTypes.DRAFT_READY,
      event.jobId,
      event.clientId,
      event.traceId,
      { content: response },
      event.eventId
    );

    logger.info(`Draft created for job ${event.jobId}`, {
      wordCount: response.split(/\s+/).length,
      iteration: job.iteration
    });
  }

  private buildPrompt(job: any, revisionContext: string): string {
    const brief = job.brief;

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
}

export const draftAgent = new DraftAgent();
