import { logger } from './logger';

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delay?: number;
    backoffMultiplier?: number;
    context?: string;
  } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 1000, backoffMultiplier = 2, context = 'operation' } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < maxRetries) {
        const waitTime = delay * Math.pow(backoffMultiplier, attempt - 1);
        logger.warn(`${context} failed (attempt ${attempt}/${maxRetries}), retrying in ${waitTime}ms`, {
          error: error.message,
        });
        await new Promise(r => setTimeout(r, waitTime));
      }
    }
  }

  throw lastError;
}
