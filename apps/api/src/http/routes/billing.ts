import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { ensureDefaultPlan } from '../../modules/subscriptions/plans.js';
import { createSubscriptionInvoice, isSubscriptionUsable, setAutoRenew } from '../../modules/subscriptions/service.js';
import { requireAuth, uid } from '../auth.js';
import { parse } from '../validate.js';

export async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/billing', async (req) => {
    await ensureDefaultPlan();
    const [plans, subs] = await Promise.all([
      prisma.whiteLabelPlan.findMany({ where: { isActive: true }, orderBy: { priceStars: 'asc' } }),
      prisma.botSubscription.findMany({
        where: { ownerId: uid(req), status: { not: 'PENDING' } },
        include: { plan: true, bot: { select: { id: true, username: true, name: true, status: true } }, payments: { orderBy: { paidAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { plans, subscriptions: subs.map((s) => ({ ...s, usable: isSubscriptionUsable(s) })) };
  });

  app.post('/api/billing/subscribe', async (req) => {
    const body = parse(z.object({ planId: z.string().optional(), autoRenew: z.boolean().default(true) }), req.body);
    return createSubscriptionInvoice(uid(req), body);
  });

  app.post<{ Params: { id: string } }>('/api/billing/:id/renew', async (req) => {
    const s = await prisma.botSubscription.findFirst({ where: { id: req.params.id, ownerId: uid(req) } });
    if (!s) throw notFound();
    return createSubscriptionInvoice(uid(req), { subscriptionId: s.id, autoRenew: false });
  });

  app.post<{ Params: { id: string } }>('/api/billing/:id/auto-renew', async (req) => {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    return setAutoRenew(req.params.id, uid(req), enabled);
  });
}
