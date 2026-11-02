'use client';

import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '@/lib/api';
import { CONTEST_TYPES, fmtNum } from '@/lib/format';
import { Card, CardTitle, Empty, ErrorState, Loading, PageHeader, Select, Stat } from '@/components/ui';
import { StarIcon } from '@/components/StarIcon';

const tooltip = { contentStyle: { background: 'rgb(25 25 35)', border: '1px solid rgb(255 255 255 / 0.08)', borderRadius: 12, fontSize: 12 }, labelStyle: { color: 'rgb(140 140 158)' } };

export default function AnalyticsPage() {
  const [range, setRange] = useState('30');
  const [botId, setBotId] = useState('');
  const [chatId, setChatId] = useState('');
  const [prizeKind, setPrizeKind] = useState('');
  const bots = useApi<any[]>('/api/bots');
  const chats = useApi<{ chats: any[] }>('/api/chats');
  const from = new Date(Date.now() - Number(range) * 86_400_000).toISOString();
  const qs = new URLSearchParams({ from, ...(botId && { botId }), ...(chatId && { chatId }), ...(prizeKind && { prizeKind }) }).toString();
  const { data, error, loading, reload } = useApi<any>(`/api/analytics?${qs}`, [qs]);

  return (
    <>
      <PageHeader title="Аналитика" sub="Конкурсы, участники, победители и призы" />
      <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Select value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="7">7 дней</option>
          <option value="30">30 дней</option>
          <option value="90">90 дней</option>
          <option value="365">Год</option>
        </Select>
        <Select value={botId} onChange={(e) => setBotId(e.target.value)}>
          <option value="">Все боты</option>
          {bots.data?.map((b) => (
            <option key={b.id} value={b.id}>
              @{b.username}
            </option>
          ))}
        </Select>
        <Select value={chatId} onChange={(e) => setChatId(e.target.value)}>
          <option value="">Все чаты</option>
          {chats.data?.chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
        <Select value={prizeKind} onChange={(e) => setPrizeKind(e.target.value)}>
          <option value="">Все призы</option>
          <option value="GIFT">Подарки</option>
          <option value="STARS">Stars</option>
          <option value="NFT">NFT</option>
          <option value="PREMIUM">Premium</option>
          <option value="CUSTOM">Свои</option>
        </Select>
      </div>
      {error && <ErrorState error={error} retry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Конкурсы" value={fmtNum(data.totals.contests)} />
            <Stat label="Участники" value={fmtNum(data.totals.participants)} />
            <Stat label="Победители" value={fmtNum(data.totals.winners)} />
            <Stat label="Подарков выдано" value={fmtNum(data.totals.giftsDelivered)} />
            <Stat label="Stars" value={<span className="inline-flex items-center gap-1.5 text-gold"><StarIcon size={20} />{fmtNum(data.totals.stars)}</span>} />
          </div>
          {!data.totals.contests ? (
            <Empty title="За период нет данных" text="Запустите конкурс — статистика появится здесь." />
          ) : (
            <>
              <Card>
                <CardTitle>Активность по дням</CardTitle>
                <div className="h-64">
                  <ResponsiveContainer>
                    <AreaChart data={data.series.map((s: any) => ({ ...s, day: new Date(s.day).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) }))}>
                      <defs>
                        <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor="rgb(124 92 255)" stopOpacity={0.4} />
                          <stop offset="1" stopColor="rgb(124 92 255)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgb(255 255 255 / 0.05)" vertical={false} />
                      <XAxis dataKey="day" stroke="rgb(140 140 158)" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="rgb(140 140 158)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip {...tooltip} />
                      <Area type="monotone" dataKey="participants" name="Участники" stroke="rgb(124 92 255)" fill="url(#gp)" strokeWidth={2} />
                      <Area type="monotone" dataKey="winners" name="Победители" stroke="rgb(245 185 66)" fill="transparent" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardTitle>Популярные режимы</CardTitle>
                  <div className="h-64">
                    <ResponsiveContainer>
                      <BarChart data={data.byType.map((r: any) => ({ ...r, name: CONTEST_TYPES[r.name]?.label ?? r.name }))} layout="vertical" margin={{ left: 20 }}>
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" stroke="rgb(140 140 158)" fontSize={11} width={140} tickLine={false} axisLine={false} />
                        <Tooltip {...tooltip} cursor={{ fill: 'rgb(255 255 255 / 0.03)' }} />
                        <Bar dataKey="contests" name="Конкурсы" fill="rgb(124 92 255)" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Breakdown title="По чатам" rows={data.byChat} />
                <Breakdown title="По ботам" rows={data.byBot} />
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { name: string; contests: number; participants: number; winners: number }[] }) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="space-y-2 text-[15px]">
        {rows.slice(0, 10).map((r) => (
          <div key={r.name} className="flex items-center justify-between border-b border-line/[0.05] pb-2">
            <span className="truncate">{r.name}</span>
            <span className="flex gap-4 text-[13px] text-muted tabular-nums">
              <span>конкурсов {r.contests}</span>
              <span>участников {fmtNum(r.participants)}</span>
              <span>победителей {r.winners}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
