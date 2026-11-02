// Single-container entrypoint: applies DB migrations, then runs API (internal :4000),
// background worker and the web server on PORT (default 3000). Webhooks and /api are
// proxied by the web server, so only one port has to be exposed.
// If any process dies, the container exits so the platform restarts it.
import { spawn, spawnSync } from 'node:child_process';

const PORT = process.env.PORT || '3000';
const API_PORT = process.env.API_INTERNAL_PORT || '4000';

const migrate = spawnSync('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], { stdio: 'inherit' });
if (migrate.status !== 0) {
  console.error('prisma migrate deploy failed — check DATABASE_URL');
  process.exit(1);
}

const children = [];
function run(name, args, cwd, env) {
  const child = spawn('node', args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('exit', (code, signal) => {
    console.error(`[${name}] exited (${code ?? signal}) — stopping container`);
    for (const c of children) if (c !== child) c.kill('SIGTERM');
    process.exit(code || 1);
  });
  children.push(child);
}

run('api', ['dist/server.js'], 'apps/api', { PORT: API_PORT, HOST: '127.0.0.1' });
run('worker', ['dist/worker.js'], 'apps/api', {});
run('web', ['apps/web/server.js'], 'web', { PORT, HOSTNAME: '0.0.0.0' });

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    for (const c of children) c.kill('SIGTERM');
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
