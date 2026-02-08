import { BaseAgent } from '../core/agent-base';
import { stateStore } from '../core/state-store';
import { eventTypes, AgentEvent } from '../core/event-types';
import { logger } from '../utils/logger';

class PolishAgent extends BaseAgent {
  constructor() {
    super('polish-agent');
  }

  protected getDefaultSystemPrompt(): string {
    return `You are the Polish Agent for a marketing agency. You refine drafts to perfection.

Your job:
1. Ensure brand voice consistency
2. Improve readability and flow
3. Strengthen hooks and CTAs
4. Fix awkward phrasing
5. Verify the content matches the brief

Focus on:
- Voice consistency: Does it sound like the brand?
- Readability: Short sentences, clear structure
- Engagement: Strong hooks, smooth transitions
- Clarity: Remove jargon, simplify complexity
- Impact: Powerful opening and closing

Keep the original meaning. Improve the delivery.

Output ONLY the polished content. No explanations.`;
  }

  protected getSubscribedEvents() {
    return [eventTypes.DRAFT_READY];
  }

  protected async handleEvent(event: AgentEvent, job: any) {
    await stateStore.updateJob(event.jobId, { status: 'polishing' });

    const prompt = this.buildPrompt(job);
    const response = await this.callLLM([{ role: 'user', content: prompt }], {
      temperature: 0.5, // Lower temperature for more consistent polish
    });

    // Update job with polished draft
    await stateStore.updateJob(event.jobId, {
      polishedDraft: {
        content: response,
        wordCount: response.split(/\s+/).length,
      },
    });

    // Publish polish.done
    await this.publish(
      eventTypes.POLISH_DONE,
      event.jobId,
      event.clientId,
      event.traceId,
      { content: response },
      event.eventId
    );

    logger.info(`Draft polished for job ${event.jobId}`);
  }

  private buildPrompt(job: any): string {
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
}

export const polishAgent = new PolishAgent();
