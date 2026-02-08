import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as readline from 'readline';
import { HandlerContext } from '../../../src/cli/router';
import { createSession } from '../../../src/cli/session';
import { ParsedCommand } from '../../../src/cli/parser';

vi.mock('../../../src/core/state-store', () => ({
  stateStore: {
    getJob: vi.fn(),
    updateJob: vi.fn(),
    getJobsByClient: vi.fn().mockResolvedValue([]),
    createJob: vi.fn(),
  },
}));

vi.mock('../../../src/core/message-bus', () => ({
  messageBus: {
    publish: vi.fn().mockResolvedValue('evt-1'),
    subscribe: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/memory/client-store', () => ({
  clientStore: {
    getProfile: vi.fn().mockResolvedValue(null),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    getBrandVoice: vi.fn().mockResolvedValue(null),
    getContentPillars: vi.fn().mockResolvedValue([]),
  },
}));

import { handleUpload, handleUploads } from '../../../src/cli/handlers/upload';

function mockRL(answers: string[] = []) {
  let i = 0;
  return {
    question: vi.fn((q: string, cb: (a: string) => void) => cb(answers[i++] || '')),
  } as unknown as readline.Interface;
}

function mockCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    session: createSession(),
    parsed: { command: '', subcommand: '', args: [], flags: {}, rawInput: '', isNLP: false } as ParsedCommand,
    rl: mockRL(),
    output: vi.fn(),
    ...overrides,
  };
}

describe('handleUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should accept a file path from subcommand and show upload info', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/upload',
        subcommand: 'report.pdf',
        args: [],
        flags: {},
        rawInput: '/upload report.pdf',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('report.pdf'))).toBe(true);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('upload'))).toBe(true);
    expect(result.session.lastHandler).toBe('/upload');
  });

  it('should accept a file path from args[0]', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/upload',
        subcommand: '',
        args: ['data.csv'],
        flags: {},
        rawInput: '/upload data.csv',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('data.csv'))).toBe(true);
    expect(result.session.lastHandler).toBe('/upload');
  });

  it('should prompt for file path when not provided and show error when empty', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/upload',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/upload',
        isNLP: false,
      } as ParsedCommand,
      rl: mockRL(['']),
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('file path is required'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('Usage:'))).toBe(true);
    // Session should not have lastHandler set to /upload since it errored without it
    expect(result.session.lastHandler).toBeNull();
  });

  it('should prompt for file path and accept the prompted value', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/upload',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/upload',
        isNLP: false,
      } as ParsedCommand,
      rl: mockRL(['my-file.docx']),
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('my-file.docx'))).toBe(true);
    expect(result.session.lastHandler).toBe('/upload');
  });

  it('should mention not yet implemented', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/upload',
        subcommand: 'test.txt',
        args: [],
        flags: {},
        rawInput: '/upload test.txt',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('not yet implemented'))).toBe(true);
  });
});

describe('handleUploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show no active client message when no client is set', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/uploads',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/uploads',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no active client'))).toBe(true);
    expect(result.session.lastHandler).toBe('/uploads');
  });

  it('should show no uploads message when client is active', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/uploads',
        subcommand: '',
        args: [],
        flags: {},
        rawInput: '/uploads',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('acme'))).toBe(true);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no uploads found'))).toBe(true);
    expect(result.session.lastHandler).toBe('/uploads');
  });

  it('should accept --client flag for listing uploads', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/uploads',
        subcommand: '',
        args: [],
        flags: { client: 'beta-corp' },
        rawInput: '/uploads --client=beta-corp',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('beta-corp'))).toBe(true);
    expect(result.session.lastHandler).toBe('/uploads');
  });

  it('should handle "show" subcommand without file ID', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/uploads',
        subcommand: 'show',
        args: [],
        flags: {},
        rawInput: '/uploads show',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('file id is required'))).toBe(true);
    // Should not set lastHandler since it returned early with error
    expect(result.session.lastHandler).toBeNull();
  });

  it('should handle "show" subcommand with file ID', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/uploads',
        subcommand: 'show',
        args: ['file-abc'],
        flags: {},
        rawInput: '/uploads show file-abc',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('file-abc'))).toBe(true);
    expect(result.session.lastHandler).toBe('/uploads');
  });

  it('should handle "delete" subcommand without file ID', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/uploads',
        subcommand: 'delete',
        args: [],
        flags: {},
        rawInput: '/uploads delete',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('file id is required'))).toBe(true);
  });

  it('should handle "delete" subcommand with file ID', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/uploads',
        subcommand: 'delete',
        args: ['file-xyz'],
        flags: {},
        rawInput: '/uploads delete file-xyz',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('file-xyz'))).toBe(true);
    expect(result.session.lastHandler).toBe('/uploads');
  });

  it('should handle "search" subcommand without query', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/uploads',
        subcommand: 'search',
        args: [],
        flags: {},
        rawInput: '/uploads search',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('search query is required'))).toBe(true);
  });

  it('should handle "search" subcommand with query', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/uploads',
        subcommand: 'search',
        args: ['brand', 'guidelines'],
        flags: {},
        rawInput: '/uploads search brand guidelines',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUploads(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('brand guidelines'))).toBe(true);
    expect(result.session.lastHandler).toBe('/uploads');
  });
});
