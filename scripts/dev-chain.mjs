#!/usr/bin/env node
// Local chain for `npm run dev`: a NEAR sandbox with both coins deployed from
// target/near/cto/cto.wasm using the constants.json numbers, plus ani and budi.
// Writes web/.env.local (git-ignored) so the app and the dev relayer use it.
// Keeps running until Ctrl+C. Never touches testnet.
//   node scripts/dev-chain.mjs [--fast]   --fast: demo decay 20 s + 40 s
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'web/package.json'));
const { Account, KeyPair, actions } = require('near-api-js');
const { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } = require('near-sandbox');

const C = JSON.parse(readFileSync(join(ROOT, 'reference/constants.json'), 'utf8'));
const WASM = join(ROOT, 'target/near/cto/cto.wasm');
const ONE = 10n ** 18n;
const NEAR = 10n ** 24n;
const fast = process.argv.includes('--fast');

if (!existsSync(WASM)) throw new Error('build the contract first: npm run build:contract');
const build = join(ROOT, 'target/debug/build');
if (!process.env.NEAR_SANDBOX_BIN_PATH && existsSync(build)) {
  for (const d of readdirSync(build).filter((x) => x.startsWith('near-sandbox-'))) {
    const dir = join(build, d, 'out/.near');
    if (!existsSync(dir)) continue;
    for (const v of readdirSync(dir)) if (existsSync(join(dir, v, 'near-sandbox'))) process.env.NEAR_SANDBOX_BIN_PATH = join(dir, v, 'near-sandbox');
  }
}

const sandbox = await Sandbox.start({ config: { rpcPort: 3030 } });
const root = new Account(DEFAULT_ACCOUNT_ID, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);
const create = async (name, near) => {
  const key = KeyPair.fromRandom('ed25519');
  const accountId = `${name}.${DEFAULT_ACCOUNT_ID}`;
  await root.signAndSendTransaction({
    receiverId: accountId,
    actions: [actions.createAccount(), actions.transfer(near * NEAR), actions.addFullAccessKey(key.getPublicKey())],
  });
  return { accountId, key };
};

const ani = await create('ani', 50n);
const budi = await create('budi', 50n);
const stand = { [C.demo_accounts.ani]: ani.accountId, [C.demo_accounts.budi]: budi.accountId };

async function launch(name, coin, delay, length) {
  const acct = await create(name, 50n);
  const allocations = Object.entries(coin.allocations).map(([id, whole]) => [stand[id], (BigInt(whole) * ONE).toString()]);
  await new Account(acct.accountId, sandbox.rpcUrl, acct.key.toString()).signAndSendTransaction({
    receiverId: acct.accountId,
    actions: [
      actions.deployContract(new Uint8Array(readFileSync(WASM))),
      actions.functionCall('new', {
        name: coin.name, symbol: coin.symbol,
        opening_price: (BigInt(C.opening_price) * ONE).toString(),
        decay_delay_s: delay, decay_length_s: length,
        faucet_amount: (BigInt(C.faucet_amount) * ONE).toString(),
        allocations,
      }, 100_000_000_000_000n, 0n),
      actions.deleteKey(acct.key.getPublicKey()),
    ],
  });
  return acct.accountId;
}

const demo = await launch('demo', C.coins.demo, fast ? 20 : C.coins.demo.decay_delay_s, fast ? 40 : C.coins.demo.decay_length_s);
const main = await launch('main', C.coins.main, C.coins.main.decay_delay_s, C.coins.main.decay_length_s);

const env = {
  VITE_NEAR_RPC_URL: sandbox.rpcUrl,
  VITE_DEMO_CONTRACT_ID: demo,
  VITE_MAIN_CONTRACT_ID: main,
  VITE_ANI_ACCOUNT_ID: ani.accountId,
  VITE_BUDI_ACCOUNT_ID: budi.accountId,
  VITE_EXPLORER: '0',
  NEAR_RPC_URL: sandbox.rpcUrl,
  DEMO_CONTRACT_ID: demo,
  ANI_ACCOUNT_ID: ani.accountId,
  BUDI_ACCOUNT_ID: budi.accountId,
  ANI_FULL_KEY: ani.key.toString(),
  BUDI_FULL_KEY: budi.key.toString(),
  VOICE_SECRET: randomBytes(32).toString('hex'),
};
writeFileSync(join(ROOT, 'web/.env.local'), `# Written by scripts/dev-chain.mjs for a LOCAL sandbox. Not testnet keys.\n${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
console.log(`sandbox ${sandbox.rpcUrl} · demo ${demo} · main ${main} · wrote web/.env.local`);
console.log('ready');

const stop = async () => {
  await sandbox.tearDown();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
