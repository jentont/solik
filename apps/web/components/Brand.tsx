/** Wordmark: the mascot «солик» in a Santa hat, heavy Unbounded «SOLIK» and a pink handwritten line under it. */
export function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/winter/solik-avatar.webp"
        alt=""
        className={`${compact ? 'h-11 w-11' : 'h-12 w-12'} shrink-0 rounded-full shadow-[0_6px_16px_rgba(0,0,0,0.5)] ring-1 ring-white/20`}
      />
      <span className="leading-none">
        <span className={`glow-text block font-brand font-extrabold tracking-[-0.02em] ${compact ? 'text-[23px]' : 'text-[25px]'}`}>Solik Gifts</span>
        <span className="mt-1 block font-hand text-[18px] font-bold text-pink">гивы с подарками</span>
      </span>
    </div>
  );
}
