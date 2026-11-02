// Single-container entrypoint.
//  1. Fills config from the host: DOMAIN -> public URLs, BOT_TOKEN -> MAIN_BOT_TOKEN (Bothost passes both).
//  2. Generates JWT_SECRET / ENCRYPTION_KEY once and keeps them in DATA_DIR if they are not set.
//  3. Starts embedded PostgreSQL and Redis (data in DATA_DIR) unless DATABASE_URL / REDIS_URL are given.
//  4. Applies migrations, then runs API (internal :4000), worker and the web server on PORT (default 3000).
// If any process dies, the container exits so the platform restarts it.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const env = process.env;
const DATA = env.DATA_DIR || '/app/data';
const PORT = env.PORT || '3000';
const API_PORT = env.API_INTERNAL_PORT || '4000';
const log = (...a) => console.log('[start]', ...a);
// placeholders from .env templates count as "not set"
const isSet = (v) => !!v && !/ЗАМЕНИТЬ|REPLACE_ME|example\.com/i.test(v);

mkdirSync(DATA, { recursive: true });

// ---- config from the host ----------------------------------------------------
if (!isSet(env.MAIN_BOT_TOKEN)) env.MAIN_BOT_TOKEN = env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || '';
if (!isSet(env.MAIN_BOT_TOKEN)) {
  console.error('[start] MAIN_BOT_TOKEN (or BOT_TOKEN) is not set');
  process.exit(1);
}
const domain = (env.DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
for (const key of ['PUBLIC_API_URL', 'WEB_APP_URL']) {
  if (!isSet(env[key])) {
    if (!domain) {
      console.error(`[start] ${key} is not set and the host gave no DOMAIN — enable the domain option or set ${key}`);
      process.exit(1);
    }
    env[key] = `https://${domain}`;
  }
}
if (!isSet(env.UPLOAD_DIR) || env.UPLOAD_DIR.startsWith('./')) env.UPLOAD_DIR = join(DATA, 'uploads');
if (!isSet(env.BRAND_LOGO_PATH) || env.BRAND_LOGO_PATH.startsWith('./')) env.BRAND_LOGO_PATH = '/usr/src/app/apps/api/assets/logo.png';
mkdirSync(env.UPLOAD_DIR, { recursive: true });

// ---- secrets generated once, persisted on the volume ----------------------------
const secretsFile = join(DATA, 'secrets.json');
const saved = existsSync(secretsFile) ? JSON.parse(readFileSync(secretsFile, 'utf8')) : {};
let changed = false;
if (!isSet(env.JWT_SECRET) || env.JWT_SECRET.length < 32) {
  env.JWT_SECRET = saved.JWT_SECRET ??= randomBytes(48).toString('base64url');
  changed = true;
}
if (!/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_KEY || '')) {
  env.ENCRYPTION_KEY = saved.ENCRYPTION_KEY ??= randomBytes(32).toString('hex');
  changed = true;
}
if (changed) writeFileSync(secretsFile, JSON.stringify(saved, null, 2), { mode: 0o600 });

// ---- process supervision -------------------------------------------------------
const children = [];
let stopping = false;
function supervise(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', ...opts, env: { ...env, ...(opts.env || {}) } });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[${name}] exited (${code ?? signal}) — stopping container`);
    shutdown(code || 1);
  });
  children.push(child);
  return child;
}
function shutdown(code = 0) {
  stopping = true;
  for (const c of [...children].reverse()) c.kill(c.spawnargs.some((a) => a.includes('postgres')) ? 'SIGINT' : 'SIGTERM');
  setTimeout(() => process.exit(code), 8000).unref();
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, check, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    if (check()) return;
    await sleep(500);
  }
  console.error(`[start] ${what} did not start in ${seconds}s`);
  process.exit(1);
}

// ---- embedded PostgreSQL ---------------------------------------------------------
if (!isSet(env.DATABASE_URL)) {
  const versions = existsSync('/usr/lib/postgresql') ? readdirSync('/usr/lib/postgresql').sort() : [];
  if (!versions.length) {
    console.error('[start] DATABASE_URL is not set and PostgreSQL is not installed in the image');
    process.exit(1);
  }
  const bin = `/usr/lib/postgresql/${versions.at(-1)}/bin`;
  const pgdata = join(DATA, 'postgres');
  mkdirSync(pgdata, { recursive: true });
  spawnSync('chown', ['-R', 'postgres:postgres', pgdata], { stdio: 'inherit' });
  spawnSync('chmod', ['700', pgdata]);
  const asPg = (cmd, args) => spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'inherit' });
  if (!existsSync(join(pgdata, 'PG_VERSION'))) {
    log('initializing embedded PostgreSQL in', pgdata);
    if (asPg(`${bin}/initdb`, ['-D', pgdata, '--auth=trust', '--username=solik', '--encoding=UTF8', '--no-locale']).status !== 0) process.exit(1);
  }
  supervise('postgres', 'runuser', [
    '-u', 'postgres', '--', `${bin}/postgres`, '-D', pgdata,
    '-c', 'listen_addresses=127.0.0.1', '-c', 'port=5432', '-c', 'unix_socket_directories=/tmp',
    '-c', 'shared_buffers=32MB', '-c', 'max_connections=40', '-c', 'work_mem=4MB',
  ]);
  await waitFor('PostgreSQL', () => spawnSync(`${bin}/pg_isready`, ['-h', '127.0.0.1', '-p', '5432', '-q']).status === 0);
  const exists = spawnSync(`${bin}/psql`, ['-h', '127.0.0.1', '-U', 'solik', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='solik'"], { encoding: 'utf8' });
  if (!exists.stdout?.includes('1')) spawnSync(`${bin}/createdb`, ['-h', '127.0.0.1', '-U', 'solik', 'solik'], { stdio: 'inherit' });
  env.DATABASE_URL = 'postgresql://solik@127.0.0.1:5432/solik?connection_limit=8';
  log('embedded PostgreSQL ready');
}

// ---- embedded Redis --------------------------------------------------------------
if (!isSet(env.REDIS_URL)) {
  const dir = join(DATA, 'redis');
  mkdirSync(dir, { recursive: true });
  // AOF keeps delayed timer jobs across restarts; noeviction is required by BullMQ
  supervise('redis', 'redis-server', [
    '--bind', '127.0.0.1', '--port', '6379', '--dir', dir, '--appendonly', 'yes', '--save', '',
    '--maxmemory', '96mb', '--maxmemory-policy', 'noeviction', '--protected-mode', 'yes',
  ]);
  await waitFor('Redis', () => spawnSync('redis-cli', ['-h', '127.0.0.1', '-p', '6379', 'ping'], { encoding: 'utf8' }).stdout?.trim() === 'PONG');
  env.REDIS_URL = 'redis://127.0.0.1:6379';
  log('embedded Redis ready');
}

// ---- migrations + app -----------------------------------------------------------
const migrate = spawnSync('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], { stdio: 'inherit', env });
if (migrate.status !== 0) {
  console.error('[start] prisma migrate deploy failed — check DATABASE_URL');
  shutdown(1);
} else {
  log(`public URL ${env.WEB_APP_URL}, web on :${PORT}`);
  // heap limits keep all three Node processes + DB within ~1 GB
  supervise('api', 'node', ['--max-old-space-size=224', 'dist/server.js'], { cwd: 'apps/api', env: { PORT: API_PORT, HOST: '127.0.0.1' } });
  supervise('worker', 'node', ['--max-old-space-size=224', 'dist/worker.js'], { cwd: 'apps/api' });
  supervise('web', 'node', ['--max-old-space-size=192', 'apps/web/server.js'], { cwd: 'web', env: { PORT, HOSTNAME: '0.0.0.0' } });
}
