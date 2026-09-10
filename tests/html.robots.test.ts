import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../mcp/src/html.js';
import { hasNoAiSignal, isPathDisallowed } from '../mcp/src/robots.js';

describe('html and robots helpers', () => {
  it('converts a page to markdown with title', () => {
    const { title, markdown } = htmlToMarkdown(
      `<html><head><title>Hello</title></head><body><h1>Hello</h1><p>World</p></body></html>`,
      200_000,
    );
    expect(title).toBe('Hello');
    expect(markdown).toContain('# Hello');
    expect(markdown).toContain('World');
  });

  it('truncates at maxChars', () => {
    const { markdown } = htmlToMarkdown(`<p>${'a'.repeat(50)}</p>`, 10);
    expect(markdown.length).toBe(10);
  });

  it('honors Disallow /', () => {
    expect(isPathDisallowed('User-agent: *\nDisallow: /\n', '/post')).toBe(true);
    expect(isPathDisallowed('User-agent: *\nAllow: /\n', '/post')).toBe(false);
  });

  it('detects noai meta and x-robots-tag', () => {
    expect(hasNoAiSignal('<meta name="robots" content="noai">')).toBe(true);
    const headers = new Headers({ 'X-Robots-Tag': 'noai' });
    expect(hasNoAiSignal('<html></html>', headers)).toBe(true);
    expect(hasNoAiSignal('<html><p>ok</p></html>')).toBe(false);
  });
});
