import { describe, expect, it } from 'vitest';
import { decideRegistration, parseSmsCommand } from '../src/modules/sms/parser.js';
import { selectWinners, type Candidate } from '../src/modules/winners/select.js';
import { pickWeighted, prizeSlots, prizeStars } from '../src/modules/winners/engine.js';
import { winFrom } from '../src/modules/contests/lifecycle.js';
import { dropCustomEmoji } from '../src/telegram/emojiPack.js';
import { minNextBid, validateBid } from '../src/modules/auction/service.js';
import { messageChance, perUserSince, rollChance, spamReason, startOfDay } from '../src/modules/activity/service.js';
import { isJackpot, SLOT_JACKPOT } from '../src/modules/dice/service.js';
import { isSubscriptionUsable, nextPeriod } from '../src/modules/subscriptions/service.js';
import { chooseMethod } from '../src/modules/gifts/delivery.js';
import { statusFromMember } from '../src/modules/chats/tracking.js';
import { sha256 } from '../src/lib/crypto.js';

describe('SMS command parser', () => {
  it('parses start variants', () => {
    expect(parseSmsCommand('.sms 100')).toEqual({ action: 'start', mode: 'FIRST_N_USERS', target: 100 });
    expect(parseSmsCommand('/sms@solik_bot 10')).toMatchObject({ mode: 'FIRST_N_USERS', target: 10 });
    expect(parseSmsCommand('.sms msg 50')).toMatchObject({ mode: 'FIRST_N_MESSAGES', target: 50 });
    expect(parseSmsCommand('.sms every 5 20')).toMatchObject({ mode: 'EVERY_NTH', everyN: 5, target: 20 });
    expect(parseSmsCommand('.sms first')).toMatchObject({ mode: 'FIRST_COMMENT', target: 1 });
  });
  it('parses control commands', () => {
    for (const a of ['stop', 'stats', 'winner', 'reset', 'help']) expect(parseSmsCommand(`.sms ${a}`)).toEqual({ action: a });
    expect(parseSmsCommand('.sms')).toEqual({ action: 'help' });
  });
  it('rejects bad input and ignores other text', () => {
    expect(parseSmsCommand('.sms 0')?.action).toBe('invalid');
    expect(parseSmsCommand('.sms 99999999')?.action).toBe('invalid');
    expect(parseSmsCommand('.sms banana')?.action).toBe('invalid');
    expect(parseSmsCommand('hello .sms 100')).toBeNull();
    expect(parseSmsCommand('.smsx 100')).toBeNull();
  });
});

describe('SMS registration rules', () => {
  const base = { target: 3, everyN: null, count: 0, messagesSeen: 0 };
  it('unique users: repeat participants are ignored', () => {
    expect(decideRegistration({ ...base, mode: 'FIRST_N_USERS' }, false).register).toBe(true);
    expect(decideRegistration({ ...base, mode: 'FIRST_N_USERS' }, true).register).toBe(false);
  });
  it('messages mode counts every message', () => {
    expect(decideRegistration({ ...base, mode: 'FIRST_N_MESSAGES' }, true).register).toBe(true);
  });
  it('every N-th', () => {
    const s = { ...base, mode: 'EVERY_NTH' as const, everyN: 5 };
    expect(decideRegistration({ ...s, messagesSeen: 3 }, false).register).toBe(false);
    expect(decideRegistration({ ...s, messagesSeen: 4 }, false)).toEqual({ register: true, messagesSeen: 5 });
  });
  it('stops when full', () => {
    expect(decideRegistration({ ...base, mode: 'FIRST_N_MESSAGES', count: 3 }, false).register).toBe(false);
  });
});

const cand = (id: number, score = 1, position?: number): Candidate => ({ tgUserId: BigInt(id), score, position, username: `u${id}` });

describe('winner selection', () => {
  it('random: unique winners, never more than candidates', () => {
    const pool = [1, 2, 3, 4, 5].map((i) => cand(i));
    const w = selectWinners('RANDOM', [...pool, cand(1)], 10);
    expect(w).toHaveLength(5);
    expect(new Set(w.map((x) => String(x.tgUserId))).size).toBe(5);
  });
  it('excludes rerolled winners', () => {
    const w = selectWinners('RANDOM', [cand(1), cand(2)], 2, { excludeTgIds: [1n] });
    expect(w.map((x) => x.tgUserId)).toEqual([2n]);
  });
  it('first comment takes the earliest position', () => {
    expect(selectWinners('FIRST_COMMENT', [cand(3, 1, 2), cand(9, 1, 1)], 1)[0]!.tgUserId).toBe(9n);
  });
  it('SMS prize queue binds prizes to positions', () => {
    const pool = Array.from({ length: 12 }, (_, i) => cand(100 + i, 1, i + 1));
    expect(selectWinners('SMS_COUNTER', pool, 3, { prizePositions: [1, 5, 10] }).map((c) => c.position)).toEqual([1, 5, 10]);
  });
  it('activity: most active wins, threshold respected', () => {
    const pool = [cand(1, 5), cand(2, 50), cand(3, 20)];
    expect(selectWinners('ACTIVITY', pool, 1, { activityMode: 'most_active' })[0]!.tgUserId).toBe(2n);
    const t = selectWinners('ACTIVITY', pool, 3, { activityMode: 'threshold', minMessages: 10 });
    expect(t.map((x) => x.tgUserId).sort()).toEqual([2n, 3n]);
  });
  it('random selection is roughly uniform', () => {
    const counts = new Map<string, number>();
    const pool = [1, 2, 3, 4].map((i) => cand(i));
    for (let i = 0; i < 4000; i++) {
      const k = String(selectWinners('RANDOM', pool, 1)[0]!.tgUserId);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (const v of counts.values()) expect(v).toBeGreaterThan(800);
  });
  it('prize slots expand quantities', () => {
    const slots = prizeSlots([{ id: 'a', place: 1, quantity: 1 }, { id: 'b', place: 2, quantity: 2 }] as any, 3);
    expect(slots.map((s) => s!.id)).toEqual(['a', 'b', 'b']);
  });
});

describe('«Перебивка» (Stars auction)', () => {
  const c = { status: 'ACTIVE' as const, endsAt: new Date(Date.now() + 60_000), currentBid: null as number | null, leaderTgId: null as bigint | null, config: { startBid: 10, minStep: 1 } };
  it('first bid must be at least the start bid', () => {
    expect(minNextBid(c)).toBe(10);
    expect(validateBid(c, 9, 1n).ok).toBe(false);
    expect(validateBid(c, 10, 1n).ok).toBe(true);
  });
  it('next bid = current + step; leader cannot outbid self', () => {
    const c2 = { ...c, currentBid: 25, leaderTgId: 1n };
    expect(minNextBid(c2)).toBe(26);
    expect(validateBid(c2, 25, 2n).ok).toBe(false);
    expect(validateBid(c2, 30, 1n).ok).toBe(false);
    expect(validateBid(c2, 26, 2n).ok).toBe(true);
  });
  it('no bids after the end', () => {
    expect(validateBid({ ...c, endsAt: new Date(Date.now() - 1) }, 100, 1n)).toEqual({ ok: false, reason: 'Перебивка уже завершена' });
    expect(validateBid({ ...c, status: 'FINISHED' as any }, 100, 1n).ok).toBe(false);
  });
});

describe('activity anti-spam and chance', () => {
  const cfg = { minLength: 3, minIntervalSec: 3, ignoreDuplicates: true };
  it('filters short, fast and duplicate messages', () => {
    expect(spamReason(cfg, 'ok', null)).toBe('too_short');
    expect(spamReason(cfg, 'hello', { lastMessageAt: new Date(), lastTextHash: null })).toBe('rate_limited');
    expect(spamReason(cfg, 'Hello', { lastMessageAt: new Date(Date.now() - 10_000), lastTextHash: sha256('hello') })).toBe('duplicate');
    expect(spamReason(cfg, 'hello there', { lastMessageAt: new Date(Date.now() - 10_000), lastTextHash: sha256('hello') })).toBeNull();
  });
  it('chance roll follows the probability', () => {
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (rollChance(10)) hits++;
    expect(hits).toBeGreaterThan(1600);
    expect(hits).toBeLessThan(2400);
    expect(rollChance(100)).toBe(true);
  });
  it('weighted prize pick follows the weights', () => {
    const items = [{ n: 'bear', w: 70 }, { n: 'heart', w: 25 }, { n: 'rocket', w: 5 }, { n: 'none', w: 0 }];
    const hits: Record<string, number> = { bear: 0, heart: 0, rocket: 0, none: 0 };
    for (let i = 0; i < 20000; i++) hits[pickWeighted(items, (x) => x.w)!.n]!++;
    expect(hits.bear! / 20000).toBeGreaterThan(0.66);
    expect(hits.bear! / 20000).toBeLessThan(0.74);
    expect(hits.rocket! / 20000).toBeLessThan(0.07);
    expect(hits.none).toBe(0);
    expect(pickWeighted([{ w: 0 }], (x) => x.w)).toBeNull();
  });
  it('paid messages raise the chance in proportion to the price', () => {
    const cfg = { chancePercent: 2, starsBoost: true, minPaidStars: 10 };
    expect(messageChance(cfg, 10)).toBe(2);
    expect(messageChance(cfg, 50)).toBe(10);
    expect(messageChance(cfg, 100000)).toBe(100);
    expect(messageChance({ ...cfg, starsBoost: false }, 50)).toBe(2);
  });
  it('per-user limit window', () => {
    const now = new Date('2026-11-02T22:30:00Z');
    expect(perUserSince({ perUserWindow: 'hour', tzOffsetMinutes: 180 }, now)!.toISOString()).toBe('2026-11-02T21:30:00.000Z');
    expect(perUserSince({ perUserWindow: 'contest', tzOffsetMinutes: 180 }, now)).toBeNull();
  });
  it('rejected premium emoji are dropped, not replaced with plain ones', () => {
    expect(dropCustomEmoji('<tg-emoji emoji-id="123456">🔥</tg-emoji> <b>Перебито!</b>')).toBe('<b>Перебито!</b>');
  });
  it('prize cost in Stars for the budget', () => {
    expect(prizeStars({ kind: 'GIFT', gift: { starCost: 50 } } as any)).toBe(50);
    expect(prizeStars({ kind: 'STARS', starsAmount: 100 } as any)).toBe(100);
    expect(prizeStars(null)).toBe(0);
  });
  it('congratulation «from» uses the picked admin', () => {
    expect(winFrom({ config: { winFrom: 'nudick' } } as any)).toBe('@nudick');
    expect(winFrom({ config: { winFrom: '@nudick' } } as any)).toBe('@nudick');
    expect(winFrom({ config: { winFrom: 'bad name!' } } as any)).toBeNull();
    expect(winFrom({ config: {} } as any)).toBeNull();
  });
  it('day boundary honours the timezone (MSK)', () => {
    const d = startOfDay(new Date('2026-11-02T22:30:00Z'), 180); // 01:30 MSK on Nov 3
    expect(d.toISOString()).toBe('2026-11-02T21:00:00.000Z');
  });
});

describe('конкурс 777', () => {
  const cfg = { emoji: '🎰', winValue: SLOT_JACKPOT };
  it('only a fresh 🎰 with value 64 wins', () => {
    expect(isJackpot({ dice: { emoji: '🎰', value: 64 } }, cfg)).toBe(true);
    expect(isJackpot({ dice: { emoji: '🎰', value: 43 } }, cfg)).toBe(false);
    expect(isJackpot({ dice: { emoji: '🎲', value: 64 } }, cfg)).toBe(false);
    expect(isJackpot({ dice: { emoji: '🎰', value: 64 }, forward_origin: { type: 'user' } }, cfg)).toBe(false);
  });
});

describe('white-label subscription periods', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  it('early renewal extends from the current end', () => {
    expect(nextPeriod(new Date('2026-11-10T00:00:00Z'), 30, now).end.toISOString()).toBe('2026-12-10T00:00:00.000Z');
  });
  it('lapsed subscription restarts from now', () => {
    expect(nextPeriod(new Date('2026-10-01T00:00:00Z'), 30, now).start).toEqual(now);
  });
  it('usability by status', () => {
    const future = new Date(Date.now() + 1000);
    const past = new Date(Date.now() - 1000);
    expect(isSubscriptionUsable({ status: 'ACTIVE', periodEnd: future, graceUntil: null })).toBe(true);
    expect(isSubscriptionUsable({ status: 'CANCELLED', periodEnd: future, graceUntil: null })).toBe(true);
    expect(isSubscriptionUsable({ status: 'GRACE', periodEnd: past, graceUntil: future })).toBe(true);
    expect(isSubscriptionUsable({ status: 'EXPIRED', periodEnd: past, graceUntil: past })).toBe(false);
  });
});

describe('gift delivery method (no fake automation)', () => {
  const gift = (o: object) => ({ kind: 'GIFT', businessOwnedGiftId: null, gift: { type: 'REGULAR', availability: 'AVAILABLE', transferable: true, ...o } }) as any;
  it('verified regular gift → sendGift', () => expect(chooseMethod(gift({})).method).toBe('BOT_SEND_GIFT'));
  it('unverified id → manual', () => expect(chooseMethod(gift({ transferable: false })).method).toBe('MANUAL'));
  it('collectible → manual unless owned by a business account', () => {
    expect(chooseMethod(gift({ type: 'COLLECTIBLE' })).method).toBe('MANUAL');
    expect(chooseMethod({ ...gift({ type: 'COLLECTIBLE' }), businessOwnedGiftId: 'x' }).method).toBe('BUSINESS_TRANSFER');
  });
  it('removed gift → manual', () => expect(chooseMethod(gift({ availability: 'REMOVED' })).method).toBe('MANUAL'));
  it('stars → manual with an explanation', () => {
    const r = chooseMethod({ kind: 'STARS', gift: null } as any);
    expect(r.method).toBe('MANUAL');
    expect(r.note).toMatch(/Stars/);
  });
});

describe('chat status from bot membership', () => {
  const m = (status: any, extra = {}) => ({ status, user: { id: 1, is_bot: true, first_name: 'b' }, ...extra });
  it('maps Telegram updates to statuses', () => {
    expect(statusFromMember(m('kicked'), false)).toBe('BOT_REMOVED');
    expect(statusFromMember(m('left'), true)).toBe('BOT_REMOVED');
    expect(statusFromMember(m('restricted'), false)).toBe('BOT_RESTRICTED');
    expect(statusFromMember(m('administrator'), false)).toBe('ACTIVE');
    expect(statusFromMember(m('administrator', { can_post_messages: false }), true)).toBe('PERMISSION_MISSING');
    expect(statusFromMember(m('member'), false)).toBe('PERMISSION_MISSING');
  });
});

describe('quick giveaway command', () => {
  it('parses time, winners and prize', async () => {
    const { parseQuickCommand } = await import('../src/modules/quick/service.js');
    expect(parseQuickCommand('.розыгрыш 10м 2 Новогодний мишка')).toEqual({ durationSec: 600, winners: 2, prize: 'Новогодний мишка' });
    expect(parseQuickCommand('/fast@solikgiftbot 30s Rose')).toEqual({ durationSec: 30, winners: 1, prize: 'Rose' });
    expect(parseQuickCommand('.розыгрыш 1д Кольцо')).toMatchObject({ durationSec: 86400, winners: 1 });
    expect(parseQuickCommand('.розыгрыш')).toBe('help');
    expect(parseQuickCommand('.розыгрыш 5с 999 Мишка')).toMatchObject({ durationSec: 30, winners: 100 }); // clamped
    expect(parseQuickCommand('привет .розыгрыш')).toBeNull();
  });
});
