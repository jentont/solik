'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { PageHeader, Tabs } from '@/components/ui';
import { AdminBots, AdminChats, AdminOverview, AdminUsers } from '@/components/admin/Monitoring';
import { AdminSubscriptions } from '@/components/admin/Subscriptions';
import { AdminBroadcasts } from '@/components/admin/Broadcasts';
import { AdminCatalog, AdminLogs } from '@/components/admin/System';

type Tab = 'overview' | 'bots' | 'chats' | 'users' | 'subs' | 'broadcasts' | 'catalog' | 'logs';

export default function AdminPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    if (user && user.role === 'USER') router.replace('/');
  }, [user, router]);
  if (!user || user.role === 'USER') return null;

  return (
    <>
      <PageHeader title={<span className="text-gold">Админ-панель SOLIK</span>} sub="Все боты, чаты, подписки, рассылки и система" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Обзор' },
          { id: 'bots', label: 'Все боты' },
          { id: 'chats', label: 'Подключенные чаты' },
          { id: 'users', label: 'Пользователи' },
          { id: 'subs', label: 'Подписки и тарифы' },
          { id: 'broadcasts', label: 'Рассылки' },
          { id: 'catalog', label: 'Подарки и эмодзи' },
          { id: 'logs', label: 'Логи и интеграции' },
        ]}
      />
      {tab === 'overview' && <AdminOverview />}
      {tab === 'bots' && <AdminBots />}
      {tab === 'chats' && <AdminChats />}
      {tab === 'users' && <AdminUsers isOwner={user.role === 'OWNER'} />}
      {tab === 'subs' && <AdminSubscriptions isOwner={user.role === 'OWNER'} />}
      {tab === 'broadcasts' && <AdminBroadcasts />}
      {tab === 'catalog' && <AdminCatalog />}
      {tab === 'logs' && <AdminLogs />}
    </>
  );
}
