import type { AIProvider, ContestPostInput, ContestPostOutput } from './provider.js';
import { buildPostPrompt } from './provider.js';

/** Extracts the first JSON object from a model reply (some models wrap it in prose or ```json fences). */
export function parseJsonReply(text: string): ContestPostOutput {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('модель не вернула JSON');
  const out = JSON.parse(text.slice(start, end + 1)) as Partial<ContestPostOutput>;
  const post = out.post ?? [out.headline, out.text, out.cta].filter(Boolean).join('\n\n');
  if (!post) throw new Error('в ответе модели нет текста поста');
  return {
    headline: out.headline ?? '',
    text: out.text ?? post,
    cta: out.cta ?? '',
    description: out.description ?? '',
    short: out.short ?? out.headline ?? '',
    post,
  };
}

/**
 * Any OpenAI-compatible chat API (Groq, OpenRouter, Mistral, Cerebras…). Text only.
 * `model` may be resolved lazily, e.g. to pick a currently free OpenRouter model.
 */
export class OpenAICompatProvider implements AIProvider {
  imageModel = '';
  private resolved: string | null = null;

  constructor(
    public id: string,
    private baseUrl: string,
    private apiKey: string,
    public textModel: string,
    private resolveModel?: () => Promise<string>,
    private extraHeaders: Record<string, string> = {},
  ) {}

  private async model() {
    if (this.textModel) return this.textModel;
    this.resolved ??= await this.resolveModel!();
    this.textModel = this.resolved;
    return this.resolved;
  }

  async generatePost(input: ContestPostInput): Promise<ContestPostOutput> {
    const model = await this.model();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}`, ...this.extraHeaders },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        messages: [
          { role: 'system', content: 'Ты отвечаешь только валидным JSON-объектом без пояснений.' },
          { role: 'user', content: buildPostPrompt(input) },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string };
    if (!res.ok) {
      const msg = typeof json.error === 'string' ? json.error : json.error?.message;
      throw new Error(`${this.id}: ${res.status} ${msg ?? res.statusText}`);
    }
    return parseJsonReply(json.choices?.[0]?.message?.content ?? '');
  }

  async generateImage(): Promise<Buffer> {
    throw new Error(`${this.id} не генерирует изображения`);
  }
}

/** Picks a free OpenRouter model, preferring larger general-purpose ones. */
export async function pickFreeOpenRouterModel(): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) });
  const json = (await res.json()) as { data?: { id: string }[] };
  const free = (json.data ?? []).map((m) => m.id).filter((id) => id.endsWith(':free'));
  const prefer = [/llama-3\.3-70b/, /deepseek-chat/, /qwen.*(72b|235b)/, /gemini/, /mistral/, /llama/];
  for (const re of prefer) {
    const hit = free.find((id) => re.test(id));
    if (hit) return hit;
  }
  if (!free[0]) throw new Error('openrouter: нет доступных бесплатных моделей');
  return free[0];
}
