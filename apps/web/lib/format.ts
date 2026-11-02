export const CONTEST_TYPES: Record<string, { label: string; hint: string }> = {
  RANDOM: { label: 'Случайный розыгрыш', hint: 'Кнопка «Участвовать», победители выбираются случайно' },
  STARS_AUCTION: { label: 'Перебивка', hint: 'Платное сообщение в чате перебивает прошлое. Чьё последнее к концу таймера — тот выиграл' },
  FIRST_COMMENT: { label: 'Первый комментарий', hint: 'Побеждает первый комментарий под выбранным постом' },
  SMS_COUNTER: { label: 'SMS Counter', hint: 'Первые N участников в чате или комментариях' },
  MESSAGE_GIVEAWAY: { label: 'Подарки за сообщения', hint: 'Каждые N сообщений или шанс на каждое сообщение' },
  ACTIVITY: { label: 'Конкурс активности', hint: 'Таблица лидеров за период' },
  GIFTS: { label: 'Telegram Gifts', hint: 'Розыгрыш подарков среди участников' },
  NFT: { label: 'NFT Giveaway', hint: 'Розыгрыш NFT / коллекционных подарков' },
  DICE_777: { label: 'Конкурс 777', hint: 'Кто выбьет 777 в слот-машине — тот выиграл' },
};

export const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'accent' }> = {
  DRAFT: { label: 'Черновик', tone: 'muted' },
  SCHEDULED: { label: 'Запланирован', tone: 'accent' },
  ACTIVE: { label: 'Активен', tone: 'ok' },
  DRAWING: { label: 'Розыгрыш', tone: 'warn' },
  FINISHED: { label: 'Завершён', tone: 'muted' },
  CANCELLED: { label: 'Отменён', tone: 'bad' },
  ARCHIVED: { label: 'Архив', tone: 'muted' },
  // bots
  DISABLED: { label: 'Отключен', tone: 'muted' },
  SUSPENDED: { label: 'Приостановлен', tone: 'bad' },
  SUBSCRIPTION_EXPIRED: { label: 'Подписка истекла', tone: 'warn' },
  INVALID_TOKEN: { label: 'Неверный токен', tone: 'bad' },
  // chats
  INACTIVE: { label: 'Неактивен', tone: 'muted' },
  BOT_REMOVED: { label: 'Бот удалён', tone: 'bad' },
  BOT_RESTRICTED: { label: 'Бот ограничен', tone: 'warn' },
  PERMISSION_MISSING: { label: 'Нет прав', tone: 'warn' },
  DISCONNECTED: { label: 'Отключен', tone: 'muted' },
  // deliveries
  PENDING: { label: 'Ожидает', tone: 'muted' },
  PROCESSING: { label: 'Выполняется', tone: 'accent' },
  DELIVERED: { label: 'Выдан', tone: 'ok' },
  FAILED: { label: 'Ошибка', tone: 'bad' },
  MANUAL_REQUIRED: { label: 'Ручная выдача', tone: 'warn' },
  // subscriptions
  GRACE: { label: 'Льготный период', tone: 'warn' },
  EXPIRED: { label: 'Истекла', tone: 'bad' },
  // sms
  FILLED: { label: 'Набор завершён', tone: 'warn' },
  STOPPED: { label: 'Остановлен', tone: 'muted' },
  // broadcasts
  QUEUED: { label: 'В очереди', tone: 'accent' },
  RUNNING: { label: 'Отправляется', tone: 'accent' },
  COMPLETED: { label: 'Завершена', tone: 'ok' },
  SENT: { label: 'Отправлено', tone: 'ok' },
  BLOCKED: { label: 'Заблокировал', tone: 'bad' },
  PERMISSION_LOST: { label: 'Нет прав', tone: 'warn' },
  SKIPPED: { label: 'Пропущено', tone: 'muted' },
  APPLIED: { label: 'Принята', tone: 'ok' },
  REFUNDED: { label: 'Возврат', tone: 'muted' },
};

export const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDay = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtNum = (n?: number | null) => (n ?? 0).toLocaleString('ru-RU');
export const userName = (u: { username?: string | null; firstName?: string | null; tgUserId?: string | number | bigint }) =>
  u.username ? `@${u.username}` : u.firstName || `id${u.tgUserId ?? ''}`;

export function timeLeft(to?: string | Date | null) {
  if (!to) return '';
  const ms = new Date(to).getTime() - Date.now();
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}
