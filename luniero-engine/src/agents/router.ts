import { v4 as uuidv4 } from 'uuid';
import { messageBus } from '../core/message-bus';
import { stateStore } from '../core/state-store';
import { eventTypes, AgentEvent } from '../core/event-types';
import { logger } from '../utils/logger';

export interface JobRequest {
  clientId: string;
  type: 'social_post' | 'blog_post' | 'report' | 'campaign';
  platform?: string;
  topic: string;
  instructions?: string;
}

class RouterAgent {
  name = 'router';

  async start() {
    // Router listens for job.complete to finalize
    messageBus.subscribe([eventTypes.REVIEW_PASSED], async (event) => {
      await this.handleReviewPassed(event);
    });

    logger.info('Router agent started');
  }

  async createJob(request: JobRequest): Promise<string> {
    const jobId = uuidv4();
    const traceId = uuidv4();

    // Create job in state store
    await stateStore.createJob({
      id: jobId,
      clientId: request.clientId,
      type: request.type,
      status: 'received',
      input: request,
      maxIterations: 5,
    });

    // Publish job.created event
    await messageBus.publish({
      eventType: eventTypes.JOB_CREATED,
      jobId,
      clientId: request.clientId,
      traceId,
      sourceAgent: this.name,
      payload: request,
    });

    logger.info(`Job created and routed: ${jobId}`, { type: request.type, client: request.clientId });
    return jobId;
  }

  private async handleReviewPassed(event: AgentEvent) {
    const job = await stateStore.getJob(event.jobId);
    if (!job) return;

    // Update job to complete
    await stateStore.updateJob(event.jobId, {
      status: 'complete',
      output: job.polishedDraft || job.draft,
      completedAt: new Date().toISOString(),
    });

    // Publish job.complete
    await messageBus.publish({
      eventType: eventTypes.JOB_COMPLETE,
      jobId: event.jobId,
      clientId: event.clientId,
      traceId: event.traceId,
      sourceAgent: this.name,
      payload: {
        output: job.polishedDraft || job.draft,
        stats: {
          iterations: job.iteration,
          reviewScore: event.payload.score,
        },
      },
    });

    logger.info(`Job completed: ${event.jobId}`);
  }
}

export const routerAgent = new RouterAgent();
