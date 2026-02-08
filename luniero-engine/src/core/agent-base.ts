import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { messageBus } from './message-bus';
import { stateStore, Job } from './state-store';
import { logger } from '../utils/logger';
import { AgentEvent, EventType } from './event-types';
import { readFileSync } from 'fs';
import { join } from 'path';

export abstract class BaseAgent {
  protected name: string;
  protected anthropic: Anthropic;
  protected systemPrompt: string;

  constructor(name: string) {
    this.name = name;
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
    this.systemPrompt = this.loadSystemPrompt();
  }

  private loadSystemPrompt(): string {
    try {
      const path = join(__dirname, '../../prompts/system', `${this.name}.md`);
      return readFileSync(path, 'utf-8');
    } catch {
      return this.getDefaultSystemPrompt();
    }
  }

  protected abstract getDefaultSystemPrompt(): string;
  protected abstract getSubscribedEvents(): EventType[];
  protected abstract handleEvent(event: AgentEvent, job: Job): Promise<void>;

  async start() {
    const events = this.getSubscribedEvents();

    messageBus.subscribe(events, async (event) => {
      const job = await stateStore.getJob(event.jobId);
      if (!job) {
        logger.error(`Job not found: ${event.jobId}`, { agent: this.name });
        return;
      }

      try {
        logger.info(`Processing ${event.eventType}`, { agent: this.name, jobId: event.jobId });
        await this.handleEvent(event, job);
      } catch (error) {
        logger.error(`Error processing event`, error, { agent: this.name, jobId: event.jobId });
        await this.publishError(event, error);
      }
    });

    logger.info(`${this.name} started, listening for: ${events.join(', ')}`);
  }

  protected async callLLM(messages: { role: 'user' | 'assistant'; content: string }[], options?: {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
  }): Promise<string> {
    const timeoutMs = options?.timeoutMs || 120_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.anthropic.messages.create(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: options?.maxTokens || 4096,
          temperature: options?.temperature || 0.7,
          system: this.systemPrompt,
          messages,
        },
        { signal: controller.signal },
      );

      const textBlock = response.content.find(block => block.type === 'text');
      return textBlock?.text || '';
    } finally {
      clearTimeout(timer);
    }
  }

  protected async publish(
    eventType: EventType,
    jobId: string,
    clientId: string,
    traceId: string,
    payload: any,
    parentEventId?: string
  ) {
    await messageBus.publish({
      eventType,
      jobId,
      clientId,
      traceId,
      sourceAgent: this.name,
      payload,
      parentEventId,
    });
  }

  protected async publishError(event: AgentEvent, error: any) {
    await messageBus.publish({
      eventType: 'agent.error',
      jobId: event.jobId,
      clientId: event.clientId,
      traceId: event.traceId,
      sourceAgent: this.name,
      payload: {
        error: error.message,
        stack: error.stack,
        originalEvent: event.eventType,
      },
      parentEventId: event.eventId,
    });
  }
}
