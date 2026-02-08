import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('fs');
vi.mock('os');

vi.mock('../../src/memory/client-store', () => ({
  clientStore: {
    getProfile: vi.fn().mockResolvedValue(null),
    saveProfile: vi.fn().mockResolvedValue(undefined),
    getBrandVoice: vi.fn().mockResolvedValue(null),
    getContentPillars: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: any) {
    this.messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Custom command output' }],
      }),
    };
  });
  return { default: MockAnthropic };
});

import {
  getCommandsDir,
  loadCustomCommands,
  saveCustomCommand,
  deleteCustomCommand,
  createCustomHandler,
} from '../../src/cli/custom-commands';

describe('custom-commands', () => {
  const mockHome = '/mock/home';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCommandsDir', () => {
    it('should return the correct directory', () => {
      const dir = getCommandsDir();
      expect(dir).toBe(path.join(mockHome, '.luniero', 'commands'));
    });
  });

  describe('loadCustomCommands', () => {
    it('should return empty map when directory does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const commands = loadCustomCommands();
      expect(commands.size).toBe(0);
    });

    it('should load .md files from the commands directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['social-audit.md', 'review.md'] as any);
      vi.mocked(fs.readFileSync).mockReturnValue('Perform audit for $ARGUMENTS');

      const commands = loadCustomCommands();
      expect(commands.size).toBe(2);
      expect(commands.has('/social-audit')).toBe(true);
      expect(commands.has('/review')).toBe(true);
      expect(commands.get('/social-audit')?.promptTemplate).toBe('Perform audit for $ARGUMENTS');
    });

    it('should ignore non-.md files', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['cmd.md', 'readme.txt', 'notes.json'] as any);
      vi.mocked(fs.readFileSync).mockReturnValue('template');

      const commands = loadCustomCommands();
      expect(commands.size).toBe(1);
      expect(commands.has('/cmd')).toBe(true);
    });
  });

  describe('saveCustomCommand', () => {
    it('should write a .md file to the commands directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

      const filePath = saveCustomCommand('greeting', 'Hello $ARGUMENTS');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('greeting.md'),
        'Hello $ARGUMENTS',
        'utf-8',
      );
      expect(filePath).toContain('greeting.md');
    });

    it('should strip leading slash from name', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as any);

      const filePath = saveCustomCommand('/greeting', 'Hello $ARGUMENTS');
      expect(filePath).toContain('greeting.md');
      expect(filePath).not.toContain('//');
    });
  });

  describe('deleteCustomCommand', () => {
    it('should delete the file and return true when it exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const result = deleteCustomCommand('greeting');
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should return false when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = deleteCustomCommand('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('createCustomHandler', () => {
    it('should return a function', () => {
      const handler = createCustomHandler('Do $ARGUMENTS');
      expect(typeof handler).toBe('function');
    });
  });
});
