import { prisma } from '../lib/prisma.js';
import { registerPlatformBot } from '../modules/bots/service.js';
import { mainApi, webhookUrl } from '../telegram/registry.js';
import { setupMainBotMenu } from '../bot/mainMenu.js';

const bot = await registerPlatformBot();
await mainApi.setWebhook(webhookUrl(bot.id), bot.webhookSecret);
await setupMainBotMenu(mainApi);
console.log('webhook:', await mainApi.getWebhookInfo());
await prisma.$disconnect();
