import { z } from 'zod';
import dotenv from 'dotenv';

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

const parsed = configSchema.parse({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  redisUrl: process.env.REDIS_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV,
  localMode: !process.env.SUPABASE_URL || process.env.SUPABASE_URL.includes('placeholder') || !process.env.SUPABASE_KEY || process.env.SUPABASE_KEY.includes('placeholder'),
});

export const config = parsed;
