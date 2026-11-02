/**
 * SOLIK message markup = Telegram HTML subset + {variables}.
 *
 * - Template text authored by users is sanitized to tags Telegram accepts.
 * - Variable values are always HTML-escaped, so a username like `<b>x</b>` cannot inject markup.
 * - Premium emoji are `<tg-emoji emoji-id="...">⭐</tg-emoji>`; the inner char is the fallback.
 */

export const TEMPLATE_VARIABLES = [
  'username',
  'user_id',
  'first_name',
  'owner_username',
  'chat_name',
  'contest_name',
  'prize_name',
  'winner_username',
  'participants_count',
  'remaining_time',
  'gift_name',
  'stars_amount',
  'position',
  'channel_username',
  'remaining_slots',
  'target',
  'current_bid',
  'leader',
  'winners',
  'chance',
] as const;

export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string | number | null | undefined>>;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ALLOWED: Record<string, string[]> = {
  b: [],
  strong: [],
  i: [],
  em: [],
  u: [],
  ins: [],
  s: [],
  strike: [],
  del: [],
  code: [],
  pre: [],
  blockquote: ['expandable'],
  'tg-spoiler': [],
  a: ['href'],
  'tg-emoji': ['emoji-id'],
  span: ['class'], // only class="tg-spoiler"
};

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z-]+(?:\s*=\s*"[^"]*")?)*)\s*\/?>/g;
const ATTR_RE = /([a-zA-Z-]+)(?:\s*=\s*"([^"]*)")?/g;

function sanitizeAttrs(tag: string, raw: string): string | null {
  const allowed = ALLOWED[tag]!;
  const out: string[] = [];
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? '';
    if (!allowed.includes(name)) continue;
    if (name === 'href' && !/^(https?:\/\/|tg:\/\/)/i.test(value)) return null;
    if (name === 'emoji-id' && !/^\d{5,25}$/.test(value)) return null;
    if (tag === 'span' && value !== 'tg-spoiler') return null;
    out.push(value ? `${name}="${escapeHtml(value)}"` : name);
  }
  if (tag === 'a' && !out.some((a) => a.startsWith('href='))) return null;
  if (tag === 'tg-emoji' && !out.some((a) => a.startsWith('emoji-id='))) return null;
  return out.length ? ' ' + out.join(' ') : '';
}

/** Keep only Telegram-supported tags, escape everything else; auto-close dangling tags. */
export function sanitizeTelegramHtml(input: string): string {
  let out = '';
  let last = 0;
  const stack: string[] = [];
  for (const m of input.matchAll(TAG_RE)) {
    const idx = m.index!;
    out += escapeText(input.slice(last, idx));
    last = idx + m[0].length;
    const tag = m[1]!.toLowerCase();
    const closing = m[0].startsWith('</');
    if (!(tag in ALLOWED)) {
      out += escapeHtml(m[0]);
      continue;
    }
    if (closing) {
      const pos = stack.lastIndexOf(tag);
      if (pos === -1) continue;
      while (stack.length > pos) out += `</${stack.pop()}>`;
      continue;
    }
    const attrs = sanitizeAttrs(tag, m[2] ?? '');
    if (attrs === null) {
      out += escapeHtml(m[0]);
      continue;
    }
    stack.push(tag);
    out += `<${tag}${attrs}>`;
  }
  out += escapeText(input.slice(last));
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

// escape < > and bare & (keep existing valid entities)
function escapeText(s: string): string {
  return s
    .replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Substitute {variables} with escaped values. Unknown variables are left as-is. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const safe = sanitizeTelegramHtml(template);
  return safe.replace(/\{([a-z_]+)\}/g, (whole, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) return whole;
    const v = vars[name as keyof TemplateVars];
    return v === undefined || v === null ? '' : escapeHtml(String(v));
  });
}

/** Replace premium emoji with their fallback char — used when Telegram rejects custom emoji. */
export function stripCustomEmoji(html: string): string {
  return html.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/g, '$1');
}

export function mention(user: { id: number | bigint; username?: string | null; first_name?: string | null }): string {
  if (user.username) return `@${user.username}`;
  return user.first_name || `id${user.id}`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин ${sec ? `${sec} сек` : ''}`.trim();
  return `${sec} сек`;
}
