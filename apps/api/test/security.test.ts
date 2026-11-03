import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateLoginWidget, validateWebAppInitData } from '../src/telegram/initData.js';
import { decrypt, encrypt } from '../src/lib/crypto.js';
import { sniff } from '../src/modules/media/service.js';

const TOKEN = '123456:TEST';

function signInitData(fields: Record<string, string>, token = TOKEN) {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

describe('Telegram Web App initData', () => {
  const user = JSON.stringify({ id: 42, first_name: 'Ann', username: 'ann' });
  const now = String(Math.floor(Date.now() / 1000));

  it('accepts correctly signed data', () => {
    const u = validateWebAppInitData(signInitData({ auth_date: now, user, query_id: 'AA' }), TOKEN);
    expect(u.id).toBe(42);
    expect(u.username).toBe('ann');
  });
  it('rejects tampered data', () => {
    const data = signInitData({ auth_date: now, user }).replace('Ann', 'Bob');
    expect(() => validateWebAppInitData(data, TOKEN)).toThrow(/signature/);
  });
  it('rejects data signed by another bot', () => {
    expect(() => validateWebAppInitData(signInitData({ auth_date: now, user }, '999:OTHER'), TOKEN)).toThrow();
  });
  it('rejects expired data', () => {
    const old = String(Math.floor(Date.now() / 1000) - 3 * 86400);
    expect(() => validateWebAppInitData(signInitData({ auth_date: old, user }), TOKEN)).toThrow(/expired/);
  });
});

describe('Telegram Login Widget', () => {
  it('validates hash', () => {
    const data: Record<string, string | number> = { id: 7, first_name: 'X', auth_date: Math.floor(Date.now() / 1000) };
    const dcs = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n');
    const hash = createHmac('sha256', createHash('sha256').update(TOKEN).digest()).update(dcs).digest('hex');
    expect(validateLoginWidget({ ...data, hash }, TOKEN).id).toBe(7);
    expect(() => validateLoginWidget({ ...data, id: 8, hash }, TOKEN)).toThrow();
  });
});

describe('token encryption', () => {
  it('round-trips and uses a random IV', () => {
    const a = encrypt('123:secret');
    const b = encrypt('123:secret');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('123:secret');
  });
  it('detects tampering', () => {
    const enc = Buffer.from(encrypt('123:secret'), 'base64');
    enc[enc.length - 1]! ^= 1;
    expect(() => decrypt(enc.toString('base64'))).toThrow();
  });
});

describe('upload sniffing', () => {
  it('detects by magic bytes, not by name', () => {
    expect(sniff(Buffer.from('GIF89a......'))?.kind).toBe('ANIMATION');
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniff(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });
});

describe('Login Widget without auth_date', () => {
  it('is rejected even with a valid signature', () => {
    const rest: Record<string, string> = { id: '42', first_name: 'Ann' };
    const dcs = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join('\n');
    const secret = createHash('sha256').update(TOKEN).digest();
    const hash = createHmac('sha256', secret).update(dcs).digest('hex');
    expect(() => validateLoginWidget({ ...rest, hash }, TOKEN)).toThrow();
  });
});

describe('who pays for prizes', () => {
  it('the shared platform bot never buys Premium with platform Stars', async () => {
    const { fundDelivery } = await import('../src/modules/gifts/delivery.js');
    const r = await fundDelivery({ id: 'b', isPlatform: true }, 'u', { method: 'PREMIUM_GIFT' });
    expect(r.method).toBe('MANUAL');
  });
  it('an own bot pays from its own balance', async () => {
    const { fundDelivery } = await import('../src/modules/gifts/delivery.js');
    expect((await fundDelivery({ id: 'b', isPlatform: false }, 'u', { method: 'PREMIUM_GIFT' })).method).toBe('PREMIUM_GIFT');
    expect((await fundDelivery({ id: 'b', isPlatform: false }, 'u', { method: 'BOT_SEND_GIFT' })).method).toBe('BOT_SEND_GIFT');
  });
});

describe('anti-spam guard window', () => {
  it('counts wins after the last «continue» only within the window', async () => {
    const { guardSince } = await import('../src/modules/guard/service.js');
    const now = Date.parse('2026-11-03T12:00:00Z');
    expect(guardSince({ guardWindowMin: 10, resumedAt: null }, now).toISOString()).toBe('2026-11-03T11:50:00.000Z');
    expect(guardSince({ guardWindowMin: 10, resumedAt: '2026-11-03T11:55:00.000Z' }, now).toISOString()).toBe('2026-11-03T11:55:00.000Z');
  });
});
