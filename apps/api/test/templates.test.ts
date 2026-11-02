import { describe, expect, it } from 'vitest';
import { renderTemplate, sanitizeTelegramHtml, stripCustomEmoji } from '../src/templates/render.js';
import { DEFAULT_TEMPLATES } from '../src/templates/defaults.js';

describe('template variables', () => {
  it('substitutes known variables', () => {
    expect(renderTemplate('🎉 {username} выиграл {gift_name}', { username: '@ann', gift_name: 'Teddy Bear' })).toBe('🎉 @ann выиграл Teddy Bear');
  });
  it('escapes variable values (no HTML injection)', () => {
    const out = renderTemplate('Hi {first_name}', { first_name: '<b>x</b><a href="javascript:1">' });
    expect(out).toBe('Hi &lt;b&gt;x&lt;/b&gt;&lt;a href=&quot;javascript:1&quot;&gt;');
  });
  it('keeps unknown placeholders untouched', () => {
    expect(renderTemplate('{nope}', {})).toBe('{nope}');
  });
});

describe('sanitizer', () => {
  it('keeps Telegram formatting', () => {
    const s = '<b>b</b><i>i</i><u>u</u><s>s</s><tg-spoiler>x</tg-spoiler><a href="https://t.me/x">l</a>';
    expect(sanitizeTelegramHtml(s)).toBe(s);
  });
  it('keeps premium emoji entities', () => {
    const e = '<tg-emoji emoji-id="5368324170671202286">🎁</tg-emoji>';
    expect(sanitizeTelegramHtml(e)).toBe(e);
  });
  it('escapes unsupported tags and dangerous links', () => {
    expect(sanitizeTelegramHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeTelegramHtml('<a href="javascript:alert(1)">x</a>')).toContain('&lt;a');
    expect(sanitizeTelegramHtml('<b onclick="x">t</b>')).toBe('<b>t</b>');
  });
  it('closes dangling tags and escapes bare symbols', () => {
    expect(sanitizeTelegramHtml('<b>open & 1 < 2')).toBe('<b>open &amp; 1 &lt; 2</b>');
  });
  it('falls back from premium emoji to unicode', () => {
    expect(stripCustomEmoji('a <tg-emoji emoji-id="123456">⭐</tg-emoji> b')).toBe('a ⭐ b');
  });
  it('all default templates are valid Telegram HTML', () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) expect(sanitizeTelegramHtml(t)).toBe(t);
  });
});
