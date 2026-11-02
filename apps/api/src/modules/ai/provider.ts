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

/** Provider registry — swap via AI_PROVIDER without touching callers. */
export async function getAIProvider(): Promise<AIProvider> {
  if (env.AI_PROVIDER === 'gemini') {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY не задан — см. docs/AI_SETUP.md');
    const { GeminiProvider } = await import('./gemini.js');
    return new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_TEXT_MODEL, env.GEMINI_IMAGE_MODEL);
  }
  throw new Error('AI отключен (AI_PROVIDER=none)');
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
