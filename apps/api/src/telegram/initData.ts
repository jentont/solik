import { createHash, createHmac } from 'node:crypto';
import { safeEqual } from '../lib/crypto.js';

export interface WebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

/**
 * Validates Telegram Web App initData.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateWebAppInitData(initData: string, botToken: string, maxAgeSec = 86400): WebAppUser {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('hash missing');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeEqual(expected, hash)) throw new Error('invalid signature');

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) throw new Error('initData expired');

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('user missing');
  return JSON.parse(userRaw) as WebAppUser;
}

/**
 * Validates data from the Telegram Login Widget (standalone web version).
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function validateLoginWidget(data: Record<string, string | number>, botToken: string, maxAgeSec = 86400): WebAppUser {
  const { hash, ...rest } = data;
  if (!hash) throw new Error('hash missing');
  const dataCheckString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeEqual(expected, String(hash))) throw new Error('invalid signature');
  const authDate = Number(rest.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) throw new Error('auth expired');
  return {
    id: Number(rest.id),
    first_name: String(rest.first_name ?? ''),
    last_name: rest.last_name ? String(rest.last_name) : undefined,
    username: rest.username ? String(rest.username) : undefined,
    photo_url: rest.photo_url ? String(rest.photo_url) : undefined,
  };
}
