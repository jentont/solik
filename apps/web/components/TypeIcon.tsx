import { Cherry, Dices, Flame, Gavel, Gem, Gift, Hash, MessageCircle, MessagesSquare, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/format';

const ICONS: Record<string, { icon: LucideIcon; tone: string }> = {
  RANDOM: { icon: Dices, tone: 'text-sky bg-sky/12' },
  STARS_AUCTION: { icon: Gavel, tone: 'text-warn bg-warn/12' },
  FIRST_COMMENT: { icon: MessageCircle, tone: 'text-sky bg-sky/12' },
  SMS_COUNTER: { icon: Hash, tone: 'text-ok bg-ok/12' },
  MESSAGE_GIVEAWAY: { icon: MessagesSquare, tone: 'text-ok bg-ok/12' },
  ACTIVITY: { icon: Flame, tone: 'text-ribbon bg-ribbon/12' },
  GIFTS: { icon: Gift, tone: 'text-ribbon bg-ribbon/12' },
  NFT: { icon: Gem, tone: 'text-sky bg-sky/12' },
  DICE_777: { icon: Cherry, tone: 'text-ribbon bg-ribbon/12' },
};

/** Contest type mark: one icon set instead of emoji, tinted by the mechanic's family. */
export function TypeIcon({ type, size = 44, className }: { type: string; size?: number; className?: string }) {
  const t = ICONS[type] ?? ICONS.RANDOM!;
  return (
    <span style={{ width: size, height: size }} className={cn('flex shrink-0 items-center justify-center rounded-[14px]', t.tone, className)}>
      <t.icon style={{ width: size * 0.48, height: size * 0.48 }} strokeWidth={2} />
    </span>
  );
}
