// `npm run test:e2e:local`: the e2e suite against a local sandbox instead of testnet.
// Starts scripts/dev-chain.mjs (both coins, demo relayer env) and the Vite dev
// server, runs Playwright with the matching E2E_* env, then stops both.
// Extra arguments go to `playwright test`.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT || 5199);
const children = [];

function start(name, cmd, args, ready) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let log = '';
    const onData = (d) => {
      log += d;
      if (ready && ready.test(log)) resolve(child);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`${name} exited (${code}):\n${log.slice(-2000)}`)));
    if (!ready) resolve(child);
  });
}

function stop() {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM');
    } catch {}
  }
}
process.on('SIGINT', () => (stop(), process.exit(130)));
process.on('SIGTERM', () => (stop(), process.exit(143)));

async function waitHttp(url, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    if (Date.now() > until) throw new Error(`${url} did not come up`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

let code = 1;
try {
  console.log('e2e local: starting the sandbox chain…');
  await start('dev-chain', 'node', ['scripts/dev-chain.mjs'], /^ready$/m);
  const env = Object.fromEntries(
    readFileSync(join(ROOT, 'web/.env.local'), 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  console.log(`e2e local: starting the app on :${PORT}…`);
  await start('vite', 'npm', ['--prefix', 'web', 'run', 'dev', '--', '--port', String(PORT), '--strictPort'], null);
  await waitHttp(`http://localhost:${PORT}/`);

  const pw = spawn('npx', ['playwright', 'test', ...process.argv.slice(2)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_BASE_URL: `http://localhost:${PORT}`,
      E2E_RPC_URL: env.VITE_NEAR_RPC_URL,
      E2E_DEMO_ID: env.VITE_DEMO_CONTRACT_ID,
      E2E_MAIN_ID: env.VITE_MAIN_CONTRACT_ID,
      E2E_ANI_ID: env.VITE_ANI_ACCOUNT_ID,
      E2E_BUDI_ID: env.VITE_BUDI_ACCOUNT_ID,
      E2E_EXPLORER: env.VITE_EXPLORER ?? '0',
    },
  });
  code = await new Promise((resolve) => pw.on('exit', (c) => resolve(c ?? 1)));
} catch (e) {
  console.error(String(e.message ?? e));
} finally {
  stop();
}
process.exit(code);
