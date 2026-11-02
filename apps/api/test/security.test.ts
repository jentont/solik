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
