import { z } from 'zod';

export const jobRequestSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  type: z.enum(['social_post', 'blog_post', 'report', 'campaign']),
  platform: z.enum(['linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'all']).optional(),
  topic: z.string().min(1, 'Topic is required'),
  instructions: z.string().optional(),
});

export const clientProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  industry: z.string().default('general'),
  description: z.string().default(''),
  goals: z.array(z.string()).default([]),
  platforms: z.array(z.object({
    platform: z.string(),
    handle: z.string(),
    frequency: z.string(),
  })).default([]),
  contacts: z.array(z.object({
    name: z.string(),
    role: z.string(),
    email: z.string().email(),
  })).default([]),
  preferences: z.record(z.string(), z.any()).default({}),
});

export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}
