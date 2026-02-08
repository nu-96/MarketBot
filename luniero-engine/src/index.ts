import { messageBus } from './core/message-bus';
import { routerAgent } from './agents/router';
import { contextAgent } from './agents/context-agent';
import { briefAgent } from './agents/brief-agent';
import { draftAgent } from './agents/draft-agent';
import { polishAgent } from './agents/polish-agent';
import { reviewAgent } from './agents/review-agent';
import { logger } from './utils/logger';

async function main() {
  logger.info('Starting Luniero Marketing Agent...');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await messageBus.disconnect();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    await messageBus.disconnect();
    process.exit(0);
  });

  // Connect to message bus
  await messageBus.connect();

  // Start all agents in parallel
  await Promise.all([
    routerAgent.start(),
    contextAgent.start(),
    briefAgent.start(),
    draftAgent.start(),
    polishAgent.start(),
    reviewAgent.start(),
  ]);

  logger.info('Luniero Marketing Agent is running! Press Ctrl+C to stop.');

  // Start consuming messages (blocks forever)
  const consumerName = `consumer-${process.pid}`;
  await messageBus.startConsuming(consumerName);
}

main().catch((err) => {
  logger.error('Failed to start', err);
  process.exit(1);
});
