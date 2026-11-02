// Minimal subset of Telegram Bot API types used by SOLIK.
// https://core.telegram.org/bots/api

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  custom_emoji_id?: string;
}

export interface TgMessageOrigin {
  type: 'user' | 'hidden_user' | 'chat' | 'channel';
  chat?: TgChat;
  message_id?: number;
}

export interface TgSuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id: string;
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
}

export interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  from?: TgUser;
  sender_chat?: TgChat;
  date: number;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  is_automatic_forward?: boolean;
  forward_origin?: TgMessageOrigin;
  reply_to_message?: TgMessage;
  successful_payment?: TgSuccessfulPayment;
  refunded_payment?: { telegram_payment_charge_id: string; total_amount: number; invoice_payload: string };
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
  migrate_to_chat_id?: number;
  animation?: { file_id: string };
  dice?: { emoji: string; value: number };
  // Stars paid by the sender for this message in chats with paid messages enabled
  paid_star_count?: number;
  photo?: { file_id: string }[];
  business_connection_id?: string;
  gift?: unknown;
  unique_gift?: unknown;
}

export interface TgChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  user: TgUser;
  can_post_messages?: boolean;
  can_delete_messages?: boolean;
  can_manage_chat?: boolean;
  can_restrict_members?: boolean;
  can_pin_messages?: boolean;
  can_invite_users?: boolean;
  can_send_messages?: boolean;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgPreCheckoutQuery {
  id: string;
  from: TgUser;
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface TgBusinessConnection {
  id: string;
  user: TgUser;
  user_chat_id: number;
  date: number;
  is_enabled: boolean;
  rights?: Record<string, boolean>;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  callback_query?: TgCallbackQuery;
  pre_checkout_query?: TgPreCheckoutQuery;
  my_chat_member?: TgChatMemberUpdated;
  chat_member?: TgChatMemberUpdated;
  business_connection?: TgBusinessConnection;
  business_message?: TgMessage;
}

export interface TgGift {
  id: string;
  sticker: { file_id: string; emoji?: string; custom_emoji_id?: string };
  star_count: number;
  upgrade_star_count?: number;
  total_count?: number;
  remaining_count?: number;
}

export interface TgInlineButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
}

export type TgInlineKeyboard = { inline_keyboard: TgInlineButton[][] };

export function updateType(u: TgUpdate): string {
  const keys = Object.keys(u).filter((k) => k !== 'update_id');
  return keys[0] ?? 'unknown';
}
