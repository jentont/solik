import type { TgChatMember, TgGift, TgInlineKeyboard, TgMessage, TgUser } from './types.js';

export class TelegramError extends Error {
  constructor(
    public method: string,
    public code: number,
    public description: string,
    public retryAfter?: number,
  ) {
    super(`Telegram ${method} failed (${code}): ${description}`);
  }
  get isBlocked() {
    return this.code === 403;
  }
  get isRateLimit() {
    return this.code === 429;
  }
  get isMissingPermission() {
    return /not enough rights|have no rights|CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED|need administrator rights/i.test(
      this.description,
    );
  }
  get isChatGone() {
    return /chat not found|bot was kicked|group chat was upgraded|bot is not a member/i.test(this.description);
  }
  get isMethodUnsupported() {
    return this.code === 404 || /method not found/i.test(this.description);
  }
  get isCustomEmojiRejected() {
    return /custom emoji|ENTITY|can't parse entities.*emoji/i.test(this.description);
  }
}

export interface SendOptions {
  reply_markup?: TgInlineKeyboard | Record<string, unknown>;
  reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean };
  message_thread_id?: number;
  disable_notification?: boolean;
  link_preview_options?: { is_disabled: boolean };
  business_connection_id?: string;
}

const API_BASE = process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org';

/** Thin, typed wrapper over the Bot API. One instance per bot token. */
export class TelegramApi {
  constructor(private token: string) {}

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify(params, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const res = await fetch(`${API_BASE}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({ ok: false, error_code: res.status, description: res.statusText }))) as {
      ok: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (!json.ok) {
      throw new TelegramError(method, json.error_code ?? res.status, json.description ?? 'unknown', json.parameters?.retry_after);
    }
    return json.result as T;
  }

  /** multipart upload (photos/animations from local storage) */
  async upload<T>(method: string, field: string, file: { data: Buffer; filename: string; mime: string }, params: Record<string, unknown>): Promise<T> {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    form.append(field, new Blob([new Uint8Array(file.data)], { type: file.mime }), file.filename);
    const res = await fetch(`${API_BASE}/bot${this.token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
    const json = (await res.json()) as { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    if (!json.ok) throw new TelegramError(method, json.error_code ?? res.status, json.description ?? 'unknown', json.parameters?.retry_after);
    return json.result as T;
  }

  getMe() {
    return this.call<TgUser & { can_read_all_group_messages?: boolean; can_join_groups?: boolean }>('getMe');
  }
  setWebhook(url: string, secret: string) {
    return this.call<boolean>('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: [
        'message',
        'edited_message',
        'channel_post',
        'callback_query',
        'pre_checkout_query',
        'my_chat_member',
        'chat_member',
        'business_connection',
        'business_message',
      ],
      drop_pending_updates: false,
      max_connections: 40,
    });
  }
  deleteWebhook() {
    return this.call<boolean>('deleteWebhook');
  }
  getWebhookInfo() {
    return this.call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>('getWebhookInfo');
  }
  sendMessage(chatId: number | bigint | string, text: string, opts: SendOptions = {}) {
    return this.call<TgMessage>('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...opts });
  }
  editMessageText(chatId: number | bigint, messageId: number, text: string, opts: SendOptions = {}) {
    return this.call<TgMessage | true>('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...opts });
  }
  sendPhoto(chatId: number | bigint, photo: string, caption: string, opts: SendOptions = {}) {
    return this.call<TgMessage>('sendPhoto', { chat_id: chatId, photo, caption, parse_mode: 'HTML', ...opts });
  }
  sendAnimation(chatId: number | bigint, animation: string, caption: string, opts: SendOptions = {}) {
    return this.call<TgMessage>('sendAnimation', { chat_id: chatId, animation, caption, parse_mode: 'HTML', ...opts });
  }
  sendVideo(chatId: number | bigint, video: string, caption: string, opts: SendOptions = {}) {
    return this.call<TgMessage>('sendVideo', { chat_id: chatId, video, caption, parse_mode: 'HTML', ...opts });
  }
  deleteMessage(chatId: number | bigint, messageId: number) {
    return this.call<boolean>('deleteMessage', { chat_id: chatId, message_id: messageId });
  }
  answerCallbackQuery(id: string, text?: string, showAlert = false) {
    return this.call<boolean>('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert });
  }
  getChat(chatId: number | bigint | string) {
    return this.call<{ id: number; type: string; title?: string; username?: string; linked_chat_id?: number }>('getChat', { chat_id: chatId });
  }
  getChatMember(chatId: number | bigint | string, userId: number | bigint) {
    return this.call<TgChatMember>('getChatMember', { chat_id: chatId, user_id: userId });
  }
  getChatMemberCount(chatId: number | bigint) {
    return this.call<number>('getChatMemberCount', { chat_id: chatId });
  }

  // ── Profile (white-label) ──
  setMyName(name: string) {
    return this.call<boolean>('setMyName', { name });
  }
  setMyDescription(description: string) {
    return this.call<boolean>('setMyDescription', { description });
  }
  setMyShortDescription(short_description: string) {
    return this.call<boolean>('setMyShortDescription', { short_description });
  }
  setMyCommands(commands: { command: string; description: string }[], scope?: Record<string, unknown>) {
    return this.call<boolean>('setMyCommands', { commands, scope });
  }
  setChatMenuButton(menu_button: Record<string, unknown>) {
    return this.call<boolean>('setChatMenuButton', { menu_button });
  }

  // ── Payments (Telegram Stars, currency XTR) ──
  createInvoiceLink(p: {
    title: string;
    description: string;
    payload: string;
    amount: number;
    label: string;
    subscription_period?: number;
  }) {
    return this.call<string>('createInvoiceLink', {
      title: p.title,
      description: p.description,
      payload: p.payload,
      currency: 'XTR',
      prices: [{ label: p.label, amount: p.amount }],
      ...(p.subscription_period ? { subscription_period: p.subscription_period } : {}),
    });
  }
  answerPreCheckoutQuery(id: string, ok: boolean, error_message?: string) {
    return this.call<boolean>('answerPreCheckoutQuery', { pre_checkout_query_id: id, ok, error_message });
  }
  refundStarPayment(userId: number | bigint, chargeId: string) {
    return this.call<boolean>('refundStarPayment', { user_id: userId, telegram_payment_charge_id: chargeId });
  }
  editUserStarSubscription(userId: number | bigint, chargeId: string, isCanceled: boolean) {
    return this.call<boolean>('editUserStarSubscription', {
      user_id: userId,
      telegram_payment_charge_id: chargeId,
      is_canceled: isCanceled,
    });
  }
  getMyStarBalance() {
    return this.call<{ amount: number; nanostar_amount?: number }>('getMyStarBalance');
  }

  // ── Gifts ──
  getAvailableGifts() {
    return this.call<{ gifts: TgGift[] }>('getAvailableGifts');
  }
  sendGift(userId: number | bigint, giftId: string, text?: string) {
    return this.call<boolean>('sendGift', { user_id: userId, gift_id: giftId, text, text_parse_mode: 'HTML' });
  }
  giftPremiumSubscription(userId: number | bigint, monthCount: number, starCount: number, text?: string) {
    return this.call<boolean>('giftPremiumSubscription', { user_id: userId, month_count: monthCount, star_count: starCount, text });
  }
  getBusinessConnection(id: string) {
    return this.call<{ id: string; is_enabled: boolean; rights?: Record<string, boolean>; user: TgUser; user_chat_id: number }>(
      'getBusinessConnection',
      { business_connection_id: id },
    );
  }
  getBusinessAccountGifts(connectionId: string) {
    return this.call<{ total_count: number; gifts: Array<Record<string, unknown>> }>('getBusinessAccountGifts', {
      business_connection_id: connectionId,
      limit: 100,
    });
  }
  transferGift(connectionId: string, ownedGiftId: string, newOwnerChatId: number | bigint, starCount?: number) {
    return this.call<boolean>('transferGift', {
      business_connection_id: connectionId,
      owned_gift_id: ownedGiftId,
      new_owner_chat_id: newOwnerChatId,
      star_count: starCount,
    });
  }

  getCustomEmojiStickers(ids: string[]) {
    return this.call<Array<{ custom_emoji_id: string; emoji?: string; file_id: string; thumbnail?: { file_id: string } }>>(
      'getCustomEmojiStickers',
      { custom_emoji_ids: ids },
    );
  }
  getFile(fileId: string) {
    return this.call<{ file_path?: string }>('getFile', { file_id: fileId });
  }
  fileUrl(filePath: string) {
    return `${API_BASE}/file/bot${this.token}/${filePath}`;
  }
}
