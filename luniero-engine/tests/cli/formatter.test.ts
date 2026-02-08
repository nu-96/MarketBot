import { describe, it, expect } from 'vitest';
import {
  colors,
  formatStatus,
  formatWelcome,
  formatError,
  formatSuccess,
  formatWarning,
  formatInfo,
  formatJobSummary,
  formatJobTable,
  formatCommandSuggestion,
  formatContent,
  formatContentOutput,
  formatIssue,
  formatPipelineProgress,
  formatHelp,
  formatDebugInfo,
  formatClientInfo,
  formatPrompt,
} from '../../src/cli/formatter';
import { Job } from '../../src/core/state-store';

describe('formatter', () => {
  describe('colors', () => {
    it('should wrap text with ANSI codes', () => {
      expect(colors.red('hello')).toContain('hello');
      expect(colors.red('hello')).toContain('\x1b[31m');
      expect(colors.red('hello')).toContain('\x1b[0m');
    });

    it('should apply bold', () => {
      expect(colors.bold('test')).toContain('\x1b[1m');
    });

    it('should apply dim', () => {
      expect(colors.dim('test')).toContain('\x1b[2m');
    });

    it('should apply all color functions without throwing', () => {
      const fns = [
        colors.red, colors.green, colors.yellow, colors.blue,
        colors.magenta, colors.cyan, colors.white, colors.bold,
        colors.dim, colors.bgRed, colors.bgGreen, colors.bgYellow, colors.bgBlue,
      ];
      for (const fn of fns) {
        expect(() => fn('test')).not.toThrow();
        expect(fn('test')).toContain('test');
      }
    });

    it('should handle empty strings', () => {
      expect(colors.red('')).toContain('\x1b[31m');
    });
  });

  describe('formatStatus', () => {
    it('should color complete as green', () => {
      const result = formatStatus('complete');
      expect(result).toContain('\x1b[32m'); // green
    });

    it('should color failed as red', () => {
      const result = formatStatus('failed');
      expect(result).toContain('\x1b[31m'); // red
    });

    it('should color received as blue', () => {
      const result = formatStatus('received');
      expect(result).toContain('\x1b[34m'); // blue
    });

    it('should color reviewing as yellow', () => {
      const result = formatStatus('reviewing');
      expect(result).toContain('\x1b[33m'); // yellow
    });

    it('should handle all valid statuses', () => {
      const statuses = [
        'received', 'researching', 'context_loading', 'briefing',
        'brief_pending_approval', 'drafting', 'polishing', 'reviewing',
        'revision', 'human_review', 'complete', 'failed',
      ] as const;
      for (const status of statuses) {
        expect(() => formatStatus(status)).not.toThrow();
      }
    });
  });

  describe('formatWelcome', () => {
    it('should include version', () => {
      const result = formatWelcome('1.0.0');
      expect(result).toContain('1.0.0');
    });

    it('should include brand name', () => {
      const result = formatWelcome('1.0.0');
      expect(result).toContain('Luniero');
    });

    it('should include help hint', () => {
      const result = formatWelcome('1.0.0');
      expect(result).toContain('/help');
    });
  });

  describe('formatError', () => {
    it('should include Error label', () => {
      expect(formatError('something broke')).toContain('Error:');
    });

    it('should include the message', () => {
      expect(formatError('something broke')).toContain('something broke');
    });
  });

  describe('formatSuccess', () => {
    it('should include checkmark', () => {
      expect(formatSuccess('done')).toContain('✓');
    });

    it('should include message', () => {
      expect(formatSuccess('done')).toContain('done');
    });
  });

  describe('formatWarning', () => {
    it('should include Warning label', () => {
      expect(formatWarning('careful')).toContain('Warning:');
    });
  });

  describe('formatInfo', () => {
    it('should include info icon', () => {
      expect(formatInfo('note')).toContain('ℹ');
    });

    it('should include message', () => {
      expect(formatInfo('note')).toContain('note');
    });
  });

  describe('formatJobSummary', () => {
    const baseJob: Job = {
      id: 'abc-123-def-456',
      clientId: 'acme',
      type: 'social_post',
      status: 'received',
      input: { topic: 'AI trends' },
      iteration: 0,
      maxIterations: 3,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    it('should include job ID', () => {
      expect(formatJobSummary(baseJob)).toContain('abc-123-def-456');
    });

    it('should include client ID', () => {
      expect(formatJobSummary(baseJob)).toContain('acme');
    });

    it('should include type', () => {
      expect(formatJobSummary(baseJob)).toContain('social_post');
    });

    it('should include topic', () => {
      expect(formatJobSummary(baseJob)).toContain('AI trends');
    });

    it('should show iteration when > 0', () => {
      const job = { ...baseJob, iteration: 2 };
      expect(formatJobSummary(job)).toContain('2/3');
    });

    it('should not show iteration when 0', () => {
      expect(formatJobSummary(baseJob)).not.toContain('Iter:');
    });

    it('should show completedAt when present', () => {
      const job = { ...baseJob, completedAt: '2024-01-02T00:00:00Z' };
      expect(formatJobSummary(job)).toContain('Done:');
    });

    it('should show error when present', () => {
      const job = { ...baseJob, error: 'LLM timeout' };
      expect(formatJobSummary(job)).toContain('LLM timeout');
    });

    it('should handle missing input.topic', () => {
      const job = { ...baseJob, input: {} };
      expect(formatJobSummary(job)).toContain('N/A');
    });
  });

  describe('formatJobTable', () => {
    it('should show "No jobs" for empty list', () => {
      expect(formatJobTable([])).toContain('No jobs found');
    });

    it('should format jobs as a table', () => {
      const jobs: Job[] = [
        {
          id: 'abc-123-def-456',
          clientId: 'acme',
          type: 'social_post',
          status: 'complete',
          input: { topic: 'AI' },
          iteration: 1,
          maxIterations: 3,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      const result = formatJobTable(jobs);
      expect(result).toContain('abc-123');
      expect(result).toContain('social_post');
      expect(result).toContain('AI');
    });

    it('should truncate long topics', () => {
      const jobs: Job[] = [
        {
          id: 'abc-123',
          clientId: 'acme',
          type: 'blog_post',
          status: 'drafting',
          input: { topic: 'A very long topic about the future of artificial intelligence and machine learning trends' },
          iteration: 0,
          maxIterations: 3,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ];
      const result = formatJobTable(jobs);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('formatCommandSuggestion', () => {
    it('should show "Unknown command" with no suggestions', () => {
      const result = formatCommandSuggestion('/foo', []);
      expect(result).toContain('Unknown command');
      expect(result).toContain('/foo');
      expect(result).toContain('/help');
    });

    it('should show "Did you mean" with suggestions', () => {
      const result = formatCommandSuggestion('/writ', ['/write']);
      expect(result).toContain('Did you mean');
      expect(result).toContain('/write');
    });

    it('should list multiple suggestions', () => {
      const result = formatCommandSuggestion('/s', ['/status', '/schedule', '/show']);
      expect(result).toContain('/status');
      expect(result).toContain('/schedule');
      expect(result).toContain('/show');
    });
  });

  describe('formatContent', () => {
    it('should wrap content with borders', () => {
      const result = formatContent('Hello world');
      expect(result).toContain('Hello world');
      expect(result).toContain('━');
    });

    it('should include label when provided', () => {
      const result = formatContent('Hello world', 'Output');
      expect(result).toContain('Output');
    });
  });

  describe('formatHelp', () => {
    it('should list commands', () => {
      const result = formatHelp([
        { command: '/write', aliases: ['w'], description: 'Create content' },
        { command: '/help', aliases: ['h', '?'], description: 'Show help' },
      ]);
      expect(result).toContain('/write');
      expect(result).toContain('/help');
      expect(result).toContain('Create content');
    });

    it('should include aliases', () => {
      const result = formatHelp([
        { command: '/help', aliases: ['h', '?'], description: 'Show help' },
      ]);
      expect(result).toContain('h');
      expect(result).toContain('?');
    });

    it('should mention natural language', () => {
      const result = formatHelp([]);
      expect(result).toContain('natural language');
    });
  });

  describe('formatDebugInfo', () => {
    it('should display key-value pairs', () => {
      const result = formatDebugInfo({ status: 'ok', uptime: 123 });
      expect(result).toContain('status:');
      expect(result).toContain('ok');
      expect(result).toContain('uptime:');
      expect(result).toContain('123');
    });

    it('should handle object values', () => {
      const result = formatDebugInfo({ config: { a: 1 } });
      expect(result).toContain('config:');
    });
  });

  describe('formatClientInfo', () => {
    it('should display client info', () => {
      const result = formatClientInfo({
        id: 'acme',
        name: 'Acme Corp',
        industry: 'SaaS',
      });
      expect(result).toContain('Acme Corp');
      expect(result).toContain('acme');
      expect(result).toContain('SaaS');
    });

    it('should show platforms when present', () => {
      const result = formatClientInfo({
        id: 'acme',
        name: 'Acme Corp',
        industry: 'SaaS',
        platforms: [{ platform: 'linkedin' }, { platform: 'twitter' }],
      });
      expect(result).toContain('linkedin');
      expect(result).toContain('twitter');
    });

    it('should show content pillars when present', () => {
      const result = formatClientInfo({
        id: 'acme',
        name: 'Acme Corp',
        industry: 'SaaS',
        preferences: { contentPillars: ['AI', 'Cloud'] },
      });
      expect(result).toContain('AI');
      expect(result).toContain('Cloud');
    });
  });

  describe('formatPrompt', () => {
    it('should show client ID when set', () => {
      const result = formatPrompt('acme');
      expect(result).toContain('acme');
      expect(result).toContain('>');
    });

    it('should show "no-client" when null', () => {
      const result = formatPrompt(null);
      expect(result).toContain('no-client');
    });
  });

  describe('formatIssue', () => {
    it('should show issue message', () => {
      const result = formatIssue('Something went wrong');
      expect(result).toContain('Something went wrong');
    });

    it('should show next steps when provided', () => {
      const result = formatIssue('Something went wrong', ['Retry', 'Skip', 'Cancel']);
      expect(result).toContain('What now?');
      expect(result).toContain('Retry');
      expect(result).toContain('Skip');
      expect(result).toContain('Cancel');
    });

    it('should not show next steps when empty', () => {
      const result = formatIssue('Something went wrong', []);
      expect(result).not.toContain('What now?');
    });
  });

  describe('formatContentOutput', () => {
    it('should show content with borders', () => {
      const result = formatContentOutput({
        content: 'Hello world',
      });
      expect(result).toContain('Hello world');
      expect(result).toContain('━');
    });

    it('should show platform and client name', () => {
      const result = formatContentOutput({
        content: 'Test',
        platform: 'LinkedIn',
        clientName: 'Acme',
      });
      expect(result).toContain('LinkedIn');
      expect(result).toContain('Acme');
    });

    it('should show word count and score', () => {
      const result = formatContentOutput({
        content: 'Test content',
        wordCount: 127,
        score: 94,
      });
      expect(result).toContain('Words: 127');
      expect(result).toContain('Score: 94/100');
    });

    it('should show approve/revise/regenerate prompt', () => {
      const result = formatContentOutput({
        content: 'Test',
      });
      expect(result).toContain('Approve');
      expect(result).toContain('Revise');
      expect(result).toContain('Regenerate');
    });

    it('should show hashtags when provided', () => {
      const result = formatContentOutput({
        content: 'Test',
        hashtags: '#AI #marketing',
      });
      expect(result).toContain('#AI #marketing');
    });
  });

  describe('formatPipelineProgress', () => {
    it('should show done stages with checkmark', () => {
      const result = formatPipelineProgress([
        { name: 'Context', status: 'done', time: '0.2s' },
      ]);
      expect(result).toContain('✓');
      expect(result).toContain('Context');
      expect(result).toContain('0.2s');
    });

    it('should show active stages with circle', () => {
      const result = formatPipelineProgress([
        { name: 'Draft', status: 'active' },
      ]);
      expect(result).toContain('●');
      expect(result).toContain('Draft');
    });

    it('should show pending stages with empty circle', () => {
      const result = formatPipelineProgress([
        { name: 'Review', status: 'pending' },
      ]);
      expect(result).toContain('○');
      expect(result).toContain('Review');
    });

    it('should show failed stages with X', () => {
      const result = formatPipelineProgress([
        { name: 'Review', status: 'failed', time: 'timeout' },
      ]);
      expect(result).toContain('✗');
      expect(result).toContain('Review');
    });

    it('should use tree connectors', () => {
      const result = formatPipelineProgress([
        { name: 'Context', status: 'done' },
        { name: 'Brief', status: 'done' },
        { name: 'Review', status: 'pending' },
      ]);
      expect(result).toContain('├─');
      expect(result).toContain('└─');
    });
  });
});
