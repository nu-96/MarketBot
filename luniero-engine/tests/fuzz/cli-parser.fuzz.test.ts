import { describe, it, expect } from 'vitest';
import { test as fcTest, fc } from '@fast-check/vitest';
import { parse, getSuggestions, isValidCommand, resolveAlias } from '../../src/cli/parser';

describe('CLI Parser Fuzz Tests', () => {
  fcTest.prop([fc.string()])('parse should never throw on arbitrary string input', (input) => {
    expect(() => parse(input)).not.toThrow();
    const result = parse(input);
    expect(result).toBeDefined();
    expect(typeof result.command).toBe('string');
    expect(typeof result.subcommand).toBe('string');
    expect(Array.isArray(result.args)).toBe(true);
    expect(typeof result.flags).toBe('object');
    expect(typeof result.rawInput).toBe('string');
    expect(typeof result.isNLP).toBe('boolean');
  });

  fcTest.prop([fc.string()])('parse result should always have valid structure', (input) => {
    const result = parse(input);
    // command is always a string
    expect(typeof result.command).toBe('string');
    // if command starts with /, isNLP should be false
    if (input.trim().startsWith('/')) {
      expect(result.isNLP).toBe(false);
    }
    // args is always an array of strings
    for (const arg of result.args) {
      expect(typeof arg).toBe('string');
    }
    // flags values are always string or boolean
    for (const val of Object.values(result.flags)) {
      expect(typeof val === 'string' || typeof val === 'boolean').toBe(true);
    }
  });

  fcTest.prop([fc.string()])('getSuggestions should never throw', (input) => {
    expect(() => getSuggestions(input)).not.toThrow();
    const suggestions = getSuggestions(input);
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    for (const s of suggestions) {
      expect(typeof s).toBe('string');
    }
  });

  fcTest.prop([fc.string()])('isValidCommand should never throw', (input) => {
    expect(() => isValidCommand(input)).not.toThrow();
    expect(typeof isValidCommand(input)).toBe('boolean');
  });

  fcTest.prop([fc.string()])('resolveAlias should never throw', (input) => {
    expect(() => resolveAlias(input)).not.toThrow();
    expect(typeof resolveAlias(input)).toBe('string');
  });

  // Test with specific tricky inputs
  describe('edge cases', () => {
    const edgeCases = [
      '',
      ' ',
      '/',
      '//',
      '////',
      '\n',
      '\t',
      '\r\n',
      '\0',
      'a'.repeat(10000),
      '/'.repeat(1000),
      '--'.repeat(500),
      '""',
      "''",
      '"unclosed',
      "'unclosed",
      '/write --flag=',
      '/write --=value',
      '/write ----',
      '/write -',
      '/ command',
      '  /help  ',
      '/HELP',
      '/hElP',
      String.fromCharCode(0, 1, 2, 3, 4, 5),
      '🚀 emoji input',
      '/write 🚀 post about 💡 ideas',
      '日本語の入力',
      '/write "quoted "nested" quotes"',
      '/write --flag="value with spaces"',
      'write\0about\0things',
      '/write\ttabbed\tinput',
    ];

    for (const input of edgeCases) {
      it(`should not crash on: ${JSON.stringify(input).substring(0, 60)}`, () => {
        expect(() => parse(input)).not.toThrow();
        expect(() => getSuggestions(input)).not.toThrow();
      });
    }
  });

  // Test that slash commands always parse to non-NLP
  fcTest.prop([fc.string({ minLength: 1 }).map(s => '/' + s)])('slash commands should never be NLP', (input) => {
    const result = parse(input);
    expect(result.isNLP).toBe(false);
  });

  // Test that regular text without / always parses as NLP
  fcTest.prop([fc.string({ minLength: 1 }).filter(s => !s.trim().startsWith('/') && s.trim().length > 0)])('non-slash input should be NLP', (input) => {
    const result = parse(input);
    expect(result.isNLP).toBe(true);
  });
});
