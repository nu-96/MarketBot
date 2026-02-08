import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as readline from 'readline';
import { HandlerContext } from '../../../src/cli/router';
import { createSession } from '../../../src/cli/session';
import { ParsedCommand } from '../../../src/cli/parser';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('This is sample text from a file. It has multiple sentences. Here is more content for testing.'),
  };
});

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
    searchClientContext: vi.fn().mockResolvedValue([]),
    searchByFileName: vi.fn().mockResolvedValue([]),
    storeClientContext: vi.fn().mockResolvedValue(undefined),
    getVectorStats: vi.fn().mockResolvedValue({ totalVectors: 0, documents: [] }),
  },
}));

import { handleUpload, handleUploads } from '../../../src/cli/handlers/upload';
import { existsSync, readFileSync } from 'fs';
import { clientStore } from '../../../src/memory/client-store';

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
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('This is sample text from a file. It has multiple sentences. Here is more content for testing.');
  });

  it('should require a file path', async () => {
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
    expect(result.session.lastHandler).toBeNull();
  });

  it('should require an active client', async () => {
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

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('no active client'))).toBe(true);
  });

  it('should error when file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/upload',
        subcommand: 'nonexistent.txt',
        args: [],
        flags: {},
        rawInput: '/upload nonexistent.txt',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('file not found'))).toBe(true);
    expect(result.session.lastHandler).toBe('/upload');
  });

  it('should extract text from a text file and store chunks in client memory', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/upload',
        subcommand: 'report.txt',
        args: [],
        flags: {},
        rawInput: '/upload report.txt',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('uploaded'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('report.txt'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('chunk'))).toBe(true);
    expect(clientStore.storeClientContext).toHaveBeenCalled();
    expect(result.session.lastHandler).toBe('/upload');
  });

  it('should store chunks with correct metadata', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/upload',
        subcommand: 'data.csv',
        args: [],
        flags: { type: 'research' },
        rawInput: '/upload data.csv --type=research',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleUpload(ctx);

    expect(clientStore.storeClientContext).toHaveBeenCalledWith('acme', expect.objectContaining({
      type: 'content',
      metadata: expect.objectContaining({
        source: 'file_upload',
        fileName: 'data.csv',
        docType: 'research',
      }),
    }));
  });

  it('should accept file path from args[0]', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/upload',
        subcommand: '',
        args: ['notes.md'],
        flags: {},
        rawInput: '/upload notes.md',
        isNLP: false,
      } as ParsedCommand,
      rl: mockRL(['notes.md']),
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('notes.md'))).toBe(true);
    expect(result.session.lastHandler).toBe('/upload');
  });

  it('should use --client flag for client ID', async () => {
    const ctx = mockCtx({
      parsed: {
        command: '/upload',
        subcommand: 'brief.txt',
        args: [],
        flags: { client: 'beta-corp' },
        rawInput: '/upload brief.txt --client=beta-corp',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleUpload(ctx);

    expect(clientStore.storeClientContext).toHaveBeenCalledWith('beta-corp', expect.anything());
  });

  it('should error on empty file', async () => {
    vi.mocked(readFileSync).mockReturnValue('');

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/upload',
        subcommand: 'empty.txt',
        args: [],
        flags: {},
        rawInput: '/upload empty.txt',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('empty'))).toBe(true);
    expect(result.session.lastHandler).toBe('/upload');
  });

  it('should handle unsupported file types', async () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('Unsupported file type: .exe'); });

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/upload',
        subcommand: 'malware.exe',
        args: [],
        flags: {},
        rawInput: '/upload malware.exe',
        isNLP: false,
      } as ParsedCommand,
    });

    const result = await handleUpload(ctx);

    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('unsupported'))).toBe(true);
  });

  it('should display vector space stats after successful upload', async () => {
    vi.mocked(clientStore.getVectorStats).mockResolvedValue({
      totalVectors: 24,
      documents: [
        { fileName: 'report.txt', chunks: 1, docType: 'general' },
        { fileName: 'brand-guidelines.pdf', chunks: 8, docType: 'voice' },
      ],
    });

    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/upload',
        subcommand: 'report.txt',
        args: [],
        flags: {},
        rawInput: '/upload report.txt',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleUpload(ctx);

    expect(clientStore.getVectorStats).toHaveBeenCalledWith('acme');
    const calls = (ctx.output as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((msg: string) => msg.includes('Vector Space'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('report.txt'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('brand-guidelines.pdf'))).toBe(true);
    expect(calls.some((msg: string) => msg.includes('Total vectors: 24'))).toBe(true);
  });

  it('should default docType to general when --type not provided', async () => {
    const ctx = mockCtx({
      session: createSession({ activeClientId: 'acme' }),
      parsed: {
        command: '/upload',
        subcommand: 'doc.txt',
        args: [],
        flags: {},
        rawInput: '/upload doc.txt',
        isNLP: false,
      } as ParsedCommand,
    });

    await handleUpload(ctx);

    expect(clientStore.storeClientContext).toHaveBeenCalledWith('acme', expect.objectContaining({
      metadata: expect.objectContaining({
        docType: 'general',
      }),
    }));
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
