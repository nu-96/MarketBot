import { createClient, RedisClientType } from 'redis';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AgentEvent, EventType } from './event-types';
import { v4 as uuidv4 } from 'uuid';

export class MessageBus {
  private client!: RedisClientType;
  private subscribers: Map<string, ((event: AgentEvent) => Promise<void>)[]> = new Map();
  private consumerGroup = 'luniero-agents';
  private streamName = 'agent-events';

  async connect() {
    this.client = createClient({
      url: config.redisUrl,
      socket: {
        connectTimeout: 10_000,
        reconnectStrategy(retries) {
          if (retries > 5) return new Error('Max Redis reconnect attempts reached');
          return Math.min(retries * 500, 3000);
        },
      },
    }) as RedisClientType;
    await this.client.connect();

    // Create stream and consumer group if they don't exist
    try {
      await this.client.xGroupCreate(this.streamName, this.consumerGroup, '0', { MKSTREAM: true });
    } catch (err: any) {
      if (!err.message.includes('BUSYGROUP')) throw err;
    }

    logger.info('Message bus connected');
  }

  async publish(event: Omit<AgentEvent, 'eventId' | 'timestamp'>): Promise<string> {
    const fullEvent: AgentEvent = {
      ...event,
      eventId: uuidv4(),
      timestamp: new Date().toISOString(),
    };

    await this.client.xAdd(this.streamName, '*', {
      data: JSON.stringify(fullEvent),
    });

    logger.debug(`Published event: ${event.eventType}`, { jobId: event.jobId });
    return fullEvent.eventId;
  }

  subscribe(eventType: EventType | EventType[], handler: (event: AgentEvent) => Promise<void>) {
    const types = Array.isArray(eventType) ? eventType : [eventType];
    for (const type of types) {
      if (!this.subscribers.has(type)) {
        this.subscribers.set(type, []);
      }
      this.subscribers.get(type)!.push(handler);
    }
  }

  async startConsuming(consumerName: string) {
    logger.info(`Consumer ${consumerName} starting...`);

    while (true) {
      try {
        const results = await this.client.xReadGroup(
          this.consumerGroup,
          consumerName,
          { key: this.streamName, id: '>' },
          { COUNT: 10, BLOCK: 5000 }
        );

        if (!results) continue;

        for (const result of results) {
          for (const message of result.messages) {
            const event: AgentEvent = JSON.parse(message.message.data);

            const handlers = this.subscribers.get(event.eventType) || [];
            for (const handler of handlers) {
              try {
                await handler(event);
              } catch (err) {
                logger.error(`Handler error for ${event.eventType}`, err);
              }
            }

            // Acknowledge message
            await this.client.xAck(this.streamName, this.consumerGroup, message.id);
          }
        }
      } catch (err) {
        logger.error('Consumer error', err);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async disconnect() {
    await this.client.quit();
  }
}

export const messageBus = new MessageBus();
