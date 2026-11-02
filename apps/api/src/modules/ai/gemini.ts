import type { AIProvider, ContestPostInput, ContestPostOutput } from './provider.js';
import { buildPostPrompt } from './provider.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] } }[];
  error?: { message: string };
}

export class GeminiProvider implements AIProvider {
  id = 'gemini';
  constructor(
    private apiKey: string,
    public textModel: string,
    public imageModel: string,
  ) {}

  private async call(model: string, body: unknown): Promise<GeminiResponse> {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: 'POST',
      // key in header, never in URL/logs
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const json = (await res.json()) as GeminiResponse;
    if (!res.ok || json.error) throw new Error(`Gemini: ${json.error?.message ?? res.statusText}`);
    return json;
  }

  async generatePost(input: ContestPostInput): Promise<ContestPostOutput> {
    const json = await this.call(this.textModel, {
      contents: [{ role: 'user', parts: [{ text: buildPostPrompt(input) }] }],
      generationConfig: {
        temperature: 0.9,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            headline: { type: 'STRING' },
            text: { type: 'STRING' },
            cta: { type: 'STRING' },
            description: { type: 'STRING' },
            short: { type: 'STRING' },
            post: { type: 'STRING' },
          },
          required: ['headline', 'text', 'cta', 'description', 'short', 'post'],
        },
      },
    });
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return JSON.parse(text) as ContestPostOutput;
  }

  async generateImage(prompt: string): Promise<Buffer> {
    const json = await this.call(this.imageModel, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    });
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData) throw new Error('Gemini не вернул изображение');
    return Buffer.from(part.inlineData.data, 'base64');
  }
}
