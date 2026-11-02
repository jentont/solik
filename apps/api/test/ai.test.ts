import { describe, expect, it } from 'vitest';
import { FallbackProvider, type AIProvider } from '../src/modules/ai/provider.js';
import { parseJsonReply } from '../src/modules/ai/openai.js';

const post = { headline: 'H', text: 'T', cta: 'C', description: 'D', short: 'S', post: '<b>P</b>' };
const ok = (id: string, image = false): AIProvider => ({
  id,
  textModel: id,
  imageModel: image ? id + '-img' : '',
  generatePost: async () => ({ ...post, headline: id }),
  generateImage: async () => Buffer.from(id),
});
const failing = (id: string, image = false): AIProvider => ({
  id,
  textModel: id,
  imageModel: image ? id + '-img' : '',
  generatePost: async () => {
    throw new Error('429 quota');
  },
  generateImage: async () => {
    throw new Error('429 quota');
  },
});

describe('AI fallback chain', () => {
  it('uses the first provider that works', async () => {
    const p = new FallbackProvider([failing('gemini', true), ok('groq'), ok('openrouter')]);
    expect((await p.generatePost({ title: 't', prize: 'p' })).headline).toBe('groq');
  });
  it('reports every error when all fail', async () => {
    const p = new FallbackProvider([failing('gemini'), failing('groq')]);
    await expect(p.generatePost({ title: 't', prize: 'p' })).rejects.toThrow(/gemini: 429 quota \| groq: 429 quota/);
  });
  it('images only go to providers that can draw', async () => {
    const p = new FallbackProvider([ok('groq'), ok('gemini', true)]);
    expect((await p.generateImage('x')).toString()).toBe('gemini');
    await expect(new FallbackProvider([ok('groq')]).generateImage('x')).rejects.toThrow();
  });
});

describe('model reply parsing', () => {
  it('reads JSON wrapped in prose or fences', () => {
    expect(parseJsonReply('Вот ответ:\n```json\n' + JSON.stringify(post) + '\n```').post).toBe('<b>P</b>');
  });
  it('builds the post from parts when "post" is missing', () => {
    expect(parseJsonReply('{"headline":"А","text":"Б","cta":"В"}').post).toBe('А\n\nБ\n\nВ');
  });
  it('rejects replies without JSON', () => {
    expect(() => parseJsonReply('извините, не могу')).toThrow();
  });
});
