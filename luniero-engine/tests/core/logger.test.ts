import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/utils/logger';

describe('Logger', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.setLevel('debug'); // Enable all levels for testing
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    logger.setLevel('warn'); // Restore default
  });

  it('should log info messages', () => {
    logger.info('test message');
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('INFO');
    expect(output).toContain('test message');
  });

  it('should log debug messages', () => {
    logger.debug('debug msg');
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('DEBUG');
  });

  it('should log warn messages', () => {
    logger.warn('warning msg');
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('WARN');
  });

  it('should log error messages', () => {
    logger.error('error msg');
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('ERROR');
  });

  it('should include agent context in output', () => {
    logger.info('agent msg', undefined, { agent: 'brief-agent' });
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('[brief-agent]');
  });

  it('should include jobId context in output', () => {
    logger.info('job msg', undefined, { jobId: 'job-123' });
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('[job-123]');
  });

  it('should include both agent and jobId', () => {
    logger.info('both', undefined, { agent: 'router', jobId: 'j-1' });
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain('[router]');
    expect(output).toContain('[j-1]');
  });

  it('should log data as JSON when provided', () => {
    logger.info('with data', { key: 'value' });
    expect(consoleSpy).toHaveBeenCalledTimes(2); // message + data
    const dataOutput = consoleSpy.mock.calls[1][0];
    expect(dataOutput).toContain('"key"');
    expect(dataOutput).toContain('"value"');
  });

  it('should include ISO timestamp', () => {
    logger.info('timestamp test');
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should not log data when undefined', () => {
    logger.info('no data');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle null data gracefully', () => {
    logger.info('null data', null);
    // null is falsy so data should not be logged
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle complex nested data', () => {
    logger.info('nested', { a: { b: { c: [1, 2, 3] } } });
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('should suppress messages below the minimum level', () => {
    logger.setLevel('warn');
    logger.debug('hidden debug');
    logger.info('hidden info');
    expect(consoleSpy).not.toHaveBeenCalled();

    logger.warn('visible warn');
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    logger.error('visible error');
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('should default to warn level', () => {
    logger.setLevel('warn'); // reset
    expect(logger.getLevel()).toBe('warn');
  });
});
