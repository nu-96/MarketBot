import { describe, it, expect } from 'vitest';
import {
  parse,
  resolveAlias,
  isValidCommand,
  getSuggestions,
  ALIASES,
  VALID_COMMANDS,
  _tokenize,
  registerCommand,
  unregisterCommand,
} from '../../src/cli/parser';

describe('parser', () => {
  describe('parse - slash commands', () => {
    it('should parse a simple command', () => {
      const result = parse('/help');
      expect(result.command).toBe('/help');
      expect(result.subcommand).toBe('');
      expect(result.args).toEqual([]);
      expect(result.isNLP).toBe(false);
    });

    it('should parse command with subcommand', () => {
      const result = parse('/client list');
      expect(result.command).toBe('/client');
      expect(result.subcommand).toBe('list');
    });

    it('should parse command with subcommand and args', () => {
      const result = parse('/client new acme "Acme Corp" SaaS');
      expect(result.command).toBe('/client');
      expect(result.subcommand).toBe('new');
      expect(result.args).toEqual(['acme', 'Acme Corp', 'SaaS']);
    });

    it('should resolve aliases', () => {
      expect(parse('/w a post').command).toBe('/write');
      expect(parse('/q').command).toBe('/quick');
      expect(parse('/h').command).toBe('/help');
      expect(parse('/?').command).toBe('/help');
      expect(parse('/c list').command).toBe('/client');
      expect(parse('/s').command).toBe('/status');
    });

    it('should resolve spec-defined aliases for /write', () => {
      expect(parse('/create a post').command).toBe('/write');
      expect(parse('/draft a post').command).toBe('/write');
      expect(parse('/make a post').command).toBe('/write');
    });

    it('should resolve spec-defined aliases for /quick', () => {
      expect(parse('/fast tweet').command).toBe('/quick');
    });

    it('should resolve spec-defined aliases for /calendar', () => {
      expect(parse('/plan next week').command).toBe('/calendar');
    });

    it('should resolve spec-defined aliases for /report', () => {
      expect(parse('/analytics monthly').command).toBe('/report');
      expect(parse('/stats weekly').command).toBe('/report');
    });

    it('should resolve spec-defined aliases for /research', () => {
      expect(parse('/find trending topics').command).toBe('/research');
      expect(parse('/search competitor content').command).toBe('/research');
    });

    it('should resolve spec-defined aliases for /approve', () => {
      expect(parse('/ok').command).toBe('/approve');
      expect(parse('/yes').command).toBe('/approve');
      expect(parse('/lgtm').command).toBe('/approve');
    });

    it('should resolve spec-defined aliases for /revise', () => {
      expect(parse('/edit make it shorter').command).toBe('/revise');
      expect(parse('/change the tone').command).toBe('/revise');
      expect(parse('/fix the intro').command).toBe('/revise');
    });

    it('should resolve spec-defined alias /post for /schedule', () => {
      expect(parse('/post tomorrow').command).toBe('/schedule');
    });

    it('should be case-insensitive for commands', () => {
      expect(parse('/HELP').command).toBe('/help');
      expect(parse('/Write').command).toBe('/write');
    });

    it('should extract flags', () => {
      const result = parse('/write --platform=linkedin --verbose');
      expect(result.flags.platform).toBe('linkedin');
      expect(result.flags.verbose).toBe(true);
    });

    it('should extract single-char flags', () => {
      const result = parse('/write -v -f');
      expect(result.flags.v).toBe(true);
      expect(result.flags.f).toBe(true);
    });

    it('should handle quoted arguments', () => {
      const result = parse('/client new acme "Acme Corporation Inc"');
      expect(result.args).toContain('Acme Corporation Inc');
    });

    it('should extract platform from args text', () => {
      const result = parse('/write a LinkedIn post about AI');
      expect(result.platform).toBe('linkedin');
    });

    it('should extract content type from args text', () => {
      const result = parse('/write a blog about AI');
      expect(result.contentType).toBe('blog_post');
    });

    it('should extract topic', () => {
      const result = parse('/write a post about AI trends');
      expect(result.topic).toContain('AI trends');
    });

    it('should preserve rawInput', () => {
      const result = parse('  /help   ');
      expect(result.rawInput).toBe('/help');
    });
  });

  describe('parse - NLP', () => {
    it('should detect write intent', () => {
      const result = parse('write a LinkedIn post about AI trends');
      expect(result.command).toBe('/write');
      expect(result.isNLP).toBe(true);
      expect(result.platform).toBe('linkedin');
    });

    it('should detect quick intent', () => {
      const result = parse('suggest headlines for our product launch');
      expect(result.command).toBe('/quick');
      expect(result.isNLP).toBe(true);
    });

    it('should detect research intent', () => {
      const result = parse('research competitor trends for SaaS');
      expect(result.command).toBe('/research');
      expect(result.isNLP).toBe(true);
    });

    it('should detect approval intent', () => {
      expect(parse('approve').command).toBe('/approve');
      expect(parse('yes').command).toBe('/approve');
      expect(parse('ok').command).toBe('/approve');
      expect(parse('lgtm').command).toBe('/approve');
      expect(parse('looks good').command).toBe('/approve');
      expect(parse('ship it').command).toBe('/approve');
    });

    it('should detect revise intent', () => {
      expect(parse('revise').command).toBe('/revise');
      expect(parse('edit').command).toBe('/revise');
      expect(parse('change').command).toBe('/revise');
      expect(parse('fix').command).toBe('/revise');
      expect(parse('redo').command).toBe('/revise');
      expect(parse('try again').command).toBe('/revise');
    });

    it('should detect reject intent', () => {
      expect(parse('reject').command).toBe('/reject');
      expect(parse('no').command).toBe('/reject');
      expect(parse('nope').command).toBe('/reject');
      expect(parse('scrap').command).toBe('/reject');
    });

    it('should return empty command for unrecognized NLP', () => {
      const result = parse('hello there');
      expect(result.command).toBe('');
      expect(result.isNLP).toBe(true);
    });

    it('should extract NLP flags', () => {
      const result = parse('write a post about AI --platform=twitter');
      expect(result.flags.platform).toBe('twitter');
    });

    it('should parse bare word commands with subcommands', () => {
      const result = parse('client pillars add "AI automation"');
      expect(result.command).toBe('/client');
      expect(result.subcommand).toBe('pillars');
      expect(result.args).toContain('add');
      expect(result.args).toContain('AI automation');
      expect(result.isNLP).toBe(true);
    });

    it('should parse bare word client switch', () => {
      const result = parse('client switch acme');
      expect(result.command).toBe('/client');
      expect(result.subcommand).toBe('switch');
      expect(result.args).toEqual(['acme']);
      expect(result.isNLP).toBe(true);
    });

    it('should parse bare word help with topic', () => {
      const result = parse('help write');
      expect(result.command).toBe('/help');
      expect(result.subcommand).toBe('write');
      expect(result.isNLP).toBe(true);
    });

    it('should parse bare word upload with path', () => {
      const result = parse('upload report.pdf');
      expect(result.command).toBe('/upload');
      expect(result.subcommand).toBe('report.pdf');
      expect(result.isNLP).toBe(true);
    });
  });

  describe('parse - empty/whitespace', () => {
    it('should handle empty string', () => {
      const result = parse('');
      expect(result.command).toBe('');
      expect(result.isNLP).toBe(false);
    });

    it('should handle whitespace-only string', () => {
      const result = parse('   ');
      expect(result.command).toBe('');
    });
  });

  describe('resolveAlias', () => {
    it('should resolve known aliases', () => {
      expect(resolveAlias('/w')).toBe('/write');
      expect(resolveAlias('/h')).toBe('/help');
      expect(resolveAlias('/c')).toBe('/client');
    });

    it('should return input for non-aliases', () => {
      expect(resolveAlias('/write')).toBe('/write');
      expect(resolveAlias('/foobar')).toBe('/foobar');
    });

    it('should be case-insensitive', () => {
      expect(resolveAlias('/W')).toBe('/write');
    });
  });

  describe('isValidCommand', () => {
    it('should return true for valid commands', () => {
      expect(isValidCommand('/write')).toBe(true);
      expect(isValidCommand('/help')).toBe(true);
      expect(isValidCommand('/client')).toBe(true);
    });

    it('should return true for new spec commands', () => {
      expect(isValidCommand('/upload')).toBe(true);
      expect(isValidCommand('/uploads')).toBe(true);
      expect(isValidCommand('/repurpose')).toBe(true);
      expect(isValidCommand('/trending')).toBe(true);
    });

    it('should return false for invalid commands', () => {
      expect(isValidCommand('/foobar')).toBe(false);
      expect(isValidCommand('/w')).toBe(false); // alias, not a command
      expect(isValidCommand('help')).toBe(false); // missing slash
    });
  });

  describe('getSuggestions', () => {
    it('should suggest commands by prefix', () => {
      const suggestions = getSuggestions('/wr');
      expect(suggestions).toContain('/write');
    });

    it('should suggest commands by fuzzy match', () => {
      const suggestions = getSuggestions('/wrte');
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it('should limit suggestions', () => {
      const suggestions = getSuggestions('/s', 2);
      expect(suggestions.length).toBeLessThanOrEqual(2);
    });

    it('should return empty for very different input', () => {
      const suggestions = getSuggestions('/zzzzzzzzzzz');
      expect(suggestions.length).toBe(0);
    });

    it('should deduplicate alias resolutions', () => {
      const suggestions = getSuggestions('/he');
      const unique = [...new Set(suggestions)];
      expect(suggestions.length).toBe(unique.length);
    });
  });

  describe('_tokenize', () => {
    it('should split by spaces', () => {
      expect(_tokenize('a b c')).toEqual(['a', 'b', 'c']);
    });

    it('should handle double quotes', () => {
      expect(_tokenize('a "b c" d')).toEqual(['a', 'b c', 'd']);
    });

    it('should handle single quotes', () => {
      expect(_tokenize("a 'b c' d")).toEqual(['a', 'b c', 'd']);
    });

    it('should handle tabs', () => {
      expect(_tokenize('a\tb')).toEqual(['a', 'b']);
    });

    it('should handle multiple spaces', () => {
      expect(_tokenize('a    b')).toEqual(['a', 'b']);
    });

    it('should handle empty string', () => {
      expect(_tokenize('')).toEqual([]);
    });

    it('should handle unclosed quotes', () => {
      // Should not crash - just treats rest as part of token
      expect(_tokenize('"unclosed')).toEqual(['unclosed']);
    });
  });

  describe('ALIASES', () => {
    it('should have all aliases map to valid commands', () => {
      for (const [alias, command] of Object.entries(ALIASES)) {
        expect(VALID_COMMANDS.has(command), `${alias} -> ${command} should be valid`).toBe(true);
      }
    });
  });

  describe('registerCommand / unregisterCommand', () => {
    it('should register a new command', () => {
      expect(isValidCommand('/my-custom')).toBe(false);
      registerCommand('/my-custom');
      expect(isValidCommand('/my-custom')).toBe(true);
      // Cleanup
      unregisterCommand('/my-custom');
    });

    it('should unregister a command', () => {
      registerCommand('/temp-cmd');
      expect(isValidCommand('/temp-cmd')).toBe(true);
      unregisterCommand('/temp-cmd');
      expect(isValidCommand('/temp-cmd')).toBe(false);
    });

    it('should include /command as a valid command', () => {
      expect(isValidCommand('/command')).toBe(true);
    });
  });
});
