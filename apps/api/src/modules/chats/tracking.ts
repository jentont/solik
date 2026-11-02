import type { ChatStatus, TelegramBot } from '@prisma/client';
import { audit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import type { TelegramApi } from '../../telegram/client.js';
import type { TgChatMember, TgChatMemberUpdated, TgMessage } from '../../telegram/types.js';
import { ensureUser } from './access.js';

/** Maps the bot's own membership to a connection status. */
export function statusFromMember(m: TgChatMember, isChannel: boolean): ChatStatus {
  switch (m.status) {
    case 'left':
    case 'kicked':
      return 'BOT_REMOVED';
    case 'restricted':
      return 'BOT_RESTRICTED';
    case 'administrator':
      if (isChannel && !m.can_post_messages) return 'PERMISSION_MISSING';
      return 'ACTIVE';
    case 'member':
      // a plain member in a channel can't post; in groups contests need admin for member checks
      return isChannel ? 'PERMISSION_MISSING' : 'PERMISSION_MISSING';
    default:
      return 'ACTIVE';
  }
}

function permissionsOf(m: TgChatMember) {
  return {
    status: m.status,
    can_post_messages: m.can_post_messages ?? false,
    can_delete_messages: m.can_delete_messages ?? false,
    can_manage_chat: m.can_manage_chat ?? false,
    can_pin_messages: m.can_pin_messages ?? false,
    can_restrict_members: m.can_restrict_members ?? false,
  };
}

/** my_chat_member: bot added / removed / promoted / restricted — keeps status in sync automatically. */
export async function handleMyChatMember(api: TelegramApi, bot: TelegramBot, u: TgChatMemberUpdated) {
  const chat = u.chat;
  if (chat.type === 'private') {
    // user blocked / unblocked the bot
    await prisma.botUser.updateMany({
      where: { botId: bot.id, tgUserId: BigInt(chat.id) },
      data: { isBlocked: u.new_chat_member.status === 'kicked' },
    });
    return;
  }
  const isChannel = chat.type === 'channel';
  const status = statusFromMember(u.new_chat_member, isChannel);
  const permissions = permissionsOf(u.new_chat_member);
  const isAdmin = u.new_chat_member.status === 'administrator';
  // Who added the bot owns the connection for the platform bot; white-label → bot owner.
  const ownerId = bot.ownerId ?? (status !== 'BOT_REMOVED' ? (await ensureUser(u.from)).id : undefined);
  const memberCount = status === 'BOT_REMOVED' ? undefined : await api.getChatMemberCount(chat.id).catch(() => undefined);
  const now = new Date();

  if (isChannel) {
    const full = await api.getChat(chat.id).catch(() => null);
    const channel = await prisma.telegramChannel.upsert({
      where: { botId_chatId: { botId: bot.id, chatId: BigInt(chat.id) } },
      create: {
        botId: bot.id,
        ownerId,
        chatId: BigInt(chat.id),
        title: chat.title ?? 'Канал',
        username: chat.username,
        status,
        isAdmin,
        canPost: !!u.new_chat_member.can_post_messages,
        permissions,
        memberCount,
        lastActivityAt: now,
      },
      update: { title: chat.title ?? undefined, username: chat.username, status, isAdmin, canPost: !!u.new_chat_member.can_post_messages, permissions, memberCount },
    });
    if (full?.linked_chat_id) {
      const disc = await prisma.telegramChat.findUnique({ where: { botId_chatId: { botId: bot.id, chatId: BigInt(full.linked_chat_id) } } });
      if (disc) {
        await prisma.telegramChannel.update({ where: { id: channel.id }, data: { discussionChatId: disc.id } });
        await prisma.telegramChat.update({ where: { id: disc.id }, data: { linkedChannelChatId: BigInt(chat.id) } });
      }
    }
  } else {
    const full = await api.getChat(chat.id).catch(() => null);
    const chatRow = await prisma.telegramChat.upsert({
      where: { botId_chatId: { botId: bot.id, chatId: BigInt(chat.id) } },
      create: {
        botId: bot.id,
        ownerId,
        chatId: BigInt(chat.id),
        kind: chat.type === 'group' ? 'GROUP' : 'SUPERGROUP',
        title: chat.title ?? 'Чат',
        username: chat.username,
        status,
        isAdmin,
        permissions,
        memberCount,
        linkedChannelChatId: full?.linked_chat_id ? BigInt(full.linked_chat_id) : null,
        lastActivityAt: now,
      },
      update: {
        title: chat.title ?? undefined,
        username: chat.username,
        status,
        isAdmin,
        permissions,
        memberCount,
        kind: chat.type === 'group' ? 'GROUP' : 'SUPERGROUP',
        ...(full?.linked_chat_id ? { linkedChannelChatId: BigInt(full.linked_chat_id) } : {}),
      },
    });
    if (full?.linked_chat_id) {
      await prisma.telegramChannel.updateMany({
        where: { botId: bot.id, chatId: BigInt(full.linked_chat_id) },
        data: { discussionChatId: chatRow.id },
      });
    }
  }
  await audit(status === 'BOT_REMOVED' ? 'chat.bot_removed' : 'chat.bot_membership', {
    entity: isChannel ? 'TelegramChannel' : 'TelegramChat',
    meta: { botId: bot.id, chatId: chat.id, status, by: u.from.id },
    level: status === 'ACTIVE' ? 'info' : 'warn',
  });
}

/** Group migrated to supergroup: chat id changes. */
export async function handleMigration(bot: TelegramBot, msg: TgMessage) {
  if (!msg.migrate_to_chat_id) return;
  await prisma.telegramChat.updateMany({
    where: { botId: bot.id, chatId: BigInt(msg.chat.id) },
    data: { chatId: BigInt(msg.migrate_to_chat_id), kind: 'SUPERGROUP' },
  });
}

/** Counts processed messages and last activity for monitoring (cheap, one UPDATE). */
export async function touchChat(bot: TelegramBot, msg: TgMessage) {
  const res = await prisma.telegramChat.updateMany({
    where: { botId: bot.id, chatId: BigInt(msg.chat.id) },
    data: { messagesProcessed: { increment: 1 }, lastActivityAt: new Date() },
  });
  if (res.count === 0 && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
    // Bot was already in the chat before SOLIK tracked it: register as connected
    await prisma.telegramChat
      .create({
        data: {
          botId: bot.id,
          ownerId: bot.ownerId,
          chatId: BigInt(msg.chat.id),
          kind: msg.chat.type === 'group' ? 'GROUP' : 'SUPERGROUP',
          title: msg.chat.title ?? 'Чат',
          username: msg.chat.username,
          status: 'ACTIVE',
          messagesProcessed: 1,
          lastActivityAt: new Date(),
        },
      })
      .catch(() => undefined);
  }
}

/** channel_post: store post (for First Comment selection) and update activity. */
export async function handleChannelPost(bot: TelegramBot, msg: TgMessage) {
  const channel = await prisma.telegramChannel.findUnique({ where: { botId_chatId: { botId: bot.id, chatId: BigInt(msg.chat.id) } } });
  if (!channel) return;
  await prisma.channelPost.upsert({
    where: { channelId_messageId: { channelId: channel.id, messageId: msg.message_id } },
    create: { channelId: channel.id, messageId: msg.message_id, text: (msg.text ?? msg.caption ?? '').slice(0, 500), postedAt: new Date(msg.date * 1000) },
    update: { text: (msg.text ?? msg.caption ?? '').slice(0, 500) },
  });
  await prisma.telegramChannel.update({ where: { id: channel.id }, data: { postsProcessed: { increment: 1 }, lastActivityAt: new Date() } });
}

/**
 * Automatic forward of a channel post into its discussion group: links the post to its
 * comments thread. Contests bound to that post get their threadMessageId here.
 */
export async function handleAutomaticForward(bot: TelegramBot, msg: TgMessage) {
  const origin = msg.forward_origin;
  if (!msg.is_automatic_forward || origin?.type !== 'channel' || !origin.chat || !origin.message_id) return;
  const channel = await prisma.telegramChannel.findUnique({ where: { botId_chatId: { botId: bot.id, chatId: BigInt(origin.chat.id) } } });
  if (!channel) return;
  const chat = await prisma.telegramChat.findUnique({ where: { botId_chatId: { botId: bot.id, chatId: BigInt(msg.chat.id) } } });
  if (chat && channel.discussionChatId !== chat.id) {
    await prisma.telegramChannel.update({ where: { id: channel.id }, data: { discussionChatId: chat.id } });
    await prisma.telegramChat.update({ where: { id: chat.id }, data: { linkedChannelChatId: BigInt(origin.chat.id) } });
  }
  await prisma.channelPost.upsert({
    where: { channelId_messageId: { channelId: channel.id, messageId: origin.message_id } },
    create: { channelId: channel.id, messageId: origin.message_id, discussionMessageId: msg.message_id, text: (msg.text ?? msg.caption ?? '').slice(0, 500), postedAt: new Date(msg.date * 1000) },
    update: { discussionMessageId: msg.message_id },
  });
  await prisma.contest.updateMany({
    where: { channelId: channel.id, publishedMessageId: origin.message_id, threadMessageId: null },
    data: { threadMessageId: msg.message_id },
  });
}
