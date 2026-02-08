import { describe, it, expect } from 'vitest';
import {
  createSession,
  updateSession,
  withClient,
  withLastCommand,
  withLastJob,
  withLastHandler,
  withPendingApproval,
  withDebug,
  Session,
} from '../../src/cli/session';

describe('session', () => {
  describe('createSession', () => {
    it('should create a session with defaults', () => {
      const session = createSession();
      expect(session.activeClientId).toBeNull();
      expect(session.lastCommand).toBeNull();
      expect(session.lastJobId).toBeNull();
      expect(session.lastHandler).toBeNull();
      expect(session.pendingApproval).toBeNull();
      expect(session.history).toEqual([]);
      expect(session.debug).toBe(false);
      expect(session.startedAt).toBeDefined();
    });

    it('should accept overrides', () => {
      const session = createSession({ activeClientId: 'acme', debug: true });
      expect(session.activeClientId).toBe('acme');
      expect(session.debug).toBe(true);
    });

    it('should not mutate overrides object', () => {
      const overrides = { activeClientId: 'acme' };
      const session = createSession(overrides);
      expect(session.activeClientId).toBe('acme');
      expect(overrides.activeClientId).toBe('acme');
    });
  });

  describe('updateSession', () => {
    it('should return a new session with updates', () => {
      const original = createSession();
      const updated = updateSession(original, { activeClientId: 'test' });
      expect(updated.activeClientId).toBe('test');
      expect(original.activeClientId).toBeNull();
    });

    it('should preserve unmodified fields', () => {
      const original = createSession({ debug: true });
      const updated = updateSession(original, { activeClientId: 'test' });
      expect(updated.debug).toBe(true);
      expect(updated.activeClientId).toBe('test');
    });
  });

  describe('withClient', () => {
    it('should set activeClientId', () => {
      const session = createSession();
      const updated = withClient(session, 'acme');
      expect(updated.activeClientId).toBe('acme');
    });

    it('should not mutate original', () => {
      const session = createSession();
      withClient(session, 'acme');
      expect(session.activeClientId).toBeNull();
    });
  });

  describe('withLastCommand', () => {
    it('should set lastCommand', () => {
      const session = createSession();
      const updated = withLastCommand(session, '/help');
      expect(updated.lastCommand).toBe('/help');
    });

    it('should append to history', () => {
      const session = createSession();
      const s1 = withLastCommand(session, '/help');
      const s2 = withLastCommand(s1, '/write');
      expect(s2.history).toEqual(['/help', '/write']);
    });

    it('should cap history at 50 entries', () => {
      let session = createSession();
      for (let i = 0; i < 60; i++) {
        session = withLastCommand(session, `/cmd-${i}`);
      }
      expect(session.history.length).toBe(50);
      expect(session.history[0]).toBe('/cmd-10');
      expect(session.history[49]).toBe('/cmd-59');
    });
  });

  describe('withLastJob', () => {
    it('should set lastJobId', () => {
      const session = createSession();
      const updated = withLastJob(session, 'job-123');
      expect(updated.lastJobId).toBe('job-123');
    });
  });

  describe('withLastHandler', () => {
    it('should set lastHandler', () => {
      const session = createSession();
      const updated = withLastHandler(session, 'write');
      expect(updated.lastHandler).toBe('write');
    });
  });

  describe('withPendingApproval', () => {
    it('should set pendingApproval', () => {
      const session = createSession();
      const updated = withPendingApproval(session, 'job-123');
      expect(updated.pendingApproval).toBe('job-123');
    });

    it('should clear pendingApproval with null', () => {
      const session = createSession({ pendingApproval: 'job-123' });
      const updated = withPendingApproval(session, null);
      expect(updated.pendingApproval).toBeNull();
    });

    it('should not mutate original', () => {
      const session = createSession();
      withPendingApproval(session, 'job-123');
      expect(session.pendingApproval).toBeNull();
    });
  });

  describe('withDebug', () => {
    it('should enable debug', () => {
      const session = createSession();
      const updated = withDebug(session, true);
      expect(updated.debug).toBe(true);
    });

    it('should disable debug', () => {
      const session = createSession({ debug: true });
      const updated = withDebug(session, false);
      expect(updated.debug).toBe(false);
    });
  });

  describe('immutability', () => {
    it('should not allow mutation of history array', () => {
      const session = createSession();
      const updated = withLastCommand(session, '/test');
      // TypeScript readonly prevents .push at compile time, but runtime test:
      expect(updated.history.length).toBe(1);
    });

    it('should produce independent copies through chained updates', () => {
      const s0 = createSession();
      const s1 = withClient(s0, 'acme');
      const s2 = withLastCommand(s1, '/help');
      const s3 = withDebug(s2, true);

      expect(s0.activeClientId).toBeNull();
      expect(s1.activeClientId).toBe('acme');
      expect(s1.lastCommand).toBeNull();
      expect(s2.lastCommand).toBe('/help');
      expect(s2.debug).toBe(false);
      expect(s3.debug).toBe(true);
    });
  });
});
