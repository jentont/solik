'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Wordmark in the Solutions family style (heavy Unbounded + handwritten Caveat, like «Solutions Design»).
 * The owner's logo from /public/brand/logo.png is shown next to it when present — never generated.
 */
export function Brand({ compact }: { compact?: boolean }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img?.complete) setState(img.naturalWidth > 0 ? 'ok' : 'failed');
  }, []);
  return (
    <div className="flex items-center gap-2.5">
      {state !== 'failed' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={ref} src="/brand/logo.png" alt="" className={state === 'ok' ? 'h-9 w-9 rounded-full object-cover' : 'hidden'} onLoad={() => setState('ok')} onError={() => setState('failed')} />
      )}
      <span className="relative pb-2 leading-none">
        <span className={`font-display font-black tracking-[-0.04em] ${compact ? 'text-[19px]' : 'text-[21px]'}`}>SOLIK</span>
        <span className="absolute -bottom-0.5 left-[62%] -rotate-6 whitespace-nowrap font-hand text-[17px] font-bold text-accent">giveaways</span>
      </span>
    </div>
  );
}
