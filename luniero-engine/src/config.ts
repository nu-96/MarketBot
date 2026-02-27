import { z } from 'zod';
import * as dotenv from 'dotenv';

// Load .env file if present (quiet mode to suppress logs)
dotenv.config();

const configSchema = z.object({
  anthropicApiKey: z.string().default(''),
  redisUrl: z.string().default('redis://localhost:6379'),
  supabaseUrl: z.string().default(''),
  supabaseKey: z.string().default(''),
  port: z.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  localMode: z.boolean().default(false),
});

const localMode = !process.env.SUPABASE_URL || 
  process.env.SUPABASE_URL.includes('placeholder') || 
  !process.env.SUPABASE_KEY || 
  process.env.SUPABASE_KEY.includes('placeholder');

const parsed = configSchema.parse({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  redisUrl: process.env.REDIS_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV,
  localMode,
});

// Helpful warnings for common misconfigurations
// Skip warning for help/health commands that don't need API key
const skipWarningCommands = ['help', '--help', '-h', 'health', 'client'];
const isHelpCommand = process.argv.some(arg => skipWarningCommands.some(cmd => arg.includes(cmd)));

if (process.env.NODE_ENV !== 'test' && !parsed.anthropicApiKey && !isHelpCommand) {
  console.warn('⚠️  ANTHROPIC_API_KEY not set. LLM calls will fail.');
  console.warn('   Set it in .env or export ANTHROPIC_API_KEY=sk-ant-...\n');
}

export const config = parsed;

/**
 * Validate that required config is present for a given operation.
 * Throws with a helpful message if not.
 */
export function requireConfig(keys: ('anthropicApiKey' | 'redisUrl')[]): void {
  for (const key of keys) {
    if (key === 'anthropicApiKey' && !config.anthropicApiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is required for this operation.\n' +
        'Set it in .env: ANTHROPIC_API_KEY=sk-ant-your-key-here'
      );
    }
  }
}
