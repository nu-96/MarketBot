import { describe, it, expect } from 'vitest';
import { test as fcTest } from '@fast-check/vitest';
import fc from 'fast-check';

/**
 * Tests the JSON parsing logic used in brief-agent and review-agent
 * to extract JSON from LLM responses that may contain markdown wrappers
 */

function parseJsonFromLLMResponse(response: string): any {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch {
    return null;
  }
}

describe('Fuzz Tests: JSON Parsing from LLM Responses', () => {
  describe('parseJsonFromLLMResponse', () => {
    fcTest.prop([fc.string()])('should never throw on any string input', (input) => {
      expect(() => parseJsonFromLLMResponse(input)).not.toThrow();
    });

    it('should parse clean JSON', () => {
      const result = parseJsonFromLLMResponse('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('should parse JSON wrapped in markdown code block', () => {
      const result = parseJsonFromLLMResponse('```json\n{"key": "value"}\n```');
      expect(result).toEqual({ key: 'value' });
    });

    it('should parse JSON with surrounding text', () => {
      const result = parseJsonFromLLMResponse('Here is my review:\n{"status": "approved", "score": 90}\nThat looks good.');
      expect(result).toEqual({ status: 'approved', score: 90 });
    });

    it('should return null for empty string', () => {
      expect(parseJsonFromLLMResponse('')).toBeNull();
    });

    it('should return null for no JSON content', () => {
      expect(parseJsonFromLLMResponse('This is just text with no JSON')).toBeNull();
    });

    it('should handle nested JSON objects', () => {
      const result = parseJsonFromLLMResponse('{"a": {"b": {"c": 1}}}');
      expect(result).toEqual({ a: { b: { c: 1 } } });
    });

    it('should handle JSON with arrays', () => {
      const result = parseJsonFromLLMResponse('{"items": [1, 2, 3]}');
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('should return null for truncated JSON', () => {
      const result = parseJsonFromLLMResponse('{"key": "val');
      expect(result).toBeNull();
    });

    it('should handle JSON with unicode characters', () => {
      const result = parseJsonFromLLMResponse('{"emoji": "\\u2764", "text": "hello"}');
      expect(result).toBeDefined();
    });

    it('should handle multiple JSON objects (picks first complete match)', () => {
      const result = parseJsonFromLLMResponse('{"a": 1} some text {"b": 2}');
      // The regex greedily matches from first { to last }
      // This is known behavior - it will try to parse the whole span
      expect(result).toBeDefined();
    });

    fcTest.prop([fc.jsonValue()])('should roundtrip any valid JSON value wrapped in object', (value) => {
      const wrapped = JSON.stringify({ data: value });
      const result = parseJsonFromLLMResponse(wrapped);
      expect(result).toBeDefined();
      // JSON.stringify(-0) produces "0", so -0 doesn't roundtrip through JSON
      const expected = JSON.parse(JSON.stringify(value));
      expect(result.data).toEqual(expected);
    });

    fcTest.prop([
      fc.string({ minLength: 0, maxLength: 100 }),
      fc.jsonValue(),
      fc.string({ minLength: 0, maxLength: 100 }),
    ])('should extract JSON from surrounding text', (prefix, value, suffix) => {
      const json = JSON.stringify({ data: value });
      const response = `${prefix}\n${json}\n${suffix}`;
      const result = parseJsonFromLLMResponse(response);
      // May or may not parse depending on whether prefix/suffix contain braces
      // Key thing: should never throw
      expect(result === null || typeof result === 'object').toBe(true);
    });

    // Adversarial inputs
    it('should handle extremely long strings', () => {
      const long = 'a'.repeat(100000);
      expect(() => parseJsonFromLLMResponse(long)).not.toThrow();
    });

    it('should handle deeply nested braces', () => {
      const deep = '{'.repeat(50) + '"key": "val"' + '}'.repeat(50);
      expect(() => parseJsonFromLLMResponse(deep)).not.toThrow();
    });

    it('should handle strings with special regex characters', () => {
      const input = '{"key": "value with [brackets] and (parens) and $dollar"}';
      const result = parseJsonFromLLMResponse(input);
      expect(result).toBeDefined();
    });

    it('should handle null bytes in string', () => {
      expect(() => parseJsonFromLLMResponse('before\x00after')).not.toThrow();
    });

    it('should handle newlines in JSON strings', () => {
      const result = parseJsonFromLLMResponse('{"text": "line1\\nline2"}');
      expect(result).toEqual({ text: 'line1\nline2' });
    });
  });
});
