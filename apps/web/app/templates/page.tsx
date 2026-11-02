'use client';

import { MessageSquareText, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, useApi } from '@/lib/api';
import { cn, fmtDate } from '@/lib/format';
import { MessageEditor, type MessageValue } from '@/components/MessageEditor';
import { TelegramPreview } from '@/components/TelegramPreview';
import { Badge, Button, Card, Empty, Input, Loading, PageHeader, Select, Toggle, useConfirm } from '@/components/ui';

interface Meta {
  keys: { key: string; label: string; default: string }[];
  variables: string[];
  sample: Record<string, string | number>;
}

export default function TemplatesPage() {
  const meta = useApi<Meta>('/api/templates/meta');
  const list = useApi<any[]>('/api/templates');
  const bots = useApi<any[]>('/api/bots');
  const [sel, setSel] = useState<any | null>(null);
  const { confirm, node } = useConfirm();

  const startNew = (key = 'WINNER') => {
    const def = meta.data?.keys.find((k) => k.key === key);
    setSel({ key, name: def?.label ?? key, text: def?.default ?? '', botId: null, mediaId: null, media: null, buttons: [], isActive: true });
  };

  return (
    <>
      <PageHeader
        title="Шаблоны сообщений"
        sub="Свой текст, Premium Emoji, GIF и кнопки для каждого события. Шаблон бота важнее общего."
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => startNew()}>
            Новый шаблон
          </Button>
        }
      />
      {meta.loading || list.loading ? (
        <Loading />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="space-y-1">
            {!list.data?.length && <Empty icon={<MessageSquareText className="h-6 w-6" />} title="Используются стандартные тексты" text="Создайте шаблон, чтобы изменить сообщение." />}
            {list.data?.map((t) => (
              <button
                key={t.id}
                onClick={() => setSel({ ...t, media: t.media ? { url: t.media.url, kind: t.media.kind } : null })}
                className={cn('w-full rounded-xl px-3 py-2.5 text-left transition', sel?.id === t.id ? 'bg-elevated' : 'hover:bg-line/[0.03]')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{t.name}</span>
                  {!t.isActive && <Badge>выкл</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {meta.data?.keys.find((k) => k.key === t.key)?.label} · {t.bot ? `@${t.bot.username}` : 'все боты'}
                </div>
              </button>
            ))}
            <div className="pt-4">
              <div className="label">Создать для события</div>
              <div className="flex flex-wrap gap-1">
                {meta.data?.keys.map((k) => (
                  <button key={k.key} onClick={() => startNew(k.key)} className="rounded-lg border border-line/10 px-2 py-1 text-xs text-muted hover:border-accent hover:text-fg">
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {sel ? (
            <Editor
              key={sel.id ?? sel.key}
              tpl={sel}
              meta={meta.data!}
              bots={bots.data ?? []}
              onSaved={async (t) => {
                await list.reload();
                setSel(t);
              }}
              onDelete={async () => {
                if (!(await confirm('Удалить шаблон?', 'Будет использоваться стандартный текст.', { danger: true }))) return;
                await api(`/api/templates/${sel.id}`, { method: 'DELETE' });
                setSel(null);
                list.reload();
              }}
            />
          ) : (
            <Empty title="Выберите шаблон" text="Или создайте новый для нужного события." />
          )}
        </div>
      )}
      {node}
    </>
  );
}

function Editor({ tpl, meta, bots, onSaved, onDelete }: { tpl: any; meta: Meta; bots: any[]; onSaved(t: any): void; onDelete(): void }) {
  const [key, setKey] = useState(tpl.key);
  const [name, setName] = useState(tpl.name);
  const [botId, setBotId] = useState<string>(tpl.botId ?? '');
  const [active, setActive] = useState(tpl.isActive);
  const [msg, setMsg] = useState<MessageValue>({ text: tpl.text, mediaId: tpl.mediaId, media: tpl.media, buttons: (tpl.buttons ?? []).filter((b: any) => b.url) });
  const [saving, setSaving] = useState(false);
  useEffect(() => setName((n: string) => n || meta.keys.find((k) => k.key === key)?.label), [key, meta.keys]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { key, name, text: msg.text, botId: botId || null, mediaId: msg.mediaId ?? null, buttons: msg.buttons.filter((b) => b.text && b.url), isActive: active };
      const t = tpl.id ? await api(`/api/templates/${tpl.id}`, { method: 'PUT', body }) : await api('/api/templates', { body });
      toast.success('Шаблон сохранён');
      onSaved({ ...t, media: msg.media });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    const bot = bots.find((b) => b.id === botId) ?? bots[0];
    try {
      await api('/api/templates/test', { body: { botId: bot.id, text: msg.text, mediaId: msg.mediaId ?? null, buttons: msg.buttons.filter((b) => b.text && b.url) } });
      toast.success(`Отправлено вам в личку от @${bot.username}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Событие" value={key} onChange={(e) => setKey(e.target.value)}>
            {meta.keys.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </Select>
          <Select label="Бот" value={botId} onChange={(e) => setBotId(e.target.value)}>
            <option value="">Все мои боты</option>
            {bots
              .filter((b) => !b.isPlatform)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  @{b.username}
                </option>
              ))}
          </Select>
        </div>
        <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} />
        <MessageEditor value={msg} onChange={setMsg} />
        <Toggle checked={active} onChange={setActive} label="Шаблон активен" />
        <div className="flex flex-wrap gap-2">
          <Button loading={saving} onClick={save}>
            Сохранить
          </Button>
          <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={test} disabled={!bots.length}>
            Тест себе
          </Button>
          <Button variant="ghost" onClick={() => setMsg({ ...msg, text: meta.keys.find((k) => k.key === key)?.default ?? '' })}>
            Стандартный текст
          </Button>
          {tpl.id && (
            <Button variant="ghost" className="ml-auto" icon={<Trash2 className="h-4 w-4" />} onClick={onDelete}>
              Удалить
            </Button>
          )}
        </div>
        {tpl.updatedAt && <p className="text-xs text-muted">Изменён {fmtDate(tpl.updatedAt)}</p>}
      </Card>
      <div className="xl:sticky xl:top-8 xl:self-start">
        <div className="label">Предпросмотр с тестовыми данными</div>
        <TelegramPreview text={msg.text} media={msg.media} buttons={msg.buttons.map((b) => [b])} vars={meta.sample} botName={bots.find((b) => b.id === botId)?.name} />
        <div className="mt-4 flex flex-wrap gap-1">
          {meta.variables.map((v) => (
            <code key={v} className="rounded bg-elevated px-1.5 py-0.5 text-[11px] text-muted">{`{${v}}`}</code>
          ))}
        </div>
      </div>
    </div>
  );
}
