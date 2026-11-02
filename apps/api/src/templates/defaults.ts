import type { TemplateKey } from '@prisma/client';

// Neutral texts: white-label bots must not mention SOLIK unless the owner adds it.
export const DEFAULT_TEMPLATES: Record<TemplateKey, string> = {
  CONTEST_START: '<b>{contest_name}</b>\n\nПриз: <b>{prize_name}</b>\nУчаствуйте!',
  PARTICIPANT_REGISTERED: '{username}, вы участвуете в конкурсе «{contest_name}». Ваш номер: #{position}',
  WINNER: 'Поздравляем, {username}!\nТы выиграл <b>{prize_name}</b>!\n\nСпасибо за участие!',
  LOSER: 'Конкурс «{contest_name}» завершён. В этот раз не повезло — ждём вас в следующем розыгрыше!',
  GIFT_RECEIVED: '{username}, ваш приз <b>{gift_name}</b> отправлен!',
  CONTEST_FINISHED: '<b>Конкурс «{contest_name}» завершён!</b>\n\nПобедители:\n{winners}\n\nПоздравляем!',
  ERROR: 'Произошла ошибка. Попробуйте позже.',
  SMS_STARTED:
    '<b>SMS GIVEAWAY АКТИВИРОВАН!</b>\n\nРежим: Первые {target} комментариев.\nПриз: <b>{prize_name}</b>.\nУчастники: {participants_count}/{target}.\n\nКонкурс запущен!',
  SMS_REGISTERED: 'Участник #{position} зарегистрирован.\nОсталось мест: {remaining_slots}.',
  SMS_FILLED: '<b>Набор участников завершен!</b>\n\nВсего участников: {participants_count}.\nМожно определять победителей!',
  RESULTS: '<b>Результаты «{contest_name}»</b>\n\nУчастников: {participants_count}\nПобедители:\n{winners}',
  AUCTION_BID: '<b>Перебито!</b>\n\nНовый лидер: {leader}\nСтавка: {current_bid} Stars\nДо конца: {remaining_time}',
  AUCTION_FINISHED: '<b>Ивент завершён!</b>\n\nПобедитель: {winner_username}\nПриз: <b>{prize_name}</b>',
  AUCTION_WARNING: '<b>Внимание!</b>\n\nДо окончания аукциона осталось {remaining_time}!\nТекущий лидер: {leader}\nУспейте перебить!',
  AUCTION_COUNTDOWN: 'Ивент завершается! Отсчёт: {remaining_time}...',
  INSTANT_WIN: '<b>Поздравляю!</b>\nТы выиграл <b>{prize_name}</b> от {owner_username}\nПодарок отправлен.',
  CHANCE_WIN:
    '{winner_username} получил <b>{prize_name}</b> за активность в чате!\n\nШанс был: {chance}%\nОсталось подарков на сегодня: {remaining_slots}',
  DICE_WIN: '<b>777!</b>\n{winner_username} выбил три семёрки и выиграл <b>{prize_name}</b>!',
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
