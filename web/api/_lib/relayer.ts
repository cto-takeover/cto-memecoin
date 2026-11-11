// Demo relayer (spec 3). Signs for ani and budi on the demo coin only:
// `take_seat` as the account, `announce` as the coin with a derived voice key.
// NEAR's answers are returned unedited.
import { KeyPair, KeyPairSigner, actions, baseDecode, createTransaction, type KeyPairString } from 'near-api-js';
import { WHO, type RelayerConfig, type Who } from './config.js';
import { fromFailure, fromRpcError, relayerError, type ApiError } from '../../src/lib/near-errors.js';
import { findVoiceKey, parseSecret, voiceKeyPair } from './keys.js';
import { Rpc, RpcFailure, type RpcResponse } from './rpc.js';

export interface Reply {
  status: number;
  body: unknown;
}

export interface Deps {
  config: RelayerConfig;
  rpc: Rpc;
  limiter: RateLimiter;
  now: () => number;
  log: (line: string) => void;
  /** Called right before a transaction is signed (tests count it). */
  onSign?: () => void;
}

const TAKE_SEAT_GAS = 100_000_000_000_000n; // 100 Tgas: batch on the coin + callback
const ANNOUNCE_GAS = 30_000_000_000_000n;
const HISTORY_PAGE = 50;

const fail = (status: number, error: ApiError): Reply => ({ status, body: { error } });
const bad = (message: string) => fail(400, relayerError('BadRequest', message));

// ------------------------------------------------------------------ rate limits

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastTakeover = -Infinity;

  /** Sliding one-minute window per IP. Returns true if this request is allowed. */
  allow(ip: string, perMinute: number, now: number): boolean {
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    const ok = recent.length < perMinute;
    if (ok) recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 10_000) this.hits.clear(); // demo-sized memory bound
    return ok;
  }

  /** One takeover per `gapMs` overall. Returns ms to wait, or 0 and claims the slot. */
  claimTakeover(gapMs: number, now: number): number {
    const wait = this.lastTakeover + gapMs - now;
    if (wait > 0) return wait;
    this.lastTakeover = now;
    return 0;
  }
}

// ------------------------------------------------------------------- validation

type Body = Record<string, unknown>;

function onlyKeys(body: Body, allowed: string[]): string | undefined {
  return Object.keys(body).find((k) => !allowed.includes(k));
}

/** Optional `contract` / `method` fields must name the only allowed target. */
function checkTarget(body: Body, config: RelayerConfig, method: string): string | undefined {
  if ('contract' in body && body.contract !== config.contractId) {
    return `contract must be ${config.contractId}`;
  }
  if ('method' in body && body.method !== method) return `method must be ${method}`;
  return undefined;
}

function checkWho(value: unknown): value is Who {
  return typeof value === 'string' && (WHO as readonly string[]).includes(value);
}

export interface Face {
  bg: number;
  eyes: number;
  mouth: number;
  extra: number;
}

function parseFace(value: unknown, parts: number): Face | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const f = value as Body;
  const names = ['bg', 'eyes', 'mouth', 'extra'];
  if (Object.keys(f).length !== 4 || onlyKeys(f, names)) return undefined;
  for (const n of names) {
    const v = f[n];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= parts) return undefined;
  }
  return f as unknown as Face;
}

export function validateTakeSeat(body: Body, config: RelayerConfig): { who: Who; face: Face; maxPrice: string } | string {
  const extra = onlyKeys(body, ['as', 'face', 'maxPrice', 'contract', 'method']);
  if (extra) return `unknown field ${JSON.stringify(extra)}`;
  const target = checkTarget(body, config, 'take_seat');
  if (target) return target;
  if (!checkWho(body.as)) return `as must be one of ${WHO.join(', ')}`;
  const face = parseFace(body.face, config.facePartCount);
  if (!face) return `face must be {bg, eyes, mouth, extra}, each 0-${config.facePartCount - 1}`;
  if (typeof body.maxPrice !== 'string' || !/^[0-9]{1,39}$/.test(body.maxPrice)) {
    return 'maxPrice must be a base-unit amount as a string of digits';
  }
  return { who: body.as, face, maxPrice: body.maxPrice };
}

export function validateAnnounce(body: Body, config: RelayerConfig): { who: Who; line: number } | string {
  const extra = onlyKeys(body, ['as', 'line', 'contract', 'method']);
  if (extra) return `unknown field ${JSON.stringify(extra)}`;
  const target = checkTarget(body, config, 'announce');
  if (target) return target;
  if (!checkWho(body.as)) return `as must be one of ${WHO.join(', ')}`;
  if (typeof body.line !== 'number' || !config.demoLines.includes(body.line)) {
    return `line must be one of ${config.demoLines.join(', ')}`;
  }
  return { who: body.as, line: body.line };
}

// ---------------------------------------------------------------- chain helpers

interface Takeover {
  index: number;
  ceo: string;
  voice_key: string;
}

/** Newest takeover first, paging through get_history until `match` hits. */
async function findTakeover(rpc: Rpc, contractId: string, match: (t: Takeover) => boolean): Promise<Takeover | undefined> {
  for (let from = 0; ; from += HISTORY_PAGE) {
    const page = await rpc.view<Takeover[]>(contractId, 'get_history', { from_index: from, limit: HISTORY_PAGE });
    const hit = page.find(match);
    if (hit || page.length < HISTORY_PAGE) return hit;
  }
}

async function historyLength(rpc: Rpc, contractId: string): Promise<number> {
  const newest = await rpc.view<Takeover[]>(contractId, 'get_history', { from_index: 0, limit: 1 });
  return newest.length ? newest[0].index + 1 : 0;
}

type Sent = { ok: true; txHash: string; logs: string[] } | { ok: false; error: ApiError; txHash?: string };

/**
 * Signs and broadcasts. If NEAR has no such key we still sign and send (with a
 * placeholder nonce and a fresh block hash), so the rejection comes from NEAR's
 * transaction validation and not from a client-side lookup.
 */
async function signAndSend(
  deps: Deps,
  signerId: string,
  keyPair: KeyPair,
  receiverId: string,
  txActions: ReturnType<typeof actions.functionCall>[],
): Promise<Sent> {
  const publicKey = keyPair.getPublicKey();
  const key = await deps.rpc.accessKey(signerId, publicKey.toString());
  // No such key: any nonce will do, since NEAR rejects the key before it looks at
  // the nonce. Use the one a key added now would start at (height × 10^6).
  const [nonce, blockHash] = key.found
    ? [key.nonce + 1n, key.blockHash]
    : await deps.rpc.finalBlock().then((b) => [BigInt(b.height) * 1_000_000n, b.hash] as const);
  const tx = createTransaction(signerId, publicKey, receiverId, nonce, txActions, baseDecode(blockHash));
  deps.onSign?.();
  const { signedTransaction: signed } = await new KeyPairSigner(keyPair).signTransaction(tx);
  const response: RpcResponse = await deps.rpc.sendTx(Buffer.from(signed.encode()).toString('base64'));
  if (response.error) return { ok: false, error: fromRpcError(response.error) };
  const result = response.result;
  const txHash: string = result.transaction.hash;
  if (result.status && 'Failure' in result.status) {
    return { ok: false, error: fromFailure(result.status.Failure), txHash };
  }
  const logs: string[] = [
    ...(result.transaction_outcome?.outcome?.logs ?? []),
    ...(result.receipts_outcome ?? []).flatMap((r: any) => r.outcome?.logs ?? []),
  ];
  return { ok: true, txHash, logs };
}

function eventData(logs: string[], event: string): any | undefined {
  for (const line of logs) {
    if (!line.startsWith('EVENT_JSON:')) continue;
    try {
      const e = JSON.parse(line.slice('EVENT_JSON:'.length));
      if (e.standard === 'cto' && e.event === event) return e.data?.[0];
    } catch {
      // not ours
    }
  }
  return undefined;
}

function nearReply(deps: Deps, what: string, sent: Extract<Sent, { ok: false }>): Reply {
  deps.log(`${what} rejected ${sent.error.type}${sent.txHash ? ` tx ${sent.txHash}` : ''}`);
  return { status: 200, body: { error: sent.error, ...(sent.txHash ? { txHash: sent.txHash } : {}) } };
}

function readFailure(e: unknown): Reply {
  if (e instanceof RpcFailure) return fail(502, fromRpcError(e.raw));
  return fail(500, relayerError('Internal', e instanceof Error ? e.message : String(e)));
}

/** The account's full-access key, or the reply to send when it is missing. Tagged, not
 * `instanceof`: near-api-js's KeyPairEd25519 is not an instance of its exported KeyPair. */
function signerFor(config: RelayerConfig, who: Who): { key: KeyPair } | { reply: Reply } {
  const name = `${who.toUpperCase()}_FULL_KEY`;
  const key = config.accounts[who].fullKey;
  if (!key) return { reply: fail(503, relayerError('NotConfigured', `${name} is not set`)) };
  try {
    return { key: KeyPair.fromString(key as KeyPairString) };
  } catch {
    return { reply: fail(503, relayerError('NotConfigured', `${name} is not a valid key`)) };
  }
}

function secretOk(config: RelayerConfig): Reply | undefined {
  try {
    parseSecret(config.voiceSecret);
    return undefined;
  } catch (e) {
    return fail(503, relayerError('NotConfigured', (e as Error).message));
  }
}

// ---------------------------------------------------------------------- handlers

export async function state(deps: Deps): Promise<Reply> {
  const { rpc, config } = deps;
  try {
    const account = async (who: Who) => {
      const id = config.accounts[who].accountId;
      const [cto, near] = await Promise.all([
        rpc.view<string>(config.contractId, 'ft_balance_of', { account_id: id }),
        rpc.nearBalance(id),
      ]);
      return { account: id, cto, near };
    };
    const [seat, ani, budi] = await Promise.all([
      rpc.view<any>(config.contractId, 'get_seat'),
      account('ani'),
      account('budi'),
    ]);
    return {
      status: 200,
      body: {
        ani,
        budi,
        ceo: seat.vacant ? null : seat.ceo,
        price: seat.current_price,
        decaySecondsLeft: seat.seconds_until_decay,
      },
    };
  } catch (e) {
    return readFailure(e);
  }
}

export async function takeSeat(deps: Deps, body: Body, ip: string): Promise<Reply> {
  const { config, rpc, limiter } = deps;
  if (!limiter.allow(ip, config.rateLimitPerMin, deps.now())) {
    return fail(429, relayerError('RateLimited', `at most ${config.rateLimitPerMin} requests a minute`));
  }
  const req = validateTakeSeat(body, config);
  if (typeof req === 'string') return bad(req);
  const notReady = secretOk(config);
  if (notReady) return notReady;
  const signer = signerFor(config, req.who);
  if ('reply' in signer) return signer.reply;

  const wait = limiter.claimTakeover(config.takeoverGapMs, deps.now());
  if (wait > 0) {
    return fail(429, relayerError('RateLimited', `one takeover every ${config.takeoverGapMs / 1000} s, try again in ${Math.ceil(wait / 1000)} s`));
  }

  const accountId = config.accounts[req.who].accountId;
  try {
    const index = await historyLength(rpc, config.contractId);
    const voice = voiceKeyPair(config.voiceSecret!, accountId, index);
    const call = actions.functionCall(
      'take_seat',
      { face: req.face, new_ceo_key: voice.getPublicKey().toString(), max_price: req.maxPrice },
      TAKE_SEAT_GAS,
      config.takeSeatDepositYocto,
    );
    const sent = await signAndSend(deps, accountId, signer.key, config.contractId, [call]);
    if (!sent.ok) return nearReply(deps, 'take-seat', sent);
    const takeoverIndex: number | undefined = eventData(sent.logs, 'seat_taken')?.takeover_index;
    deps.log(`take-seat ok tx ${sent.txHash}`);
    return { status: 200, body: { txHash: sent.txHash, takeoverIndex } };
  } catch (e) {
    return readFailure(e);
  }
}

export async function announce(deps: Deps, body: Body, ip: string): Promise<Reply> {
  const { config, rpc, limiter } = deps;
  if (!limiter.allow(ip, config.rateLimitPerMin, deps.now())) {
    return fail(429, relayerError('RateLimited', `at most ${config.rateLimitPerMin} requests a minute`));
  }
  const req = validateAnnounce(body, config);
  if (typeof req === 'string') return bad(req);
  const notReady = secretOk(config);
  if (notReady) return notReady;

  const accountId = config.accounts[req.who].accountId;
  try {
    // This account's latest takeover: its key is the live one if it is still CEO,
    // or the one NEAR deleted when it was pushed out.
    const latest = await findTakeover(rpc, config.contractId, (t) => t.ceo === accountId);
    if (!latest) return fail(409, relayerError('NeverCeo', `${accountId} has never held the seat`));
    const voice = findVoiceKey(config.voiceSecret!, accountId, latest.index, latest.voice_key);
    if (!voice) {
      return fail(409, relayerError('NoMatchingKey', `the key ${accountId} installed was not made by this relayer`));
    }
    const call = actions.functionCall('announce', { line: req.line }, ANNOUNCE_GAS, 0n);
    const sent = await signAndSend(deps, config.contractId, voice, config.contractId, [call]);
    if (!sent.ok) return nearReply(deps, 'announce', sent);
    const announcementIndex: number | undefined = eventData(sent.logs, 'announcement')?.index;
    deps.log(`announce ok tx ${sent.txHash}`);
    return { status: 200, body: { txHash: sent.txHash, announcementIndex } };
  } catch (e) {
    return readFailure(e);
  }
}
