import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Public URL where Telegram can reach the API (webhooks), e.g. https://api.solik.app
  PUBLIC_API_URL: z.string().url(),
  // URL of the Web App (Next.js), opened from the main bot
  WEB_APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),

  MAIN_BOT_TOKEN: z.string().min(10),
  MAIN_BOT_WEBHOOK_SECRET: z.string().default(''),
  // Comma-separated Telegram user ids that get the OWNER role on login
  PLATFORM_OWNER_IDS: z.string().default(''),
  // Premium emoji pack for the main menu buttons (t.me/addemoji/<name>)
  MENU_EMOJI_PACK: z.string().default('solutions_winter_by_solutions_chatbot'),

  JWT_SECRET: z.string().min(32),
  // 32-byte hex key for AES-256-GCM encryption of bot tokens
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex chars'),
  SESSION_TTL_HOURS: z.coerce.number().default(72),
  ALLOW_DEV_LOGIN: bool,

  // auto: every configured provider in order Gemini → Groq → OpenRouter, falling through on errors/limits
  AI_PROVIDER: z.enum(['auto', 'gemini', 'groq', 'openrouter', 'pollinations', 'none']).default('auto'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_TEXT_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-2.5-flash-image'),
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  OPENROUTER_API_KEY: z.string().default(''),
  // empty = pick a free model (":free") automatically
  OPENROUTER_MODEL: z.string().default(''),
  // free images without a key (lower quality); off by default, the token removes the service watermark
  POLLINATIONS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  POLLINATIONS_TOKEN: z.string().default(''),
  POLLINATIONS_MODEL: z.string().default('flux'),

  UPLOAD_DIR: z.string().default('./uploads'),
  BRAND_LOGO_PATH: z.string().default('./assets/logo.png'),
  MAX_UPLOAD_MB: z.coerce.number().default(20),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = load();

export const platformOwnerIds = new Set(
  env.PLATFORM_OWNER_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

export const isProd = env.NODE_ENV === 'production';
