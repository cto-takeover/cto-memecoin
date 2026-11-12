// Layer 3 (spec 4): the relayer against the real contract in a local sandbox.
import { createHmac, createPrivateKey, createPublicKey } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { Account, KeyPair, KeyPairSigner, actions, baseDecode, baseEncode, createTransaction, type KeyPairString } from 'near-api-js';
import { configFromEnv, type RelayerConfig } from '../../api/_lib/config.js';
import { serve } from '../../api/_lib/http.js';
import { voiceKeyPair } from '../../api/_lib/keys.js';
import { RateLimiter, announce, state, takeSeat, type Deps } from '../../api/_lib/relayer.js';
import { Rpc } from '../../api/_lib/rpc.js';

const sb = inject('sandbox');
const SECRET = 'a1'.repeat(32);
const ONE = 10n ** 18n;
const cto = (whole: number) => (BigInt(whole) * ONE).toString();
const rpc = new Rpc(sb.rpcUrl);

function setup(over: Partial<RelayerConfig> = {}) {
  const counter = { signs: 0 };
  const logs: string[] = [];
  const config: RelayerConfig = {
    ...configFromEnv({}),
    rpcUrls: [sb.rpcUrl],
    contractId: sb.contractId,
    accounts: { ani: sb.ani, budi: sb.budi },
    voiceSecret: SECRET,
    rateLimitPerMin: 1_000,
    takeoverGapMs: 0,
    ...over,
  };
  const deps: Deps = {
    config,
    rpc,
    limiter: new RateLimiter(),
    now: () => Date.now(),
    log: (l) => logs.push(l),
    onSign: () => void counter.signs++,
  };
  return { deps, counter, logs };
}

type Handler = typeof takeSeat;
/** A POST as the app's own page sends it (same-origin, with Origin). `undefined` drops a header. */
async function post(deps: Deps, handler: Handler, body: unknown, headers: Record<string, string | undefined> = {}) {
  const all: Record<string, string | undefined> = {
    'content-type': 'application/json',
    'x-forwarded-for': '10.0.0.1',
    origin: 'https://relayer.test',
    host: 'relayer.test',
    ...headers,
  };
  const req = new Request('https://relayer.test/api/demo', {
    method: 'POST',
    headers: Object.fromEntries(Object.entries(all).filter((e): e is [string, string] => e[1] !== undefined)),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await serve(req, handler, deps);
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

const balance = (id: string) => rpc.view<string>(sb.contractId, 'ft_balance_of', { account_id: id }).then(BigInt);
const face = { bg: 1, eyes: 2, mouth: 3, extra: 7 };

describe('refused before signing', () => {
  const { deps, counter } = setup();

  const cases: [string, Handler, unknown][] = [
    ['other contract', takeSeat, { as: 'ani', face, maxPrice: cto(1_000_000), contract: 'cto.testnet' }],
    ['other method', takeSeat, { as: 'ani', face, maxPrice: cto(1_000_000), method: 'ft_transfer' }],
    ['other method on announce', announce, { as: 'ani', line: 1, method: 'take_seat' }],
    ['other account', takeSeat, { as: 'carol', face, maxPrice: cto(1_000_000) }],
    ['account id instead of name', announce, { as: sb.ani.accountId, line: 1 }],
    ['line outside the demo buttons', announce, { as: 'ani', line: 7 }],
    ['line 0', announce, { as: 'ani', line: 0 }],
    ['line as a string', announce, { as: 'ani', line: '3' }],
    ['free text', announce, { as: 'ani', line: 1, text: 'hi' }],
    ['bad face part', takeSeat, { as: 'ani', face: { ...face, extra: 8 }, maxPrice: cto(1_000_000) }],
    ['missing maxPrice', takeSeat, { as: 'ani', face }],
    ['numeric maxPrice', takeSeat, { as: 'ani', face, maxPrice: 1_000_000 }],
    ['not JSON', takeSeat, '{as:'],
    ['array body', announce, [1]],
    ['negative takeoverIndex', announce, { as: 'ani', line: 3, takeoverIndex: -1 }],
    ['fractional takeoverIndex', announce, { as: 'ani', line: 3, takeoverIndex: 0.5 }],
    ['takeoverIndex as a string', announce, { as: 'ani', line: 3, takeoverIndex: '0' }],
  ];
  for (const [name, handler, body] of cases) {
    it(`${name} -> 400`, async () => {
      const r = await post(deps, handler, body);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatchObject({ source: 'relayer', type: 'BadRequest' });
    });
  }

  it('signed nothing', () => expect(counter.signs).toBe(0));

  it('7th request in a minute from one IP -> 429', async () => {
    const { deps, counter } = setup({ rateLimitPerMin: 6 });
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await post(deps, announce, { as: 'ani', line: 99 }, { 'x-forwarded-for': '203.0.113.7' })).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 429]);
    const limited = await post(deps, announce, { as: 'ani', line: 99 }, { 'x-forwarded-for': '203.0.113.7' });
    expect(limited.body.error.retryAfterS).toBeGreaterThan(0);
    expect(limited.body.error.retryAfterS).toBeLessThanOrEqual(60);
    expect(limited.headers.get('retry-after')).toBe(String(limited.body.error.retryAfterS));
    expect((await post(deps, announce, { as: 'ani', line: 99 }, { 'x-forwarded-for': '203.0.113.8' })).status).toBe(400);
    expect(counter.signs).toBe(0);
  });

  it('a second takeover inside 10 s -> 429', async () => {
    const { deps, counter } = setup({ takeoverGapMs: 10_000 });
    deps.limiter.claimTakeover(10_000, Date.now());
    const r = await post(deps, takeSeat, { as: 'ani', face, maxPrice: cto(1_000_000) });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toContain('one takeover every 10 s');
    expect(r.body.error.retryAfterS).toBeGreaterThan(0);
    expect(r.headers.get('retry-after')).toBe(String(r.body.error.retryAfterS));
    expect(counter.signs).toBe(0);
  });

  it('a POST without an Origin header -> 403', async () => {
    const r = await post(deps, announce, { as: 'ani', line: 1 }, { origin: undefined });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ source: 'relayer', type: 'Forbidden' });
  });

  it('another origin -> 403', async () => {
    const r = await post(deps, announce, { as: 'ani', line: 1 }, { origin: 'https://elsewhere.example', host: 'relayer.test' });
    expect(r.status).toBe(403);
  });

  it('missing secrets -> 503, nothing signed', async () => {
    const { deps, counter } = setup({ voiceSecret: undefined });
    expect((await post(deps, announce, { as: 'ani', line: 1 })).status).toBe(503);
    const noKey = setup({ accounts: { ani: { accountId: sb.ani.accountId, fullKey: undefined }, budi: sb.budi } });
    const r = await post(noKey.deps, takeSeat, { as: 'ani', face, maxPrice: cto(1_000_000) });
    expect(r.status).toBe(503);
    expect(r.body.error.message).toBe('ANI_FULL_KEY is not set');
    expect(counter.signs + noKey.counter.signs).toBe(0);
  });
});

describe('the demo story through the relayer', () => {
  const { deps, logs } = setup();
  let aniStart = 0n;
  let budiStart = 0n;

  beforeAll(async () => {
    aniStart = await balance(sb.ani.accountId);
    budiStart = await balance(sb.budi.accountId);
  });

  it('an account that never held the seat cannot post', async () => {
    const r = await post(deps, announce, { as: 'budi', line: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error.type).toBe('NeverCeo');
  });

  it('/state shows a vacant seat at the opening price', async () => {
    const r = await state(deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ceo: null, price: cto(1_000_000), ani: { account: sb.ani.accountId, cto: aniStart.toString() } });
  });

  it('ani takes the vacant seat', async () => {
    const r = await post(deps, takeSeat, { as: 'ani', face: { bg: 0, eyes: 0, mouth: 0, extra: 0 }, maxPrice: cto(1_000_000) });
    expect(r.body.error).toBeUndefined();
    expect(r.body).toMatchObject({ takeoverIndex: 0, txHash: expect.any(String) });
    const [t] = await rpc.view<any[]>(sb.contractId, 'get_history', { from_index: 0, limit: 1 });
    expect(t.voice_key).toBe(voiceKeyPair(SECRET, sb.ani.accountId, 0).getPublicKey().toString());
  });

  it('ani posts as the coin', async () => {
    const r = await post(deps, announce, { as: 'ani', line: 1 });
    expect(r.body).toEqual({ txHash: expect.any(String), announcementIndex: 0 });
    const [a] = await rpc.view<any[]>(sb.contractId, 'get_announcements', { limit: 1 });
    expect(a).toMatchObject({ ceo: sb.ani.accountId, line: 1 });
    expect(a.text).toContain('1,400,000');
  });

  it("a stale max price comes back as NEAR's own error, balance unchanged", async () => {
    const r = await post(deps, takeSeat, { as: 'budi', face, maxPrice: cto(1_000_000) });
    expect(r.status).toBe(200);
    expect(r.body.txHash).toEqual(expect.any(String));
    expect(r.body.error).toMatchObject({ source: 'near', type: 'ActionError.kind.FunctionCallError.ExecutionError' });
    expect(r.body.error.message).toContain('CTO: price moved to 1,400,000 CTO, above your max 1,000,000');
    expect(await balance(sb.budi.accountId)).toBe(budiStart);
  });

  it('budi takes over: ani +1,150,000', async () => {
    const r = await post(deps, takeSeat, { as: 'budi', face, maxPrice: cto(1_400_000) });
    expect(r.body.error).toBeUndefined();
    expect(r.body.takeoverIndex).toBe(1);
    expect(await balance(sb.ani.accountId)).toBe(aniStart - 1_000_000n * ONE + 1_150_000n * ONE);
    expect(await balance(sb.budi.accountId)).toBe(budiStart - 1_400_000n * ONE);
  });

  it("ani's old key: NEAR rejects it with AccessKeyNotFound, unedited", async () => {
    const r = await post(deps, announce, { as: 'ani', line: 3 });
    expect(r.status).toBe(200);
    expect(r.body.txHash).toBeUndefined();
    const err = r.body.error;
    expect(err.source).toBe('near');
    expect(err.type).toBe('InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound');
    const oldKey = voiceKeyPair(SECRET, sb.ani.accountId, 0).getPublicKey().toString();
    expect(JSON.parse(err.message)).toEqual({ account_id: sb.contractId, public_key: oldKey });

    // The same call sent straight to the sandbox, with the key derived independently
    // (node:crypto, no relayer code): NEAR's error must match field for field.
    const direct = await sendDirect(deriveIndependently(SECRET, sb.ani.accountId, 0), 3);
    expect(direct.error).toEqual(err.raw);
  });

  it('budi posts and the post appears', async () => {
    const r = await post(deps, announce, { as: 'budi', line: 6 });
    expect(r.body).toEqual({ txHash: expect.any(String), announcementIndex: 1 });
    const [a] = await rpc.view<any[]>(sb.contractId, 'get_announcements', { limit: 1 });
    expect(a).toMatchObject({ ceo: sb.budi.accountId, line: 6 });
    expect(a.text).toBe('1,250,000 CTO burned so far. Supply only goes down.');
  });

  it('/state names budi as CEO at 1,960,000', async () => {
    const r = await state(deps);
    expect(r.body).toMatchObject({ ceo: sb.budi.accountId, price: cto(1_960_000) });
    expect(Number((r.body as any).decaySecondsLeft)).toBeGreaterThan(0);
  });

  it('logs hold tx hashes and error types only, never keys', () => {
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l).not.toMatch(/ed25519:|secret/i);
    expect(logs.join('\n')).toContain('announce rejected InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound');
  });
});

describe('announce pinned to a takeover (takeoverIndex)', () => {
  const { deps, counter } = setup();

  // State after the story: #0 ani took the vacant seat, #1 budi took over, budi is CEO.
  it('ani takes the seat back (#2): her latest key is live again', async () => {
    const r = await post(deps, takeSeat, { as: 'ani', face, maxPrice: cto(1_960_000) });
    expect(r.body.error).toBeUndefined();
    expect(r.body.takeoverIndex).toBe(2);
  });

  it("ani's key from #0 is still rejected by NEAR when pinned, though her latest key works", async () => {
    const pinned = await post(deps, announce, { as: 'ani', line: 3, takeoverIndex: 0 });
    expect(pinned.status).toBe(200);
    expect(pinned.body.error).toMatchObject({ source: 'near', type: 'InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound' });
    const oldKey = voiceKeyPair(SECRET, sb.ani.accountId, 0).getPublicKey().toString();
    expect(JSON.parse(pinned.body.error.message)).toEqual({ account_id: sb.contractId, public_key: oldKey });

    const latest = await post(deps, announce, { as: 'ani', line: 1 });
    expect(latest.body.error).toBeUndefined();
    expect(latest.body.txHash).toEqual(expect.any(String));
  });

  it('pinned to the live takeover (#2), ani posts', async () => {
    const r = await post(deps, announce, { as: 'ani', line: 5, takeoverIndex: 2 });
    expect(r.body.error).toBeUndefined();
    expect(r.body.announcementIndex).toEqual(expect.any(Number));
  });

  it("another account's takeover -> 409 NeverCeo, nothing signed", async () => {
    const before = counter.signs;
    const r = await post(deps, announce, { as: 'ani', line: 3, takeoverIndex: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ source: 'relayer', type: 'NeverCeo' });
    expect(r.body.error.message).toContain(sb.budi.accountId);
    const none = await post(deps, announce, { as: 'ani', line: 3, takeoverIndex: 99 });
    expect(none.status).toBe(409);
    expect(none.body.error.type).toBe('NeverCeo');
    expect(counter.signs).toBe(before);
  });

  it('a key this relayer did not make -> 409 NoMatchingKey, nothing signed', async () => {
    // budi takes the seat straight from his own account, with a key the relayer never derived.
    const budi = new Account(sb.budi.accountId, sb.rpcUrl, sb.budi.fullKey as KeyPairString);
    await budi.signAndSendTransaction({
      receiverId: sb.contractId,
      actions: [
        actions.functionCall(
          'take_seat',
          { face, new_ceo_key: KeyPair.fromRandom('ed25519').getPublicKey().toString(), max_price: cto(2_744_000) },
          100_000_000_000_000n,
          250_000_000_000_000_000_000_000n,
        ),
      ],
    });
    const [t] = await rpc.view<any[]>(sb.contractId, 'get_history', { from_index: 0, limit: 1 });
    expect(t).toMatchObject({ index: 3, ceo: sb.budi.accountId });
    const before = counter.signs;
    const r = await post(deps, announce, { as: 'budi', line: 3, takeoverIndex: 3 });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ source: 'relayer', type: 'NoMatchingKey' });
    expect(counter.signs).toBe(before);
  });
});

describe('takeover guards read from chain', () => {
  // The seat now: budi since a moment ago (#3), price 3,841,600.
  const run = async (over: Partial<RelayerConfig>) => {
    const { deps, counter } = setup(over);
    const r = await post(deps, takeSeat, { as: 'ani', face, maxPrice: cto(4_000_000) });
    // A refused takeover gives the in-memory slot back.
    expect(deps.limiter.claimTakeover(60_000, Date.now())).toBe(0);
    expect(counter.signs).toBe(0);
    return r;
  };

  it('price above capX × floor -> 409 PriceCap with the wait', async () => {
    const r = await run({ priceCapMilli: 2_000n });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ source: 'relayer', type: 'PriceCap' });
    expect(r.body.error.message).toBe(`The price is 3,841,600 CTO, above the demo cap of 2,000,000 CTO. It falls under the cap in ${r.body.error.retryAfterS} s.`);
    // Decay: 120 s delay, then 180 s down to the floor. 2,000,000 is reached 117 s in (ceil(1,841,600 × 180 / 2,841,600)).
    expect(r.body.error.retryAfterS).toBeGreaterThan(200);
    expect(r.body.error.retryAfterS).toBeLessThanOrEqual(120 + 117 + 1);
    expect(r.headers.get('retry-after')).toBe(String(r.body.error.retryAfterS));
  });

  it('a takeover inside the gap on chain -> 429, on a fresh instance too', async () => {
    const r = await run({ takeoverGapMs: 3_600_000 });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatchObject({ source: 'relayer', type: 'RateLimited' });
    expect(r.body.error.retryAfterS).toBeGreaterThan(3_500);
  });

  it('the hourly cap counts takeovers from get_history -> 429', async () => {
    const r = await run({ takeoversPerHour: 4 });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toContain('4 takeovers an hour');
    expect(r.body.error.retryAfterS).toBeGreaterThan(3_500);
  });

  it('a signing account under the NEAR reserve -> 503 LowFunds, logged', async () => {
    const { deps, counter, logs } = setup({ minNearYocto: 10n ** 30n });
    const r = await post(deps, takeSeat, { as: 'ani', face, maxPrice: cto(4_000_000) });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatchObject({ source: 'relayer', type: 'LowFunds' });
    expect(r.body.error.message).toContain(sb.ani.accountId);
    expect(logs).toContain(`low funds ${sb.ani.accountId}`);
    expect(counter.signs).toBe(0);
  });
});

function deriveIndependently(secretHex: string, accountId: string, index: number): KeyPair {
  const seed = createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${accountId}:${index}`).digest();
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const x = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'jwk' }).x!;
  return KeyPair.fromString(`ed25519:${baseEncode(Buffer.concat([seed, Buffer.from(x, 'base64url')]))}` as KeyPairString);
}

async function sendDirect(key: KeyPair, line: number) {
  const { hash } = await rpc.finalBlock();
  const tx = createTransaction(sb.contractId, key.getPublicKey(), sb.contractId, 1n, [
    actions.functionCall('announce', { line }, 30_000_000_000_000n, 0n),
  ], baseDecode(hash));
  const { signedTransaction: signed } = await new KeyPairSigner(key).signTransaction(tx);
  return rpc.sendTx(Buffer.from(signed.encode()).toString('base64'));
}
