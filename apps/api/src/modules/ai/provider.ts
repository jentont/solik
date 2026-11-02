import { env } from '../../config/env.js';

export interface ContestPostInput {
  title: string;
  prize: string;
  conditions?: string;
  date?: string;
  winners?: number;
  channel?: string;
  extra?: string;
  tone?: 'hype' | 'friendly' | 'formal' | 'minimal';
}

export interface ContestPostOutput {
  headline: string;
  text: string;
  cta: string;
  description: string;
  short: string;
  post: string; // full Telegram post, HTML subset
}

export interface AIProvider {
  id: string;
  textModel: string;
  imageModel: string;
  generatePost(input: ContestPostInput): Promise<ContestPostOutput>;
  /** Returns a PNG/JPEG background (no text, no logo — those are composed by SOLIK). */
  generateImage(prompt: string): Promise<Buffer>;
}

/** Tries providers in order; moves on when one fails (rate limit, quota, outage, unsupported). */
export class FallbackProvider implements AIProvider {
  id: string;
  textModel: string;
  imageModel: string;
  constructor(private chain: AIProvider[]) {
    this.id = chain.map((p) => p.id).join('→');
    this.textModel = chain.map((p) => p.textModel || '?').join(', ');
    this.imageModel = chain.find((p) => p.imageModel)?.imageModel ?? '';
  }
  async generatePost(input: ContestPostInput) {
    return this.first((p) => p.generatePost(input), (p) => !!p.textModel || p.id === 'openrouter');
  }
  async generateImage(prompt: string) {
    return this.first((p) => p.generateImage(prompt), (p) => !!p.imageModel);
  }
  private async first<T>(fn: (p: AIProvider) => Promise<T>, filter: (p: AIProvider) => boolean = () => true): Promise<T> {
    const errors: string[] = [];
    for (const p of this.chain.filter(filter)) {
      try {
        return await fn(p);
      } catch (e) {
        errors.push(`${p.id}: ${(e as Error).message}`);
      }
    }
    throw new Error(errors.length ? errors.join(' | ') : 'нет провайдера для этой операции');
  }
}

/** Provider registry — configured via env, no caller changes needed. */
export async function getAIProvider(): Promise<AIProvider> {
  if (env.AI_PROVIDER === 'none') throw new Error('AI отключен (AI_PROVIDER=none)');
  const chain: AIProvider[] = [];
  const want = (id: string) => env.AI_PROVIDER === 'auto' || env.AI_PROVIDER === id;
  if (want('gemini') && env.GEMINI_API_KEY) {
    const { GeminiProvider } = await import('./gemini.js');
    chain.push(new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_TEXT_MODEL, env.GEMINI_IMAGE_MODEL));
  }
  const { OpenAICompatProvider, pickFreeOpenRouterModel } = await import('./openai.js');
  if (want('groq') && env.GROQ_API_KEY) {
    chain.push(new OpenAICompatProvider('groq', 'https://api.groq.com/openai/v1', env.GROQ_API_KEY, env.GROQ_MODEL));
  }
  if (want('openrouter') && env.OPENROUTER_API_KEY) {
    chain.push(
      new OpenAICompatProvider('openrouter', 'https://openrouter.ai/api/v1', env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL, pickFreeOpenRouterModel, {
        'HTTP-Referer': env.WEB_APP_URL,
        'X-Title': 'SOLIK',
      }),
    );
  }
  if ((want('pollinations') && env.POLLINATIONS_ENABLED) || env.AI_PROVIDER === 'pollinations') {
    const { PollinationsProvider } = await import('./pollinations.js');
    chain.push(new PollinationsProvider(env.POLLINATIONS_TOKEN, env.POLLINATIONS_MODEL));
  }
  if (!chain.length) throw new Error('Не задан ни один ключ AI (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY) — см. docs/AI_SETUP.md');
  return chain.length === 1 ? chain[0]! : new FallbackProvider(chain);
}

export function buildPostPrompt(i: ContestPostInput): string {
  return `Ты — копирайтер Telegram-каналов. Напиши конкурсную публикацию на русском языке.

Данные:
- Название конкурса: ${i.title}
- Приз: ${i.prize}
- Условия: ${i.conditions || 'не указаны'}
- Дата подведения итогов: ${i.date || 'не указана'}
- Количество победителей: ${i.winners ?? 1}
- Канал: ${i.channel || 'не указан'}
- Дополнительно: ${i.extra || '—'}
- Тон: ${i.tone ?? 'hype'}

Требования:
- Используй только HTML-теги Telegram: <b>, <i>, <u>, <s>, <tg-spoiler>, <blockquote>. Никакого Markdown.
- Пост не длиннее 900 символов, с уместными эмодзи, без выдуманных фактов, условий и ссылок.
- Не упоминай сервисы и боты, которых нет во входных данных.

Верни JSON с полями: headline (заголовок), text (основной текст), cta (призыв к участию), description (описание для анонса, 1–2 предложения), short (одна строка до 120 символов), post (полный готовый пост с форматированием).`;
}
