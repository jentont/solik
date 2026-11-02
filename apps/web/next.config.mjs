import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_INTERNAL_URL || 'http://localhost:4000';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: 'standalone',
  // monorepo: trace dependencies from the workspace root so the standalone build is self-contained
  outputFileTracingRoot: root,
  reactStrictMode: true,
  poweredByHeader: false,
  // Everything is served from one origin/port: API, Telegram webhooks and health go through the web server.
  // Cookies stay first-party and no secrets ever reach the browser bundle.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/webhook/:path*', destination: `${API}/webhook/:path*` },
      { source: '/health', destination: `${API}/health` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "frame-ancestors https://web.telegram.org https://*.telegram.org 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
