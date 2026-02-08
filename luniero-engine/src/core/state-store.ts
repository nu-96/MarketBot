import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../utils/logger';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DB_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: PromiseLike<T>, ms = DB_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Database query timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export type JobStatus =
  | 'received'
  | 'researching'
  | 'context_loading'
  | 'briefing'
  | 'brief_pending_approval'
  | 'drafting'
  | 'polishing'
  | 'reviewing'
  | 'revision'
  | 'human_review'
  | 'scheduled'
  | 'complete'
  | 'failed';

export interface Job {
  id: string;
  clientId: string;
  type: string;
  status: JobStatus;
  input: any;
  context?: any;
  research?: any;
  brief?: any;
  draft?: any;
  polishedDraft?: any;
  review?: any;
  output?: any;
  iteration: number;
  maxIterations: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

class LocalStateStore {
  private jobs: Map<string, Job> = new Map();
  private storagePath = join(__dirname, '../../data/jobs');

  constructor() {
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (existsSync(this.storagePath)) {
        const files = require('fs').readdirSync(this.storagePath);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const data = JSON.parse(readFileSync(join(this.storagePath, file), 'utf-8'));
            this.jobs.set(data.id, data);
          }
        }
      }
    } catch {
      // Fresh start
    }
  }

  private saveToDisk(job: Job) {
    writeFileSync(join(this.storagePath, `${job.id}.json`), JSON.stringify(job, null, 2));
  }

  async createJob(job: Omit<Job, 'createdAt' | 'updatedAt' | 'iteration'>): Promise<Job> {
    const now = new Date().toISOString();
    const fullJob: Job = {
      ...job,
      iteration: 0,
      maxIterations: job.maxIterations || 3,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(fullJob.id, fullJob);
    this.saveToDisk(fullJob);
    logger.info(`Job created: ${job.id}`, { jobId: job.id });
    return fullJob;
  }

  async getJob(jobId: string): Promise<Job | null> {
    if (!jobId) return null;
    const cached = this.jobs.get(jobId);
    if (cached) return cached;
    // Check disk in case another process created the job
    const filePath = join(this.storagePath, `${jobId}.json`);
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      this.jobs.set(data.id, data);
      return data;
    }
    return null;
  }

  async updateJob(jobId: string, updates: Partial<Job>): Promise<Job> {
    const existing = this.jobs.get(jobId);
    if (!existing) throw new Error(`Job not found: ${jobId}`);
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.jobs.set(jobId, updated);
    this.saveToDisk(updated);
    logger.debug(`Job updated: ${jobId}`, { status: updates.status });
    return updated;
  }

  async incrementIteration(jobId: string): Promise<number> {
    const job = await this.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    const newIteration = job.iteration + 1;
    await this.updateJob(jobId, { iteration: newIteration });
    return newIteration;
  }

  async getJobsByClient(clientId: string, limit = 20): Promise<Job[]> {
    const jobs = Array.from(this.jobs.values())
      .filter(j => j.clientId === clientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
    return jobs;
  }
}

class SupabaseStateStore {
  private supabase;

  constructor() {
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
  }

  private toDb(job: Partial<Job>): Record<string, any> {
    const map: Record<string, string> = {
      clientId: 'client_id', maxIterations: 'max_iterations',
      createdAt: 'created_at', updatedAt: 'updated_at',
      completedAt: 'completed_at', polishedDraft: 'polished_draft',
    };
    const row: Record<string, any> = {};
    for (const [k, v] of Object.entries(job)) {
      row[map[k] || k] = v;
    }
    return row;
  }

  private fromDb(row: Record<string, any>): Job {
    return {
      id: row.id,
      clientId: row.client_id,
      type: row.type,
      status: row.status,
      input: row.input,
      context: row.context,
      research: row.research,
      brief: row.brief,
      draft: row.draft,
      polishedDraft: row.polished_draft,
      review: row.review,
      output: row.output,
      iteration: row.iteration,
      maxIterations: row.max_iterations,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      error: row.error,
    };
  }

  async createJob(job: Omit<Job, 'createdAt' | 'updatedAt' | 'iteration'>): Promise<Job> {
    const now = new Date().toISOString();
    const fullJob: Job = {
      ...job,
      iteration: 0,
      maxIterations: job.maxIterations || 3,
      createdAt: now,
      updatedAt: now,
    };

    const { data, error } = await withTimeout(
      this.supabase.from('jobs').insert(this.toDb(fullJob)).select().single()
    );

    if (error) throw error;
    logger.info(`Job created: ${job.id}`, { jobId: job.id });
    return this.fromDb(data);
  }

  async getJob(jobId: string): Promise<Job | null> {
    const { data, error } = await withTimeout(
      this.supabase.from('jobs').select('*').eq('id', jobId).single()
    );

    if (error) return null;
    return this.fromDb(data);
  }

  async updateJob(jobId: string, updates: Partial<Job>): Promise<Job> {
    const dbUpdates = this.toDb({ ...updates, updatedAt: new Date().toISOString() });
    const { data, error } = await withTimeout(
      this.supabase.from('jobs').update(dbUpdates).eq('id', jobId).select().single()
    );

    if (error) throw error;
    logger.debug(`Job updated: ${jobId}`, { status: updates.status });
    return this.fromDb(data);
  }

  async incrementIteration(jobId: string): Promise<number> {
    const job = await this.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const newIteration = job.iteration + 1;
    await this.updateJob(jobId, { iteration: newIteration });
    return newIteration;
  }

  async getJobsByClient(clientId: string, limit = 20): Promise<Job[]> {
    const { data, error } = await withTimeout(
      this.supabase.from('jobs').select('*').eq('client_id', clientId)
        .order('created_at', { ascending: false }).limit(limit)
    );

    if (error) throw error;
    return (data || []).map(row => this.fromDb(row));
  }
}

function createStateStore() {
  if (config.localMode) {
    logger.info('Using local file-based state store');
    return new LocalStateStore();
  }
  logger.info('Using Supabase state store');
  return new SupabaseStateStore();
}

export const stateStore = createStateStore();
