import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Tests for LocalStateStore.
 * Since stateStore is a singleton, we test it directly but clean up between tests.
 * The module uses local mode because setup.ts sets placeholder Supabase.
 */
import { stateStore } from '../../src/core/state-store';

describe('LocalStateStore', () => {
  const testDataPath = join(__dirname, '../../data/jobs');

  beforeEach(() => {
    // Clean the in-memory map and disk via creating fresh jobs only
    // We use unique IDs per test to avoid collisions
  });

  describe('createJob', () => {
    it('should create a job with all required fields', async () => {
      const job = await stateStore.createJob({
        id: 'create-test-1',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: { topic: 'AI trends' },
        maxIterations: 3,
      });

      expect(job.id).toBe('create-test-1');
      expect(job.clientId).toBe('client-1');
      expect(job.type).toBe('social_post');
      expect(job.status).toBe('received');
      expect(job.iteration).toBe(0);
      expect(job.maxIterations).toBe(3);
      expect(job.createdAt).toBeDefined();
      expect(job.updatedAt).toBeDefined();
    });

    it('should default maxIterations to 3 when 0', async () => {
      const job = await stateStore.createJob({
        id: 'create-default-max',
        clientId: 'client-1',
        type: 'blog_post',
        status: 'received' as const,
        input: {},
        maxIterations: 0,
      });

      expect(job.maxIterations).toBe(3);
    });

    it('should persist job to disk', async () => {
      await stateStore.createJob({
        id: 'create-persist-check',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: {},
        maxIterations: 3,
      });

      const filePath = join(testDataPath, 'create-persist-check.json');
      expect(existsSync(filePath)).toBe(true);
    });

    it('should set timestamps on creation', async () => {
      const before = new Date().toISOString();
      const job = await stateStore.createJob({
        id: 'create-timestamps-check',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: {},
        maxIterations: 3,
      });
      const after = new Date().toISOString();

      expect(job.createdAt >= before).toBe(true);
      expect(job.createdAt <= after).toBe(true);
      expect(job.updatedAt).toBe(job.createdAt);
    });
  });

  describe('getJob', () => {
    it('should retrieve a created job', async () => {
      await stateStore.createJob({
        id: 'get-test-1',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: { topic: 'test' },
        maxIterations: 3,
      });

      const job = await stateStore.getJob('get-test-1');
      expect(job).not.toBeNull();
      expect(job!.id).toBe('get-test-1');
      expect(job!.input.topic).toBe('test');
    });

    it('should return null for non-existent job', async () => {
      const job = await stateStore.getJob('non-existent-xyz');
      expect(job).toBeNull();
    });

    it('should return null for empty string jobId', async () => {
      const job = await stateStore.getJob('');
      expect(job).toBeNull();
    });
  });

  describe('updateJob', () => {
    it('should update job status', async () => {
      await stateStore.createJob({
        id: 'update-status-1',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: {},
        maxIterations: 3,
      });

      const updated = await stateStore.updateJob('update-status-1', { status: 'drafting' });
      expect(updated.status).toBe('drafting');
    });

    it('should update updatedAt timestamp', async () => {
      const original = await stateStore.createJob({
        id: 'update-ts-1',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: {},
        maxIterations: 3,
      });

      await new Promise(r => setTimeout(r, 10));

      const updated = await stateStore.updateJob('update-ts-1', { status: 'drafting' });
      expect(updated.updatedAt >= original.createdAt).toBe(true);
    });

    it('should merge partial updates without losing data', async () => {
      await stateStore.createJob({
        id: 'update-merge-1',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: { topic: 'preserve me' },
        maxIterations: 3,
      });

      await stateStore.updateJob('update-merge-1', { status: 'drafting', draft: { content: 'new draft' } });

      const job = await stateStore.getJob('update-merge-1');
      expect(job!.input.topic).toBe('preserve me');
      expect(job!.draft.content).toBe('new draft');
      expect(job!.status).toBe('drafting');
    });

    it('should throw for non-existent job', async () => {
      await expect(stateStore.updateJob('ghost-job-xyz', { status: 'failed' })).rejects.toThrow('Job not found');
    });
  });

  describe('incrementIteration', () => {
    it('should increment from 0 to 1', async () => {
      await stateStore.createJob({
        id: 'iter-test-1',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: {},
        maxIterations: 3,
      });

      const newIter = await stateStore.incrementIteration('iter-test-1');
      expect(newIter).toBe(1);
    });

    it('should increment multiple times', async () => {
      await stateStore.createJob({
        id: 'iter-multi-1',
        clientId: 'client-1',
        type: 'social_post',
        status: 'received' as const,
        input: {},
        maxIterations: 5,
      });

      await stateStore.incrementIteration('iter-multi-1');
      await stateStore.incrementIteration('iter-multi-1');
      const third = await stateStore.incrementIteration('iter-multi-1');
      expect(third).toBe(3);
    });

    it('should throw for non-existent job', async () => {
      await expect(stateStore.incrementIteration('ghost-iter-xyz')).rejects.toThrow('Job not found');
    });
  });

  describe('getJobsByClient', () => {
    it('should return jobs for a specific client', async () => {
      const clientId = `client-filter-${Date.now()}`;
      await stateStore.createJob({
        id: `filter-a-${Date.now()}`, clientId, type: 'social_post',
        status: 'received' as const, input: {}, maxIterations: 3,
      });
      await stateStore.createJob({
        id: `filter-b-${Date.now()}`, clientId, type: 'blog_post',
        status: 'received' as const, input: {}, maxIterations: 3,
      });
      await stateStore.createJob({
        id: `filter-c-${Date.now()}`, clientId: 'other-client', type: 'report',
        status: 'received' as const, input: {}, maxIterations: 3,
      });

      const jobs = await stateStore.getJobsByClient(clientId);
      expect(jobs).toHaveLength(2);
      expect(jobs.every((j: any) => j.clientId === clientId)).toBe(true);
    });

    it('should return empty array for unknown client', async () => {
      const jobs = await stateStore.getJobsByClient('totally-unknown-client');
      expect(jobs).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const clientId = `client-limit-${Date.now()}`;
      for (let i = 0; i < 5; i++) {
        await stateStore.createJob({
          id: `limit-${clientId}-${i}`, clientId, type: 'social_post',
          status: 'received' as const, input: {}, maxIterations: 3,
        });
      }

      const jobs = await stateStore.getJobsByClient(clientId, 2);
      expect(jobs).toHaveLength(2);
    });

    it('should sort by createdAt descending', async () => {
      const clientId = `client-sort-${Date.now()}`;
      await stateStore.createJob({
        id: `sort-first-${clientId}`, clientId, type: 'social_post',
        status: 'received' as const, input: {}, maxIterations: 3,
      });
      await new Promise(r => setTimeout(r, 10));
      await stateStore.createJob({
        id: `sort-second-${clientId}`, clientId, type: 'social_post',
        status: 'received' as const, input: {}, maxIterations: 3,
      });

      const jobs = await stateStore.getJobsByClient(clientId);
      expect(jobs[0].id).toContain('sort-second'); // Most recent first
    });
  });
});
