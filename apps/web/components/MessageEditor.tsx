'use client';

import { Bold, Code, EyeOff, Film, Image as ImageIcon, Italic, Link2, Plus, Quote, Smile, Strikethrough, Trash2, Underline, Upload, Variable, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { cn } from '@/lib/format';
import { Button, Input, Modal, Spinner } from './ui';
import type { PreviewMedia } from './TelegramPreview';

export interface MessageValue {
  text: string;
  mediaId?: string | null;
  media?: PreviewMedia | null;
  buttons: { text: string; url: string }[];
}

const VARS = ['username', 'first_name', 'user_id', 'owner_username', 'chat_name', 'channel_username', 'contest_name', 'prize_name', 'gift_name', 'winner_username', 'winners', 'participants_count', 'position', 'remaining_slots', 'remaining_time', 'stars_amount', 'current_bid', 'leader', 'target', 'chance'];

export function MessageEditor({ value, onChange, allowButtons = true, allowMedia = true, rows = 8 }: { value: MessageValue; onChange(v: MessageValue): void; allowButtons?: boolean; allowMedia?: boolean; rows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);

  const insert = (before: string, after = '') => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.text.slice(s, e);
    const next = value.text.slice(0, s) + before + sel + after + value.text.slice(e);
    onChange({ ...value, text: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };
  const wrap = (tag: string, attrs = '') => insert(`<${tag}${attrs}>`, `</${tag.split(' ')[0]}>`);

  const tools = [
    { icon: Bold, title: 'Жирный', run: () => wrap('b') },
    { icon: Italic, title: 'Курсив', run: () => wrap('i') },
    { icon: Underline, title: 'Подчёркнутый', run: () => wrap('u') },
    { icon: Strikethrough, title: 'Зачёркнутый', run: () => wrap('s') },
    { icon: EyeOff, title: 'Спойлер', run: () => wrap('tg-spoiler') },
    { icon: Code, title: 'Моноширинный', run: () => wrap('code') },
    { icon: Quote, title: 'Цитата', run: () => wrap('blockquote') },
    {
      icon: Link2,
      title: 'Ссылка',
      run: () => {
        const url = prompt('URL ссылки (https://…)');
        if (url && /^(https?:\/\/|tg:\/\/)/.test(url)) wrap('a', ` href="${url.replace(/"/g, '')}"`);
        else if (url) toast.error('Ссылка должна начинаться с https:// или tg://');
      },
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-xl border border-b-0 border-line/10 bg-elevated/40 p-1">
        {tools.map((t) => (
          <button key={t.title} type="button" title={t.title} onClick={t.run} className="rounded-lg p-1.5 text-muted hover:bg-line/5 hover:text-fg">
            <t.icon className="h-4 w-4" />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-line/10" />
        <button type="button" title="Premium Emoji" onClick={() => setEmojiOpen(true)} className="rounded-lg p-1.5 text-muted hover:bg-line/5 hover:text-gold">
          <Smile className="h-4 w-4" />
        </button>
        <div className="relative">
          <button type="button" title="Переменные" onClick={() => setVarsOpen((v) => !v)} className="rounded-lg p-1.5 text-muted hover:bg-line/5 hover:text-fg">
            <Variable className="h-4 w-4" />
          </button>
          {varsOpen && (
            <div className="scroll-thin absolute left-0 top-9 z-20 max-h-64 w-56 overflow-y-auto rounded-xl border border-line/10 bg-elevated p-1 shadow-card">
              {VARS.map((v) => (
                <button key={v} type="button" className="block w-full rounded-lg px-2 py-1.5 text-left font-mono text-xs hover:bg-line/5" onClick={() => (insert(`{${v}}`), setVarsOpen(false))}>
                  {`{${v}}`}
                </button>
              ))}
            </div>
          )}
        </div>
        {allowMedia && (
          <button type="button" title="Изображение / GIF / видео" onClick={() => setMediaOpen(true)} className="rounded-lg p-1.5 text-muted hover:bg-line/5 hover:text-fg">
            <Film className="h-4 w-4" />
          </button>
        )}
        <span className="ml-auto pr-2 text-[11px] text-muted">{value.text.length}/{value.mediaId ? 1024 : 4096}</span>
      </div>
      <textarea
        ref={ref}
        rows={rows}
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        className="input rounded-t-none font-mono text-[13px] leading-relaxed"
        placeholder="Текст сообщения. Поддерживается форматирование Telegram и {переменные}."
      />

      {allowMedia && value.media && (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-line/10 bg-elevated/40 p-2">
          {value.media.kind === 'PHOTO' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.media.url} alt="" className="h-12 w-16 rounded-lg object-cover" />
          ) : (
            <video src={value.media.url} muted autoPlay loop className="h-12 w-16 rounded-lg object-cover" />
          )}
          <span className="flex-1 text-xs text-muted">{value.media.kind === 'ANIMATION' ? 'GIF / анимация' : value.media.kind === 'VIDEO' ? 'Видео' : 'Изображение'}</span>
          <button type="button" onClick={() => onChange({ ...value, mediaId: null, media: null })} className="rounded-lg p-1.5 text-muted hover:text-bad">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {allowButtons && <ButtonsEditor value={value.buttons} onChange={(buttons) => onChange({ ...value, buttons })} />}

      <EmojiPicker open={emojiOpen} onClose={() => setEmojiOpen(false)} onPick={(e) => insert(`<tg-emoji emoji-id="${e.customEmojiId}">${e.fallback}</tg-emoji>`)} />
      <MediaPicker open={mediaOpen} onClose={() => setMediaOpen(false)} onPick={(m) => onChange({ ...value, mediaId: m.id, media: { url: m.url, kind: m.kind } })} />
    </div>
  );
}

export function ButtonsEditor({ value, onChange }: { value: { text: string; url: string }[]; onChange(v: { text: string; url: string }[]): void }) {
  return (
    <div className="mt-3 space-y-2">
      {value.map((b, i) => (
        <div key={i} className="flex gap-2">
          <input className="input" placeholder="Текст кнопки" value={b.text} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <input className="input" placeholder="https://…" value={b.url} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded-lg px-2 text-muted hover:text-bad">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      {value.length < 6 && (
        <Button type="button" size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange([...value, { text: '', url: '' }])}>
          Inline-кнопка
        </Button>
      )}
    </div>
  );
}

interface Emoji {
  id: string;
  customEmojiId: string;
  name: string;
  category: string;
  fallback: string;
}

export function EmojiPicker({ open, onClose, onPick }: { open: boolean; onClose(): void; onPick(e: Emoji): void }) {
  const { data, loading } = useApi<Emoji[]>(open ? '/api/emoji' : null, [open]);
  const [q, setQ] = useState('');
  const list = (data ?? []).filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));
  const cats = [...new Set(list.map((e) => e.category))];
  return (
    <Modal open={open} onClose={onClose} title="Premium Emoji">
      <Input placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="mt-2 text-xs text-muted">
        Premium Emoji отправляются как entity <code>custom_emoji</code>. Если Telegram не разрешит их боту в конкретном чате, будет показан обычный эмодзи-заменитель.
      </p>
      <div className="scroll-thin mt-4 max-h-[50dvh] overflow-y-auto">
        {loading && <Spinner />}
        {!loading && !list.length && <p className="py-8 text-center text-sm text-muted">Эмодзи ещё не импортированы администратором</p>}
        {cats.map((c) => (
          <div key={c} className="mb-4">
            <div className="label">{c}</div>
            <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
              {list
                .filter((e) => e.category === c)
                .map((e) => (
                  <button key={e.id} title={e.name} onClick={() => (onPick(e), onClose())} className="flex aspect-square items-center justify-center rounded-xl text-2xl hover:bg-line/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/emoji/${e.customEmojiId}/preview`} alt={e.fallback} className="h-8 w-8" />
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

interface Media {
  id: string;
  url: string;
  kind: 'PHOTO' | 'ANIMATION' | 'VIDEO';
  createdAt: string;
}

export function MediaPicker({ open, onClose, onPick, only }: { open: boolean; onClose(): void; onPick(m: Media): void; only?: Media['kind'] }) {
  const { data, loading, reload } = useApi<Media[]>(open ? `/api/media${only ? `?kind=${only}` : ''}` : null, [open]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [asAnimation, setAsAnimation] = useState(true);

  const upload = async (f: File) => {
    const form = new FormData();
    form.append('asAnimation', String(asAnimation));
    form.append('file', f);
    setUploading(true);
    try {
      const m = await api<Media>('/api/media/upload', { form });
      toast.success('Файл загружен');
      await reload();
      onPick(m);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Медиа: изображения, GIF, видео" wide>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button loading={uploading} icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
          Загрузить
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={asAnimation} onChange={(e) => setAsAnimation(e.target.checked)} />
          MP4 без звука отправлять как GIF
        </label>
      </div>
      <p className="mb-3 text-xs text-muted">Файлы отправляются в Telegram один раз, затем используется сохранённый file_id — повторная отправка мгновенная.</p>
      {loading ? (
        <Spinner />
      ) : !data?.length ? (
        <div className="py-10 text-center text-sm text-muted">
          <ImageIcon className="mx-auto mb-2 h-6 w-6" />
          Пока нет загруженных файлов
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {data.map((m) => (
            <button key={m.id} onClick={() => (onPick(m), onClose())} className={cn('group relative aspect-video overflow-hidden rounded-xl border border-line/10 hover:border-accent')}>
              {m.kind === 'PHOTO' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <video src={m.url} muted loop autoPlay playsInline className="h-full w-full object-cover" />
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px]">{m.kind === 'ANIMATION' ? 'GIF' : m.kind === 'VIDEO' ? 'VIDEO' : 'IMG'}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
