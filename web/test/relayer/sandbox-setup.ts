// Global setup for the relayer tests: a local NEAR sandbox with the real
// contract (../target/near/cto/cto.wasm) deployed as the demo coin, launched
// with the demo numbers from constants.json, and its deployer key deleted.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { Account, KeyPair, actions } from 'near-api-js';
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from 'near-sandbox';
import { constants } from '../../src/lib/reference.js';

export interface SandboxInfo {
  rpcUrl: string;
  contractId: string;
  ani: { accountId: string; fullKey: string };
  budi: { accountId: string; fullKey: string };
}

declare module 'vitest' {
  export interface ProvidedContext {
    sandbox: SandboxInfo;
  }
}

const ROOT = join(import.meta.dirname, '../../..');
const WASM = join(ROOT, 'target/near/cto/cto.wasm');
const ONE_CTO = 10n ** 18n;
const NEAR = 10n ** 24n;

/** Reuse the sandbox binary the Rust tests already downloaded, if there is one. */
function cachedBinary(): string | undefined {
  const build = join(ROOT, 'target/debug/build');
  if (!existsSync(build)) return undefined;
  for (const dir of readdirSync(build).filter((d) => d.startsWith('near-sandbox-'))) {
    const nearDir = join(build, dir, 'out/.near');
    if (!existsSync(nearDir)) continue;
    for (const v of readdirSync(nearDir)) {
      const bin = join(nearDir, v, 'near-sandbox');
      if (existsSync(bin)) return bin;
    }
  }
  return undefined;
}

export default async function setup(project: TestProject) {
  if (!existsSync(WASM)) {
    throw new Error(`missing ${WASM}: run cargo near build non-reproducible-wasm --manifest-path contract/Cargo.toml`);
  }
  const bin = cachedBinary();
  if (bin && !process.env.NEAR_SANDBOX_BIN_PATH) process.env.NEAR_SANDBOX_BIN_PATH = bin;

  const sandbox = await Sandbox.start({});
  const root = new Account(DEFAULT_ACCOUNT_ID, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY);

  const create = async (name: string, near: bigint) => {
    const key = KeyPair.fromRandom('ed25519');
    const accountId = `${name}.${DEFAULT_ACCOUNT_ID}`;
    await root.signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.createAccount(), actions.transfer(near * NEAR), actions.addFullAccessKey(key.getPublicKey())],
    });
    return { accountId, key };
  };
  const demo = await create('demo', 50n);
  const ani = await create('ani', 20n);
  const budi = await create('budi', 20n);

  // The demo coin's launch numbers, with ani and budi standing in for the testnet accounts.
  const coin = constants.coins.demo;
  const stand: Record<string, string> = { [constants.demo_accounts.ani]: ani.accountId, [constants.demo_accounts.budi]: budi.accountId };
  const allocations = Object.entries(coin.allocations).map(([id, whole]) => [stand[id], (BigInt(whole) * ONE_CTO).toString()]);
  const demoAccount = new Account(demo.accountId, sandbox.rpcUrl, demo.key.toString() as any);
  await demoAccount.signAndSendTransaction({
    receiverId: demo.accountId,
    actions: [
      actions.deployContract(new Uint8Array(readFileSync(WASM))),
      actions.functionCall(
        'new',
        {
          name: coin.name,
          symbol: coin.symbol,
          opening_price: (BigInt(constants.opening_price) * ONE_CTO).toString(),
          decay_delay_s: coin.decay_delay_s,
          decay_length_s: coin.decay_length_s,
          faucet_amount: (BigInt(constants.faucet_amount) * ONE_CTO).toString(),
          allocations,
        },
        100_000_000_000_000n,
        0n,
      ),
      // No full-access key left on the coin, as on testnet.
      actions.deleteKey(demo.key.getPublicKey()),
    ],
  });

  project.provide('sandbox', {
    rpcUrl: sandbox.rpcUrl,
    contractId: demo.accountId,
    ani: { accountId: ani.accountId, fullKey: ani.key.toString() },
    budi: { accountId: budi.accountId, fullKey: budi.key.toString() },
  });

  return async () => {
    await sandbox.tearDown();
  };
}
