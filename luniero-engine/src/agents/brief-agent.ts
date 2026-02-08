import { BaseAgent } from '../core/agent-base';
import { stateStore } from '../core/state-store';
import { eventTypes, AgentEvent } from '../core/event-types';
import { logger } from '../utils/logger';

class BriefAgent extends BaseAgent {
  constructor() {
    super('brief-agent');
  }

  protected getDefaultSystemPrompt(): string {
    return `You are the Brief Agent for a marketing agency. You create detailed content briefs.

Your job:
1. Analyze the content request and client context
2. Create a structured brief that will guide the Draft Agent
3. Include all necessary details: structure, key messages, tone, word count

Output Format (JSON):
{
  "title": "Proposed title",
  "type": "linkedin_post | twitter_thread | blog_post | etc",
  "targetAudience": "Who this is for",
  "keyMessages": ["Message 1", "Message 2"],
  "structure": [
    {"section": "hook", "notes": "What to include"},
    {"section": "body", "notes": "Main points"},
    {"section": "cta", "notes": "Call to action"}
  ],
  "wordCount": 150,
  "tone": "Professional but friendly",
  "platform": "linkedin",
  "hashtags": ["#relevant", "#tags"],
  "seo": {
    "primaryKeyword": "main keyword",
    "secondaryKeywords": ["other", "keywords"]
  }
}

Be specific. The Draft Agent will follow your brief exactly.`;
  }

  protected getSubscribedEvents() {
    return [eventTypes.CONTEXT_LOADED, eventTypes.RESEARCH_DONE];
  }

  protected async handleEvent(event: AgentEvent, job: any) {
    // Wait for both context and research (if research agent is running)
    // For MVP, proceed after context is loaded
    await stateStore.updateJob(event.jobId, { status: 'briefing' });

    const prompt = this.buildPrompt(job);
    const response = await this.callLLM([{ role: 'user', content: prompt }]);

    // Parse JSON from response
    const brief = this.parseJsonResponse(response);

    // Update job with brief
    await stateStore.updateJob(event.jobId, {
      brief,
      status: 'brief_pending_approval', // Or 'drafting' if auto-approve
    });

    // Publish brief.ready
    await this.publish(
      eventTypes.BRIEF_READY,
      event.jobId,
      event.clientId,
      event.traceId,
      brief,
      event.eventId
    );

    logger.info(`Brief created for job ${event.jobId}`, { title: brief.title });
  }

  private buildPrompt(job: any): string {
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

  private parseJsonResponse(response: string): any {
    try {
      // Extract JSON from response (might be wrapped in markdown)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON found in response');
    } catch (error) {
      logger.error('Failed to parse brief response', { response });
      throw error;
    }
  }
}

export const briefAgent = new BriefAgent();
