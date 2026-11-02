import type { AIProvider } from './provider.js';

/**
 * Pollinations (pollinations.ai): free image generation, no key required.
 * Without a token the service adds its own small watermark; a free token from
 * auth.pollinations.ai (POLLINATIONS_TOKEN) removes it. Images only.
 */
export class PollinationsProvider implements AIProvider {
  id = 'pollinations';
  textModel = '';
  imageModel: string;

  constructor(
    private token = '',
    model = 'flux',
  ) {
    this.imageModel = model;
  }

  async generatePost(): Promise<never> {
    throw new Error('pollinations: генерирует только изображения');
  }

  async generateImage(prompt: string): Promise<Buffer> {
    const params = new URLSearchParams({
      width: '1280',
      height: '720',
      model: this.imageModel,
      seed: String(Math.floor(Math.random() * 1e9)),
      nologo: 'true',
      private: 'true',
      referrer: 'solik',
    });
    const res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?${params}`, {
      headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
      signal: AbortSignal.timeout(120_000),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) throw new Error(`pollinations: ${res.status} ${type}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
