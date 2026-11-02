import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JWT_SECRET: 'test-jwt-secret-test-jwt-secret-123456',
      ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000',
      MAIN_BOT_TOKEN: '123456:TEST',
      PUBLIC_API_URL: 'https://api.test',
      WEB_APP_URL: 'https://app.test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://x:x@localhost:5432/x',
    },
  },
});
