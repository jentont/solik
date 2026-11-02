import { cn } from '@/lib/format';

/** Telegram Stars mark (rounded five-point star with a soft gold gradient), used instead of the star emoji in the UI. */
export function StarIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={cn('inline-block shrink-0 align-[-0.15em]', className)}>
      <defs>
        <linearGradient id="tg-star" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD86B" />
          <stop offset="1" stopColor="#F5A623" />
        </linearGradient>
      </defs>
      <path
        fill="url(#tg-star)"
        d="M12 2.6c.5 0 .9.3 1.1.7l2.3 4.9 5.3.7c.9.1 1.3 1.2.6 1.9l-3.9 3.7 1 5.3c.2.9-.8 1.6-1.6 1.2L12 18.4 7.2 21c-.8.4-1.8-.3-1.6-1.2l1-5.3-3.9-3.7c-.7-.7-.3-1.8.6-1.9l5.3-.7 2.3-4.9c.2-.4.6-.7 1.1-.7z"
      />
    </svg>
  );
}

export function Stars({ value, size = 16, className }: { value: React.ReactNode; size?: number; className?: string }) {
  return (
    <span className={cn('num inline-flex items-center gap-1 text-gold', className)}>
      <StarIcon size={size} />
      {value}
    </span>
  );
}
