// The take-seat guards and the lost-reply path against a mocked RPC: exact waits,
// the in-memory slot, Retry-After, and the /state cache header. No sandbox needed.
import { describe, expect, it } from 'vitest';
import { KeyPair } from 'near-api-js';
import { configFromEnv, type RelayerConfig } from '../../api/_lib/config.js';
import { STATE_CACHE, serve, serveState } from '../../api/_lib/http.js';
import { RateLimiter, secondsUntilPriceAtMost, takeSeat, type CoinConfig, type Deps, type SeatInfo, type Takeover } from '../../api/_lib/relayer.js';
import { Rpc, type RpcResponse } from '../../api/_lib/rpc.js';
import { RpcTimeout } from '../../src/lib/jsonrpc.js';

const ONE = 10n ** 18n;
const cto = (whole: number) => (BigInt(Math.round(whole * 1e4)) * ONE / 10_000n).toString();
const NOW = 1_800_000_000_000; // ms
const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString();
const COIN: CoinConfig = { opening_price: cto(1_000_000), decay_delay_s: 120, decay_length_s: 180 };
const face = { bg: 1, eyes: 2, mouth: 3, extra: 4 };

/** The contract's price (contract/src/price.rs), ported for checking the waits. */
function contractPrice(paid: bigint, idle: number, coin = COIN): bigint {
  const F = BigInt(coin.opening_price);
  const top = (paid * 7n) / 5n;
  if (idle <= coin.decay_delay_s) return top;
  const into = BigInt(Math.min(idle - coin.decay_delay_s, coin.decay_length_s));
  const drop = ((top - F) * into) / BigInt(coin.decay_length_s);
  const p = top - drop;
  return p > F ? p : F;
}

function seatAt(paid: bigint, idle: number, sinceMs = NOW - idle * 1000): SeatInfo {
  return {
    vacant: false,
    ceo: 'budi.test',
    paid: paid.toString(),
    current_price: contractPrice(paid, idle).toString(),
    since_ns: ns(sinceMs),
    seconds_until_decay: Math.max(0, COIN.decay_delay_s - idle),
    decaying: idle > COIN.decay_delay_s,
  };
}

interface Chain {
  seat: SeatInfo;
  history: Takeover[];
  near: bigint;
  send: () => Promise<RpcResponse>;
}

class FakeRpc extends Rpc {
  sent = 0;
  constructor(readonly chain: Chain) {
    super('http://rpc.invalid');
  }
  override async view<T = any>(_c: string, method: string, args: any = {}): Promise<T> {
    if (method === 'get_seat') return this.chain.seat as T;
    if (method === 'get_config') return COIN as T;
    if (method === 'get_history') return this.chain.history.slice(args.from_index ?? 0, (args.from_index ?? 0) + (args.limit ?? 50)) as T;
    throw new Error(`unexpected view ${method}`);
  }
  override async nearBalance(): Promise<string> {
    return this.chain.near.toString();
  }
  override async accessKey() {
    return { found: true as const, nonce: 7n, blockHash: '11111111111111111111111111111111' };
  }
  override sendTx(): Promise<RpcResponse> {
    this.sent++;
    return this.chain.send();
  }
}

const ok = (): Promise<RpcResponse> =>
  Promise.resolve({
    result: {
      transaction: { hash: 'okhash' },
      status: { SuccessValue: '' },
      receipts_outcome: [{ outcome: { logs: ['EVENT_JSON:{"standard":"cto","event":"seat_taken","data":[{"takeover_index":4}]}'] } }],
    },
  });

/** n takeovers, newest first, `everyMs` apart, the newest `newestAgoMs` ago. */
function history(n: number, newestAgoMs: number, everyMs = 60_000): Takeover[] {
  return Array.from({ length: n }, (_, i) => ({
    index: n - 1 - i,
    ceo: i % 2 ? 'ani.test' : 'budi.test',
    previous_ceo: n - 1 - i ? 'x.test' : null,
    voice_key: 'ed25519:x',
    at_ns: ns(NOW - newestAgoMs - i * everyMs),
  }));
}

function setup(chain: Partial<Chain> = {}, over: Partial<RelayerConfig> = {}) {
  const logs: string[] = [];
  const config: RelayerConfig = {
    ...configFromEnv({}),
    contractId: 'demo.test',
    accounts: {
      ani: { accountId: 'ani.test', fullKey: KeyPair.fromRandom('ed25519').toString() },
      budi: { accountId: 'budi.test', fullKey: KeyPair.fromRandom('ed25519').toString() },
    },
    voiceSecret: 'b2'.repeat(32),
    rateLimitPerMin: 1_000,
    ...over,
  };
  const rpc = new FakeRpc({ seat: seatAt(BigInt(cto(1_400_000)), 30), history: history(2, 30_000), near: 10n ** 25n, send: ok, ...chain });
  const deps: Deps = { config, rpc, limiter: new RateLimiter(), now: () => NOW, log: (l) => logs.push(l) };
  return { deps, rpc, logs };
}

async function takeOver(deps: Deps, maxPrice = cto(4_000_000)) {
  const req = new Request('https://app.test/api/demo/take-seat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://app.test', host: 'app.test', 'x-forwarded-for': '198.51.100.1' },
    body: JSON.stringify({ as: 'ani', face, maxPrice }),
  });
  const res = await serve(req, takeSeat, deps);
  return { status: res.status, body: (await res.json()) as any, retryAfter: res.headers.get('retry-after') };
}

/** True if this instance's takeover slot is free (claims it, then gives it back). */
function slotFree(deps: Deps): boolean {
  const free = deps.limiter.claimTakeover(deps.config.takeoverGapMs, deps.now()) === 0;
  if (free) deps.limiter.releaseTakeover();
  return free;
}

describe('defaults from env', () => {
  it('cap 4x, 20 an hour, 2 NEAR; env overrides; junk falls back', () => {
    const d = configFromEnv({});
    expect([d.priceCapMilli, d.takeoversPerHour, d.minNearYocto]).toEqual([4000n, 20, 2n * 10n ** 24n]);
    const e = configFromEnv({ DEMO_PRICE_CAP_X: '2.5', DEMO_TAKEOVERS_PER_HOUR: '7', DEMO_MIN_NEAR: '0.5' });
    expect([e.priceCapMilli, e.takeoversPerHour, e.minNearYocto]).toEqual([2500n, 7, 5n * 10n ** 23n]);
    const j = configFromEnv({ DEMO_PRICE_CAP_X: 'lots', DEMO_TAKEOVERS_PER_HOUR: '0', DEMO_MIN_NEAR: '-1' });
    expect([j.priceCapMilli, j.takeoversPerHour, j.minNearYocto]).toEqual([4000n, 20, 2n * 10n ** 24n]);
  });
});

describe('price cap wait follows the contract decay exactly', () => {
  const cap = BigInt(cto(4_000_000));
  const ratio = { num: 7n, den: 5n };
  for (const paidWhole of [2_744_000, 3_841_600, 5_378_240, 50_000_000]) {
    for (const idle of [0, 60, 119, 120, 121, 150, 200, 290]) {
      const paid = BigInt(cto(paidWhole));
      if (contractPrice(paid, idle) <= cap) continue;
      it(`paid ${paidWhole}, idle ${idle} s`, () => {
        const s = secondsUntilPriceAtMost(seatAt(paid, idle), COIN, ratio, cap, NOW);
        // One second of margin: at idle + s - 1 the price is under the cap, one second earlier it is not.
        expect(contractPrice(paid, idle + s - 1)).toBeLessThanOrEqual(cap);
        if (s >= 2) expect(contractPrice(paid, idle + s - 2)).toBeGreaterThan(cap);
      });
    }
  }

  it('the demo cycle allows 1M, 1.4M, 1.96M, 2.744M and 3.8416M only', () => {
    expect(contractPrice(BigInt(cto(2_744_000)), 0)).toBeLessThanOrEqual(cap);
    expect(contractPrice(BigInt(cto(3_841_600)), 0)).toBeGreaterThan(cap);
  });
});

describe('take-seat guards (mocked chain)', () => {
  it('price above the cap -> 409 PriceCap, Retry-After, nothing sent, slot released', async () => {
    const { deps, rpc } = setup({ seat: seatAt(BigInt(cto(3_841_600)), 10) });
    const r = await takeOver(deps);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ source: 'relayer', type: 'PriceCap' });
    expect(r.body.error.message).toBe(`The price is 5,378,240 CTO, above the demo cap of 4,000,000 CTO. It falls under the cap in ${r.body.error.retryAfterS} s.`);
    expect(r.retryAfter).toBe(String(r.body.error.retryAfterS));
    expect(rpc.sent).toBe(0);
    expect(slotFree(deps)).toBe(true);
  });

  it('max_price is clamped to the cap, so a race cannot cost more', async () => {
    let signedArgs: any;
    const { deps } = setup();
    const sendTx = deps.rpc.sendTx.bind(deps.rpc);
    deps.rpc.sendTx = (b64: string) => {
      signedArgs = Buffer.from(b64, 'base64').toString('latin1');
      return sendTx(b64);
    };
    const r = await takeOver(deps, cto(9_000_000));
    expect(r.body).toEqual({ txHash: 'okhash', takeoverIndex: 4 });
    expect(signedArgs).toContain(`"max_price":"${cto(4_000_000)}"`);
  });

  it('a takeover on chain inside the gap -> 429 with the exact wait', async () => {
    const { deps, rpc } = setup({ seat: seatAt(BigInt(cto(1_000_000)), 0, NOW - 3_500) });
    const r = await takeOver(deps);
    expect(r.status).toBe(429);
    expect(r.body.error).toMatchObject({ type: 'RateLimited', retryAfterS: 7 });
    expect(r.retryAfter).toBe('7');
    expect(rpc.sent).toBe(0);
    expect(slotFree(deps)).toBe(true);
  });

  it('20 takeovers in the last hour -> 429 until the 20th newest ages out', async () => {
    // Newest 10 s ago, then one a minute: the 20th newest is 10 s + 19 min old.
    const { deps } = setup({ history: history(25, 10_000) });
    const r = await takeOver(deps);
    expect(r.status).toBe(429);
    expect(r.body.error.message).toContain('20 takeovers an hour');
    expect(r.body.error.retryAfterS).toBe(3600 - 10 - 19 * 60);
    expect(slotFree(deps)).toBe(true);
  });

  it('19 in the hour is fine', async () => {
    const { deps } = setup({ history: history(19, 10_000) });
    expect((await takeOver(deps)).status).toBe(200);
  });

  it('under the NEAR reserve -> 503 LowFunds naming the account, logged', async () => {
    const { deps, logs, rpc } = setup({ near: 19n * 10n ** 23n });
    const r = await takeOver(deps);
    expect(r.status).toBe(503);
    expect(r.body.error).toEqual({ source: 'relayer', type: 'LowFunds', message: 'ani.test is low on NEAR (1.90 left, needs 2.00). Demo takeovers are paused until it is topped up.' });
    expect(logs).toContain('low funds ani.test');
    expect(rpc.sent).toBe(0);
  });

  it("NEAR refuses (price moved) -> NEAR's error as is, slot released", async () => {
    const failure = { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: CTO: price moved' } } } };
    const { deps } = setup({ send: async () => ({ result: { transaction: { hash: 'h1' }, status: { Failure: failure } } }) });
    const r = await takeOver(deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ txHash: 'h1', error: { source: 'near', raw: { Failure: failure } } });
    expect(slotFree(deps)).toBe(true);
  });

  it('a successful takeover keeps the slot', async () => {
    const { deps } = setup();
    expect((await takeOver(deps)).status).toBe(200);
    expect(slotFree(deps)).toBe(false);
  });

  it('reply lost after signing -> Internal with the local tx hash, slot kept', async () => {
    const { deps, logs } = setup({ send: () => Promise.reject(new RpcTimeout('http://rpc.invalid', 30_000)) });
    const r = await takeOver(deps);
    expect(r.status).toBe(504);
    expect(r.body.error.source).toBe('relayer');
    expect(r.body.error.type).toBe('Internal');
    expect(r.body.error.message).toContain("relayer lost NEAR's reply");
    expect(r.body.error.message).toContain('check the explorer');
    expect(r.body.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(logs.join('\n')).toContain(`take-seat lost reply tx ${r.body.txHash}`);
    expect(slotFree(deps)).toBe(false);
  });
});

describe('GET /state', () => {
  const stateDeps = (perMin = 30) => {
    const { deps } = setup({}, { stateRateLimitPerMin: perMin });
    const rpc = deps.rpc as FakeRpc;
    rpc.view = (async (_c: string, method: string) => (method === 'ft_balance_of' ? cto(1) : seatAt(BigInt(cto(1_000_000)), 5))) as any;
    return deps;
  };
  const get = (deps: Deps, ip = '192.0.2.1') =>
    serveState(new Request('https://app.test/api/demo/state', { headers: { 'x-forwarded-for': ip } }), deps);

  it('a good read is CDN-cacheable for 3 s; no Origin needed for a GET', async () => {
    const res = await get(stateDeps());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(STATE_CACHE);
    expect(STATE_CACHE).toBe('public, s-maxage=3, stale-while-revalidate=10');
  });

  it('per-IP limit -> 429 with Retry-After, not cached', async () => {
    const deps = stateDeps(2);
    await get(deps);
    await get(deps);
    const res = await get(deps);
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as any;
    expect(body.error.retryAfterS).toBe(60);
    expect(res.headers.get('retry-after')).toBe('60');
    expect((await get(deps, '192.0.2.2')).status).toBe(200);
  });

  it('a failed read is not cached', async () => {
    const deps = stateDeps();
    (deps.rpc as FakeRpc).view = (async () => {
      throw new Error('boom');
    }) as any;
    const res = await get(deps);
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
