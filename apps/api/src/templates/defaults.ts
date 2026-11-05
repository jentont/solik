import type { TemplateKey } from '@prisma/client';

// Neutral texts: white-label bots must not mention SOLIK unless the owner adds it.
export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  CONTEST_START: '[[e:🎁]] <b>{contest_name}</b>\n\nПриз: <b>{prize_name}</b>\nУчаствуйте!',
  PARTICIPANT_REGISTERED: '{username}, вы участвуете в конкурсе «{contest_name}». Ваш номер: #{position}',
  WINNER: '[[e:🎉]] Поздравляем, {username}!\nТы выиграл <b>{prize_name}</b>!\n\nСпасибо за участие!',
  LOSER: 'Конкурс «{contest_name}» завершён. В этот раз не повезло — ждём вас в следующем розыгрыше!',
  GIFT_RECEIVED: '[[e:🎁]] {username}, ваш приз <b>{gift_name}</b> отправлен!',
  CONTEST_FINISHED: '[[e:🏆]] <b>Конкурс «{contest_name}» завершён!</b>\n\nПобедители:\n{winners}\n\nПоздравляем!',
  ERROR: 'Произошла ошибка. Попробуйте позже.',
  SMS_STARTED:
    '[[e:🔥]] <b>SMS GIVEAWAY АКТИВИРОВАН!</b>\n\nРежим: Первые {target} комментариев.\nПриз: <b>{prize_name}</b>.\nУчастники: {participants_count}/{target}.\n\nКонкурс запущен!',
  SMS_REGISTERED: 'Участник #{position} зарегистрирован.\nОсталось мест: {remaining_slots}.',
  SMS_FILLED: '[[e:🏆]] <b>Набор участников завершен!</b>\n\nВсего участников: {participants_count}.\nМожно определять победителей!',
  RESULTS: '[[e:🏆]] <b>Результаты «{contest_name}»</b>\n\nУчастников: {participants_count}\nПобедители:\n{winners}',
  AUCTION_BID: '[[e:🔥]] <b>Перебито!</b>\n\n[[e:👑]] Новый лидер: {leader}\n[[e:⏳]] До конца: {remaining_time}',
  AUCTION_FINISHED: '[[e:🏆]] <b>Ивент завершён!</b>\n\nПобедитель: {winner_username}\nПриз: <b>{prize_name}</b>',
  AUCTION_WARNING: '[[e:⏳]] <b>Внимание!</b>\n\nДо окончания аукциона осталось {remaining_time}!\nТекущий лидер: {leader}\nУспейте перебить!',
  AUCTION_COUNTDOWN: '[[e:⏳]] Ивент завершается! Отсчёт: {remaining_time}...',
  INSTANT_WIN: '[[e:🎉]] <b>Поздравляю!</b>\n[[e:🎁]] Ты выиграл <b>{prize_name}</b> от {owner_username}\n[[e:✅]] Подарок отправлен.',
  // same look as INSTANT_WIN; {chance} and {remaining_slots} are still available
  CHANCE_WIN: '[[e:🎉]] <b>Поздравляю!</b>\n[[e:🎁]] Ты выиграл <b>{prize_name}</b> от {owner_username}\n[[e:✅]] Подарок отправлен.',
  DICE_WIN: '[[e:🎉]] <b>777!</b>\n{winner_username} выбил три семёрки и выиграл <b>{prize_name}</b>!',
  NOTIFICATION: '{contest_name}: {remaining_time}',
};

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  CONTEST_START: 'Старт конкурса',
  PARTICIPANT_REGISTERED: 'Регистрация участника',
  WINNER: 'Победа (личное сообщение)',
  LOSER: 'Проигрыш',
  GIFT_RECEIVED: 'Получение подарка',
  CONTEST_FINISHED: 'Завершение',
  ERROR: 'Ошибка',
  SMS_STARTED: 'SMS Counter: старт',
  SMS_REGISTERED: 'SMS Counter: регистрация',
  SMS_FILLED: 'SMS Counter: набор завершён',
  RESULTS: 'Результаты',
  AUCTION_BID: 'Перебивка: новая ставка',
  AUCTION_FINISHED: 'Перебивка: завершение',
  AUCTION_WARNING: 'Перебивка: предупреждение',
  AUCTION_COUNTDOWN: 'Перебивка: отсчёт',
  INSTANT_WIN: 'Победа в комментариях (ответ победителю)',
  CHANCE_WIN: 'Выигрыш за активность (шанс)',
  DICE_WIN: 'Конкурс 777',
  NOTIFICATION: 'Уведомления',
};
