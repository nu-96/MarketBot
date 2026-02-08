import { BaseAgent } from '../core/agent-base';
import { stateStore } from '../core/state-store';
import { eventTypes, AgentEvent } from '../core/event-types';
import { logger } from '../utils/logger';

class ReviewAgent extends BaseAgent {
  constructor() {
    super('review-agent');
  }

  protected getDefaultSystemPrompt(): string {
    return `You are the Review Agent for a marketing agency. You ensure quality before delivery.

Your job:
1. Verify the content matches the brief
2. Check brand voice consistency
3. Validate word count and structure
4. Identify any issues

Output Format (JSON):
{
  "status": "approved" | "needs_revision" | "needs_human_review",
  "score": 0-100,
  "checks": {
    "brief_compliance": {"pass": true/false, "notes": "..."},
    "word_count": {"pass": true/false, "actual": N, "target": N},
    "brand_voice": {"pass": true/false, "confidence": 0.0-1.0},
    "structure": {"pass": true/false, "notes": "..."},
    "cta_present": {"pass": true/false},
    "hook_strength": {"pass": true/false, "notes": "..."}
  },
  "issues": ["Issue 1", "Issue 2"],
  "strengths": ["Strength 1", "Strength 2"]
}

Score Guidelines:
- 90-100: Excellent, ready to publish
- 80-89: Good, minor improvements possible
- 70-79: Acceptable, could be better
- Below 70: Needs revision`;
  }

  protected getSubscribedEvents() {
    return [eventTypes.POLISH_DONE];
  }

  protected async handleEvent(event: AgentEvent, job: any) {
    await stateStore.updateJob(event.jobId, { status: 'reviewing' });

    const prompt = this.buildPrompt(job);
    const response = await this.callLLM([{ role: 'user', content: prompt }], {
      temperature: 0.3, // Low temperature for consistent evaluation
    });

    const review = this.parseJsonResponse(response);

    // Update job with review
    await stateStore.updateJob(event.jobId, { review });

    // Determine next action based on review
    if (review.status === 'approved' || review.score >= 60) {
      await this.publish(
        eventTypes.REVIEW_PASSED,
        event.jobId,
        event.clientId,
        event.traceId,
        review,
        event.eventId
      );
      logger.info(`Review passed for job ${event.jobId}`, { score: review.score });
    } else if (review.status === 'needs_revision') {
      // Check iteration count
      const iteration = await stateStore.incrementIteration(event.jobId);
      const updatedJob = await stateStore.getJob(event.jobId);

      if (iteration >= (updatedJob?.maxIterations || 3)) {
        // Max iterations reached, send to human review
        await stateStore.updateJob(event.jobId, { status: 'human_review' });
        review.status = 'needs_human_review';
        review.notes = 'Max iterations reached';
      } else {
        // Request revision
        await this.publish(
          eventTypes.REVISION_REQUESTED,
          event.jobId,
          event.clientId,
          event.traceId,
          { issues: review.issues, iteration },
          event.eventId
        );
        logger.info(`Revision requested for job ${event.jobId}`, { iteration, issues: review.issues });
      }
    }

    if (review.status === 'needs_human_review') {
      await stateStore.updateJob(event.jobId, { status: 'human_review' });
      logger.info(`Human review required for job ${event.jobId}`);
    }
  }

  private buildPrompt(job: any): string {
    return `Review this content against the brief and brand guidelines:

**Content:**
${job.polishedDraft?.content || job.draft?.content}

**Brief:**
${JSON.stringify(job.brief, null, 2)}

**Brand Voice:**
${JSON.stringify(job.context?.brandVoice || {}, null, 2)}

Evaluate and output your review as JSON.`;
  }

  private parseJsonResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON found');
    } catch {
      return {
        status: 'needs_human_review',
        score: 0,
        checks: {},
        issues: ['Failed to parse review response'],
        strengths: [],
      };
    }
  }
}

export const reviewAgent = new ReviewAgent();
