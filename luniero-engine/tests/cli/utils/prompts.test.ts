import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  promptForInput,
  promptForChoice,
  promptForConfirm,
  promptForMissing,
  promptForClient,
} from '../../../src/cli/utils/prompts';
import * as readline from 'readline';

function createMockRL(answers: string[]): readline.Interface {
  let callIndex = 0;
  return {
    question: vi.fn((prompt: string, cb: (answer: string) => void) => {
      cb(answers[callIndex++] || '');
    }),
  } as unknown as readline.Interface;
}

describe('prompts', () => {
  describe('promptForInput', () => {
    it('should return trimmed user input', async () => {
      const rl = createMockRL(['  hello  ']);
      const result = await promptForInput(rl, 'Enter: ');
      expect(result).toBe('hello');
    });

    it('should return empty string for empty input', async () => {
      const rl = createMockRL(['']);
      const result = await promptForInput(rl, 'Enter: ');
      expect(result).toBe('');
    });

    it('should call rl.question with the prompt', async () => {
      const rl = createMockRL(['test']);
      await promptForInput(rl, 'Name: ');
      expect(rl.question).toHaveBeenCalledWith('Name: ', expect.any(Function));
    });
  });

  describe('promptForChoice', () => {
    it('should resolve by number selection', async () => {
      const rl = createMockRL(['2']);
      const result = await promptForChoice(rl, 'Pick one:', ['a', 'b', 'c']);
      expect(result).toBe('b');
    });

    it('should resolve by text match', async () => {
      const rl = createMockRL(['twitter']);
      const result = await promptForChoice(rl, 'Platform:', ['linkedin', 'twitter', 'instagram']);
      expect(result).toBe('twitter');
    });

    it('should return raw input for unrecognized selection', async () => {
      const rl = createMockRL(['custom']);
      const result = await promptForChoice(rl, 'Pick:', ['a', 'b']);
      expect(result).toBe('custom');
    });

    it('should handle number out of range', async () => {
      const rl = createMockRL(['99']);
      const result = await promptForChoice(rl, 'Pick:', ['a', 'b']);
      // 99 is out of range, no text match → returns '99'
      expect(result).toBe('99');
    });

    it('should be case-insensitive for text match', async () => {
      const rl = createMockRL(['LINKEDIN']);
      const result = await promptForChoice(rl, 'Platform:', ['linkedin', 'twitter']);
      expect(result).toBe('linkedin');
    });
  });

  describe('promptForConfirm', () => {
    it('should return true for "y"', async () => {
      const rl = createMockRL(['y']);
      expect(await promptForConfirm(rl, 'Sure?')).toBe(true);
    });

    it('should return true for "yes"', async () => {
      const rl = createMockRL(['yes']);
      expect(await promptForConfirm(rl, 'Sure?')).toBe(true);
    });

    it('should return true for "Y"', async () => {
      const rl = createMockRL(['Y']);
      expect(await promptForConfirm(rl, 'Sure?')).toBe(true);
    });

    it('should return false for "n"', async () => {
      const rl = createMockRL(['n']);
      expect(await promptForConfirm(rl, 'Sure?')).toBe(false);
    });

    it('should return false for empty input', async () => {
      const rl = createMockRL(['']);
      expect(await promptForConfirm(rl, 'Sure?')).toBe(false);
    });

    it('should return false for random text', async () => {
      const rl = createMockRL(['maybe']);
      expect(await promptForConfirm(rl, 'Sure?')).toBe(false);
    });
  });

  describe('promptForMissing', () => {
    it('should return current value if provided', async () => {
      const rl = createMockRL([]);
      const result = await promptForMissing(rl, 'Topic', 'AI');
      expect(result).toBe('AI');
      expect(rl.question).not.toHaveBeenCalled();
    });

    it('should prompt when current is undefined', async () => {
      const rl = createMockRL(['machine learning']);
      const result = await promptForMissing(rl, 'Topic', undefined);
      expect(result).toBe('machine learning');
    });
  });

  describe('promptForClient', () => {
    it('should return current client if set', async () => {
      const rl = createMockRL([]);
      const result = await promptForClient(rl, 'acme');
      expect(result).toBe('acme');
      expect(rl.question).not.toHaveBeenCalled();
    });

    it('should prompt for client when null', async () => {
      const rl = createMockRL(['newclient']);
      const result = await promptForClient(rl, null);
      expect(result).toBe('newclient');
    });

    it('should return null if user enters empty string', async () => {
      const rl = createMockRL(['']);
      const result = await promptForClient(rl, null);
      expect(result).toBeNull();
    });
  });
});
