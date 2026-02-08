import { BaseAgent } from '../core/agent-base';
import { stateStore } from '../core/state-store';
import { eventTypes, AgentEvent } from '../core/event-types';
import { clientStore } from '../memory/client-store';

class ContextAgent extends BaseAgent {
  constructor() {
    super('context-agent');
  }

  protected getDefaultSystemPrompt(): string {
    return `You are the Context Agent. Your job is to load and organize client context for content creation.`;
  }

  protected getSubscribedEvents() {
    return [eventTypes.JOB_CREATED];
  }

  protected async handleEvent(event: AgentEvent, job: any) {
    // Load client context in parallel
    const [clientProfile, brandVoice, contentPillars, recentFeedback] = await Promise.all([
      clientStore.getProfile(event.clientId),
      clientStore.getBrandVoice(event.clientId),
      clientStore.getContentPillars(event.clientId),
      clientStore.getRecentFeedback(event.clientId, 5),
    ]);

    const context = {
      profile: clientProfile,
      brandVoice,
      contentPillars,
      recentFeedback,
      preferences: clientProfile?.preferences || {},
    };

    // Update job with context
    await stateStore.updateJob(event.jobId, {
      status: 'context_loading',
      context,
    });

    // Publish context.loaded
    await this.publish(
      eventTypes.CONTEXT_LOADED,
      event.jobId,
      event.clientId,
      event.traceId,
      context,
      event.eventId
    );
  }
}

export const contextAgent = new ContextAgent();
