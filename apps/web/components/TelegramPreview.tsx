'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';

export interface PreviewMedia {
  url: string;
  kind: 'PHOTO' | 'ANIMATION' | 'VIDEO';
}

/** Renders premium emoji with their Telegram preview; alt text = fallback character. */
function withEmojiPreviews(html: string) {
  // [[e:…]] = a premium emoji the bot picks from its pack when sending; shown as a small sparkle here
  return html.replace(/\[\[e:[^\]]{1,8}\]\]\s?/g, '<span class="tg-pack" title="Премиум-эмодзи из пака">✦</span> ').replace(
    /<tg-emoji emoji-id="(\d+)">(.*?)<\/tg-emoji>/g,
    (_m, id: string, fb: string) => `<tg-emoji><img src="/api/emoji/${id}/preview" alt="${fb.replace(/"/g, '')}" loading="lazy"></tg-emoji>`,
  );
}

/**
 * Telegram-like message bubble. HTML is produced by the API (`/api/templates/render`),
 * i.e. exactly what Telegram receives — already sanitized server-side.
 */
export function TelegramPreview({
  text,
  html: htmlProp,
  media,
  buttons,
  botName = 'Бот',
  vars,
}: {
  text?: string;
  html?: string;
  media?: PreviewMedia | null;
  buttons?: { text: string; url?: string }[][];
  botName?: string;
  vars?: Record<string, string | number>;
}) {
  const [html, setHtml] = useState(htmlProp ?? '');
  useEffect(() => {
    if (htmlProp !== undefined) return setHtml(htmlProp);
    if (!text) return setHtml('');
    const t = setTimeout(() => {
      api<{ html: string }>('/api/templates/render', { body: { text, vars } })
        .then((r) => setHtml(r.html))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [text, htmlProp, vars]);
  const rendered = useMemo(() => withEmojiPreviews(html).replace(/\n/g, '<br/>'), [html]);
  const rows = (buttons ?? []).filter((r) => r.some((b) => b.text));

  return (
    <div className="rounded-2xl bg-[#0e1621] p-4" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgb(255 255 255 / 0.025) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
      <div className="max-w-[380px]">
        <div className="overflow-hidden rounded-2xl rounded-bl-md bg-[#182533] text-[14.5px] leading-[1.38] text-[#f5f5f5] shadow-lg">
          {media &&
            (media.kind === 'PHOTO' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.url} alt="" className="max-h-[320px] w-full object-cover" />
            ) : (
              <video src={media.url} autoPlay loop muted playsInline className="max-h-[320px] w-full object-cover" />
            ))}
          <div className="px-3 pb-1.5 pt-2">
            <div className="mb-0.5 text-[13px] font-semibold text-[#6ab3f3]">{botName}</div>
            {rendered ? <div className="tg-msg break-words" dangerouslySetInnerHTML={{ __html: rendered }} /> : <div className="text-[#7f91a4]">Пустое сообщение</div>}
            <div className="mt-0.5 text-right text-[13px] text-[#6d7f8f]">{new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="mt-1 flex gap-1">
            {row
              .filter((b) => b.text)
              .map((b, j) => (
                <div key={j} className="flex-1 truncate rounded-lg bg-[#182533]/80 px-2 py-2 text-center text-[13px] font-medium text-white backdrop-blur">
                  {b.text}
                  {b.url && <span className="ml-1 text-[13px] opacity-60">↗</span>}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
