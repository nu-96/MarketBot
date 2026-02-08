import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPulseSpinner,
  formatPipelineTree,
  getRotatingMessage,
  PULSE_FRAMES,
  PULSE_INTERVAL_MS,
  STAGE_MESSAGES,
  PipelineStage,
} from '../../../src/cli/utils/streaming';

describe('PULSE_FRAMES and PULSE_INTERVAL_MS exports', () => {
  it('should export PULSE_FRAMES as an array of 4 frames', () => {
    expect(PULSE_FRAMES).toEqual(['○', '◎', '●', '◎']);
    expect(PULSE_FRAMES).toHaveLength(4);
  });

  it('should export PULSE_INTERVAL_MS as 300', () => {
    expect(PULSE_INTERVAL_MS).toBe(300);
  });
});

describe('createPulseSpinner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return an object with start, update, and stop methods', () => {
    const spinner = createPulseSpinner('Loading...');
    expect(typeof spinner.start).toBe('function');
    expect(typeof spinner.update).toBe('function');
    expect(typeof spinner.stop).toBe('function');
  });

  it('should write to stdout on each interval tick after start', () => {
    const spinner = createPulseSpinner('Loading...');
    spinner.start();

    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Loading...'),
    );

    spinner.stop();
  });

  it('should cycle through pulse frames on successive ticks', () => {
    const spinner = createPulseSpinner('Working');
    spinner.start();

    const writeMock = process.stdout.write as ReturnType<typeof vi.fn>;

    // Tick through all 4 frames
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(PULSE_INTERVAL_MS);
      const callArg = writeMock.mock.calls[i][0] as string;
      expect(callArg).toContain(PULSE_FRAMES[i]);
    }

    // Frame 5 should wrap back to frame 0
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    const fifthCall = writeMock.mock.calls[4][0] as string;
    expect(fifthCall).toContain(PULSE_FRAMES[0]);

    spinner.stop();
  });

  it('should update the message displayed after calling update', () => {
    const spinner = createPulseSpinner('First message');
    spinner.start();

    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('First message'),
    );

    spinner.update('Second message');
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('Second message'),
    );

    spinner.stop();
  });

  it('should clear the line and stop the interval on stop', () => {
    const spinner = createPulseSpinner('Finishing');
    spinner.start();

    vi.advanceTimersByTime(PULSE_INTERVAL_MS);
    const writeMock = process.stdout.write as ReturnType<typeof vi.fn>;
    const callsBefore = writeMock.mock.calls.length;

    spinner.stop();

    // stop() should write a clearing line
    expect(writeMock.mock.calls.length).toBeGreaterThan(callsBefore);

    // No more writes after stop, even if time advances
    const callsAfterStop = writeMock.mock.calls.length;
    vi.advanceTimersByTime(PULSE_INTERVAL_MS * 5);
    expect(writeMock.mock.calls.length).toBe(callsAfterStop);
  });

  it('should write finalMessage when provided to stop', () => {
    const spinner = createPulseSpinner('Processing');
    spinner.start();
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);

    spinner.stop('Done!');

    const writeMock = process.stdout.write as ReturnType<typeof vi.fn>;
    const allCalls = writeMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(allCalls.some((msg: string) => msg.includes('Done!'))).toBe(true);
  });

  it('should not write finalMessage when not provided to stop', () => {
    const spinner = createPulseSpinner('Processing');
    spinner.start();
    vi.advanceTimersByTime(PULSE_INTERVAL_MS);

    spinner.stop();

    const writeMock = process.stdout.write as ReturnType<typeof vi.fn>;
    const allCalls = writeMock.mock.calls.map((c: unknown[]) => c[0] as string);
    // The last call should be the clearing line, not a message with newline
    const lastCall = allCalls[allCalls.length - 1];
    expect(lastCall.trim()).toBe('');
  });

  it('should be safe to call stop without calling start', () => {
    const spinner = createPulseSpinner('Never started');
    expect(() => spinner.stop()).not.toThrow();
    expect(() => spinner.stop('Final')).not.toThrow();
  });
});

describe('formatPipelineTree', () => {
  it('should format all pending stages', () => {
    const stages: PipelineStage[] = [
      { name: 'Context', status: 'pending' },
      { name: 'Brief', status: 'pending' },
      { name: 'Draft', status: 'pending' },
    ];
    const result = formatPipelineTree(stages);
    const lines = result.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('├─');
    expect(lines[0]).toContain('○');
    expect(lines[0]).toContain('Context');
    expect(lines[1]).toContain('├─');
    expect(lines[1]).toContain('○');
    expect(lines[1]).toContain('Brief');
    expect(lines[2]).toContain('└─');
    expect(lines[2]).toContain('○');
    expect(lines[2]).toContain('Draft');
  });

  it('should format mixed states correctly', () => {
    const stages: PipelineStage[] = [
      { name: 'Context', status: 'done', duration: 1.234 },
      { name: 'Brief', status: 'active', detail: 'Researching angles' },
      { name: 'Draft', status: 'pending' },
      { name: 'Review', status: 'pending' },
    ];
    const result = formatPipelineTree(stages);
    const lines = result.split('\n');

    expect(lines).toHaveLength(4);
    // Done stage with duration
    expect(lines[0]).toContain('✓');
    expect(lines[0]).toContain('Context');
    expect(lines[0]).toContain('(1.2s)');
    // Active stage with detail
    expect(lines[1]).toContain('●');
    expect(lines[1]).toContain('Brief');
    expect(lines[1]).toContain('Researching angles');
    // Pending stages
    expect(lines[2]).toContain('○');
    expect(lines[2]).toContain('Draft');
    expect(lines[3]).toContain('○');
    expect(lines[3]).toContain('Review');
  });

  it('should format all done stages with durations', () => {
    const stages: PipelineStage[] = [
      { name: 'Context', status: 'done', duration: 0.5 },
      { name: 'Brief', status: 'done', duration: 2.3 },
      { name: 'Draft', status: 'done', duration: 5.0 },
    ];
    const result = formatPipelineTree(stages);
    const lines = result.split('\n');

    expect(lines).toHaveLength(3);
    lines.forEach((line) => {
      expect(line).toContain('✓');
    });
    expect(lines[0]).toContain('(0.5s)');
    expect(lines[1]).toContain('(2.3s)');
    expect(lines[2]).toContain('(5.0s)');
  });

  it('should handle a single stage', () => {
    const stages: PipelineStage[] = [
      { name: 'Only Stage', status: 'active' },
    ];
    const result = formatPipelineTree(stages);

    expect(result).toContain('└─');
    expect(result).toContain('●');
    expect(result).toContain('Only Stage');
    // Single stage is both first and last, so it should use └─
    expect(result).not.toContain('├─');
  });

  it('should display duration for done stages', () => {
    const stages: PipelineStage[] = [
      { name: 'Step', status: 'done', duration: 12.456 },
    ];
    const result = formatPipelineTree(stages);
    expect(result).toContain('(12.5s)');
  });

  it('should not display duration when duration is not provided for done stage', () => {
    const stages: PipelineStage[] = [
      { name: 'Step', status: 'done' },
    ];
    const result = formatPipelineTree(stages);
    expect(result).toContain('✓');
    expect(result).toContain('Step');
    expect(result).not.toContain('(');
  });

  it('should display detail for active stages', () => {
    const stages: PipelineStage[] = [
      { name: 'Loading', status: 'active', detail: 'Fetching data' },
    ];
    const result = formatPipelineTree(stages);
    expect(result).toContain('Fetching data');
  });

  it('should display ellipsis when active stage has no detail', () => {
    const stages: PipelineStage[] = [
      { name: 'Loading', status: 'active' },
    ];
    const result = formatPipelineTree(stages);
    expect(result).toContain('Loading...');
  });

  it('should format failed state with detail', () => {
    const stages: PipelineStage[] = [
      { name: 'Context', status: 'done', duration: 1.0 },
      { name: 'Brief', status: 'failed', detail: 'API timeout' },
      { name: 'Draft', status: 'pending' },
    ];
    const result = formatPipelineTree(stages);
    const lines = result.split('\n');

    expect(lines[1]).toContain('✗');
    expect(lines[1]).toContain('Brief');
    expect(lines[1]).toContain('(API timeout)');
  });

  it('should format failed state without detail', () => {
    const stages: PipelineStage[] = [
      { name: 'Broken Step', status: 'failed' },
    ];
    const result = formatPipelineTree(stages);
    expect(result).toContain('✗');
    expect(result).toContain('Broken Step');
    expect(result).not.toContain('(');
  });

  it('should return empty string for empty stages array', () => {
    const result = formatPipelineTree([]);
    expect(result).toBe('');
  });

  it('should use ├─ for non-last items and └─ for last item', () => {
    const stages: PipelineStage[] = [
      { name: 'A', status: 'pending' },
      { name: 'B', status: 'pending' },
      { name: 'C', status: 'pending' },
    ];
    const result = formatPipelineTree(stages);
    const lines = result.split('\n');

    expect(lines[0]).toMatch(/^├─/);
    expect(lines[1]).toMatch(/^├─/);
    expect(lines[2]).toMatch(/^└─/);
  });

  it('should handle duration of 0', () => {
    const stages: PipelineStage[] = [
      { name: 'Quick', status: 'done', duration: 0 },
    ];
    const result = formatPipelineTree(stages);
    expect(result).toContain('(0.0s)');
  });
});

describe('getRotatingMessage', () => {
  it('should return the correct message for a valid stage and index', () => {
    const result = getRotatingMessage('context', 0);
    expect(result).toBe(STAGE_MESSAGES.context[0]);
  });

  it('should return the second message for index 1', () => {
    const result = getRotatingMessage('brief', 1);
    expect(result).toBe(STAGE_MESSAGES.brief[1]);
  });

  it('should wrap index when it exceeds the messages length', () => {
    const contextMessages = STAGE_MESSAGES.context;
    const len = contextMessages.length;
    // Index equal to length should wrap to 0
    expect(getRotatingMessage('context', len)).toBe(contextMessages[0]);
    // Index larger than length should wrap correctly
    expect(getRotatingMessage('context', len + 2)).toBe(contextMessages[2]);
  });

  it('should return fallback for an invalid/unknown stage', () => {
    const result = getRotatingMessage('nonexistent', 0);
    expect(result).toBe('nonexistent...');
  });

  it('should return fallback for an empty string stage', () => {
    const result = getRotatingMessage('', 0);
    expect(result).toBe('...');
  });

  it('should work correctly for all known stages', () => {
    for (const stage of Object.keys(STAGE_MESSAGES)) {
      const messages = STAGE_MESSAGES[stage];
      for (let i = 0; i < messages.length; i++) {
        expect(getRotatingMessage(stage, i)).toBe(messages[i]);
      }
    }
  });

  it('should handle the draft stage which has 5 messages', () => {
    expect(STAGE_MESSAGES.draft).toHaveLength(5);
    // Index 4 should give last message
    expect(getRotatingMessage('draft', 4)).toBe(STAGE_MESSAGES.draft[4]);
    // Index 5 should wrap to 0
    expect(getRotatingMessage('draft', 5)).toBe(STAGE_MESSAGES.draft[0]);
  });
});

describe('STAGE_MESSAGES', () => {
  it('should contain expected stage keys', () => {
    expect(Object.keys(STAGE_MESSAGES)).toEqual(
      expect.arrayContaining(['context', 'brief', 'draft', 'polish', 'review']),
    );
  });

  it('should have non-empty arrays for all stages', () => {
    for (const [key, messages] of Object.entries(STAGE_MESSAGES)) {
      expect(messages.length).toBeGreaterThan(0);
      for (const msg of messages) {
        expect(typeof msg).toBe('string');
        expect(msg.length).toBeGreaterThan(0);
      }
    }
  });
});
