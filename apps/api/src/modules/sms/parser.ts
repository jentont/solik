import type { SmsMode } from '@prisma/client';

export type SmsCommand =
  | { action: 'start'; mode: SmsMode; target: number; everyN?: number }
  | { action: 'stop' | 'stats' | 'winner' | 'reset' | 'help' }
  | { action: 'invalid'; error: string };

export const MAX_SMS_TARGET = 100_000;

/**
 * `.sms 100`          — first 100 unique users
 * `.sms msg 100`      — first 100 messages
 * `.sms every 5 20`   — every 5th comment, 20 slots (default 10)
 * `.sms first`        — first comment
 * `.sms stop|stats|winner|reset|help`
 * Also accepts `/sms` and `/sms@botname`.
 */
export function parseSmsCommand(text: string | undefined): SmsCommand | null {
  if (!text) return null;
  const m = text.trim().match(/^[./]sms(?:@\w+)?(?:\s+(.*))?$/i);
  if (!m) return null;
  const args = (m[1] ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [a, b, c] = args;
  if (!a || a === 'help') return { action: 'help' };
  if (['stop', 'stats', 'winner', 'reset'].includes(a)) return { action: a as 'stop' };

  const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : NaN);
  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SMS_TARGET;

  if (/^\d+$/.test(a)) {
    const n = num(a);
    return inRange(n) ? { action: 'start', mode: 'FIRST_N_USERS', target: n } : { action: 'invalid', error: `Число должно быть от 1 до ${MAX_SMS_TARGET}` };
  }
  if (a === 'msg' || a === 'messages') {
    const n = num(b);
    return inRange(n) ? { action: 'start', mode: 'FIRST_N_MESSAGES', target: n } : { action: 'invalid', error: 'Укажите количество: .sms msg 100' };
  }
  if (a === 'every') {
    const every = num(b);
    const slots = c === undefined ? 10 : num(c);
    if (!inRange(every) || every < 2) return { action: 'invalid', error: 'Укажите шаг: .sms every 5' };
    if (!inRange(slots)) return { action: 'invalid', error: 'Количество мест: .sms every 5 20' };
    return { action: 'start', mode: 'EVERY_NTH', target: slots, everyN: every };
  }
  if (a === 'first') return { action: 'start', mode: 'FIRST_COMMENT', target: 1 };
  return { action: 'invalid', error: 'Неизвестная команда. Отправьте .sms help' };
}

export interface CounterState {
  mode: SmsMode;
  target: number;
  everyN: number | null;
  count: number;
  messagesSeen: number;
}

/** Pure registration rule. `alreadyRegistered` = this user already holds a slot. */
export function decideRegistration(s: CounterState, alreadyRegistered: boolean): { register: boolean; messagesSeen: number } {
  if (s.count >= s.target) return { register: false, messagesSeen: s.messagesSeen };
  const seen = s.messagesSeen + 1;
  switch (s.mode) {
    case 'FIRST_N_MESSAGES':
      return { register: true, messagesSeen: seen };
    case 'EVERY_NTH':
      return { register: seen % (s.everyN ?? 1) === 0 && !alreadyRegistered, messagesSeen: seen };
    case 'FIRST_COMMENT':
    case 'FIRST_N_USERS':
    default:
      return { register: !alreadyRegistered, messagesSeen: seen };
  }
}

export const SMS_HELP = `<b>SMS Counter — команды</b>

<code>.sms 100</code> — первые 100 уникальных участников
<code>.sms msg 100</code> — первые 100 сообщений
<code>.sms every 5 20</code> — каждый 5-й комментарий, 20 мест
<code>.sms first</code> — первый комментарий
<code>.sms stats</code> — статистика
<code>.sms winner</code> — определить победителя
<code>.sms stop</code> — остановить
<code>.sms reset</code> — сбросить (с подтверждением)

Команда в ветке комментариев поста — считает комментарии только этого поста. В основном чате — сообщения группы.
Команды доступны только администраторам.`;
