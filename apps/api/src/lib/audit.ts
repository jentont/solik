import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

export async function audit(
  action: string,
  opts: { actorId?: string | null; entity?: string; entityId?: string; meta?: Record<string, unknown>; ip?: string; level?: 'info' | 'warn' | 'error' } = {},
) {
  try {
    await prisma.activityLog.create({
      data: {
        action,
        actorId: opts.actorId ?? null,
        entity: opts.entity,
        entityId: opts.entityId,
        meta: (JSON.parse(JSON.stringify(opts.meta ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue),
        ip: opts.ip,
        level: opts.level ?? 'info',
      },
    });
  } catch {
    // audit must never break the main flow
  }
}

export async function contestEvent(contestId: string, type: string, data: Record<string, unknown> = {}) {
  await prisma.contestEvent
    .create({
      data: {
        contestId,
        type,
        data: JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as Prisma.InputJsonValue,
      },
    })
    .catch(() => undefined);
}
