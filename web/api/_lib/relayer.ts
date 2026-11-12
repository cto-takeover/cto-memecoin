// Demo relayer (spec 3). Signs for ani and budi on the demo coin only:
// `take_seat` as the account, `announce` as the coin with a derived voice key.
// NEAR's answers are returned unedited.
import { KeyPair, KeyPairSigner, actions, baseDecode, baseEncode, createTransaction, type KeyPairString } from 'near-api-js';
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
const ONE_CTO = 10n ** 18n;
const NS_PER_S = 1_000_000_000n;
const bad = (message: string) => fail(400, relayerError('BadRequest', message));

// ------------------------------------------------------------------ rate limits

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastTakeover = -Infinity;
  private beforeClaim = -Infinity;

  /**
   * Sliding one-minute window per key (an IP). Returns 0 and counts the request if
   * it is allowed, or the ms until the window frees a slot.
   */
  wait(key: string, perMinute: number, now: number): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    let wait = 0;
    if (recent.length < perMinute) recent.push(now);
    else wait = Math.max(1, recent[recent.length - perMinute] + 60_000 - now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear(); // demo-sized memory bound
    return wait;
  }

  /** Same as `wait`, as a yes/no. */
  allow(key: string, perMinute: number, now: number): boolean {
    return this.wait(key, perMinute, now) === 0;
  }

  /** One takeover per `gapMs` on this instance. Returns ms to wait, or 0 and claims the slot. */
  claimTakeover(gapMs: number, now: number): number {
    const wait = this.lastTakeover + gapMs - now;
    if (wait > 0) return wait;
    this.beforeClaim = this.lastTakeover;
    this.lastTakeover = now;
    return 0;
  }

  /** Gives the slot back after a takeover that was refused or failed. */
  releaseTakeover(): void {
    this.lastTakeover = this.beforeClaim;
  }
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

function rateLimited(deps: Deps, ip: string, key = ip, perMinute = deps.config.rateLimitPerMin): Reply | undefined {
  const wait = deps.limiter.wait(key, perMinute, deps.now());
  if (!wait) return undefined;
  const s = seconds(wait);
  return fail(429, relayerError('RateLimited', `at most ${perMinute} requests a minute, try again in ${s} s`, s));
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

export function validateAnnounce(
  body: Body,
  config: RelayerConfig,
): { who: Who; line: number; takeoverIndex?: number } | string {
  const extra = onlyKeys(body, ['as', 'line', 'takeoverIndex', 'contract', 'method']);
  if (extra) return `unknown field ${JSON.stringify(extra)}`;
  const target = checkTarget(body, config, 'announce');
  if (target) return target;
  if (!checkWho(body.as)) return `as must be one of ${WHO.join(', ')}`;
  if (typeof body.line !== 'number' || !config.demoLines.includes(body.line)) {
    return `line must be one of ${config.demoLines.join(', ')}`;
  }
  if ('takeoverIndex' in body) {
    const i = body.takeoverIndex;
    if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 0 || i > 0xffff_ffff) {
      return 'takeoverIndex must be a non-negative integer';
    }
    return { who: body.as, line: body.line, takeoverIndex: i };
  }
  return { who: body.as, line: body.line };
}

// ---------------------------------------------------------------- chain helpers

export interface Takeover {
  index: number;
  ceo: string;
  previous_ceo?: string | null;
  voice_key: string;
  at_ns: string;
}

/** The fields of get_seat the guards read. */
export interface SeatInfo {
  vacant: boolean;
  ceo: string | null;
  paid: string | null;
  current_price: string;
  since_ns: string | null;
  seconds_until_decay: number;
  decaying: boolean;
}

/** The fields of get_config the guards read. */
export interface CoinConfig {
  opening_price: string;
  decay_delay_s: number;
  decay_length_s: number;
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

/** Takeover number `index` on its own. get_history counts back from the newest. */
async function takeoverAt(rpc: Rpc, contractId: string, index: number): Promise<Takeover | undefined> {
  let len = await historyLength(rpc, contractId);
  for (let tries = 0; tries < 3; tries++) {
    if (index >= len) return undefined;
    const [t] = await rpc.view<Takeover[]>(contractId, 'get_history', { from_index: len - 1 - index, limit: 1 });
    if (!t || t.index === index) return t;
    len += t.index - index; // takeovers landed in between: shift and read again
  }
  return undefined;
}

// --------------------------------------------------------- guards from chain state
// These hold on every serverless instance, because they read the chain, not memory.

/** 1_400_000 × 10^18 -> "1,400,000" (whole CTO, rounded down). */
export function wholeCto(amount: bigint): string {
  return (amount / ONE_CTO).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const nearText = (yocto: bigint) => (Number(yocto / 10n ** 22n) / 100).toFixed(2);

/** The highest price the relayer will pay for a takeover: capX × floor. */
export function priceCap(config: RelayerConfig, floor: bigint): bigint {
  return (floor * config.priceCapMilli) / 1000n;
}

/**
 * Seconds until the seat's price is at or below `cap`, following the contract's
 * linear decay (contract/src/price.rs):
 *   price = top - floor((top - F) × min(idle - D, L) / L)   once idle > D
 * so price <= cap from idle = D + k, k = ceil((top - cap) × L / (top - F)).
 * One extra second covers the contract counting whole seconds of block time.
 */
export function secondsUntilPriceAtMost(
  seat: SeatInfo,
  coin: CoinConfig,
  ratio: RelayerConfig['takeoverRatio'],
  cap: bigint,
  nowMs: number,
): number {
  if (seat.vacant || seat.paid === null) return 0;
  const floor = BigInt(coin.opening_price);
  const top = (BigInt(seat.paid) * ratio.num) / ratio.den;
  const need = top - cap;
  if (need <= 0n) return 0;
  const D = coin.decay_delay_s;
  const L = coin.decay_length_s;
  const span = top - floor;
  // A cap below the floor is never reached; report the time to the full floor.
  const k = span > 0n && need <= span ? Number((need * BigInt(L) + span - 1n) / span) : L;
  const idle = seat.decaying
    ? Math.max(D, Math.floor((nowMs - Number(BigInt(seat.since_ns ?? '0') / 1_000_000n)) / 1000))
    : D - seat.seconds_until_decay;
  return Math.max(1, D + k - idle + 1);
}

export interface ChainSnapshot {
  seat: SeatInfo;
  coin: CoinConfig;
  /** get_history(from_index 0, limit 50): the newest takeovers first. */
  recent: Takeover[];
  /** The signing account's NEAR balance in yoctoNEAR. */
  nearYocto: bigint;
}

/** The refusal for a takeover right now, or undefined if it may go ahead. */
export function chainGuard(deps: Deps, snap: ChainSnapshot, accountId: string): Reply | undefined {
  const { config } = deps;
  const nowMs = deps.now();
  const nowNs = BigInt(Math.floor(nowMs)) * 1_000_000n;

  // One takeover per gap on the whole coin, measured from the seat's since_ns.
  if (!snap.seat.vacant && snap.seat.since_ns) {
    const left = Number(BigInt(snap.seat.since_ns) / 1_000_000n) + config.takeoverGapMs - nowMs;
    if (left > 0) {
      const s = seconds(left);
      return fail(429, relayerError('RateLimited', `one takeover every ${config.takeoverGapMs / 1000} s, try again in ${s} s`, s));
    }
  }

  // At most N takeovers in any rolling hour (get_history is newest first).
  const hourNs = 3600n * NS_PER_S;
  const inHour = snap.recent.filter((t) => nowNs - BigInt(t.at_ns) < hourNs);
  if (inHour.length >= config.takeoversPerHour) {
    // Below the limit again once the Nth newest leaves the window.
    const pivot = BigInt(inHour[config.takeoversPerHour - 1].at_ns);
    const s = Math.max(1, Math.ceil(Number(pivot + hourNs - nowNs) / 1e9));
    return fail(429, relayerError('RateLimited', `the demo allows ${config.takeoversPerHour} takeovers an hour, try again in ${s} s`, s));
  }

  // The relayer never pays more than capX × floor.
  const cap = priceCap(config, BigInt(snap.coin.opening_price));
  const price = BigInt(snap.seat.current_price);
  if (price > cap) {
    const s = secondsUntilPriceAtMost(snap.seat, snap.coin, config.takeoverRatio, cap, nowMs);
    return fail(
      409,
      relayerError('PriceCap', `The price is ${wholeCto(price)} CTO, above the demo cap of ${wholeCto(cap)} CTO. It falls under the cap in ${s} s.`, s),
    );
  }

  // Keep a NEAR reserve on the signing account.
  if (snap.nearYocto < config.minNearYocto) {
    deps.log(`low funds ${accountId}`);
    return fail(
      503,
      relayerError('LowFunds', `${accountId} is low on NEAR (${nearText(snap.nearYocto)} left, needs ${nearText(config.minNearYocto)}). Demo takeovers are paused until it is topped up.`),
    );
  }
  return undefined;
}

// --------------------------------------------------------------------- signing

type Sent =
  | { ok: true; txHash: string; logs: string[] }
  /** `unknown`: the transaction was sent but its outcome is not known (NEAR may run it). */
  | { ok: false; error: ApiError; txHash?: string; unknown?: boolean };

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
  const { signedTransaction: signed, txHash: hashBytes } = await new KeyPairSigner(keyPair).signTransaction(tx);
  const localHash = baseEncode(hashBytes);
  let response: RpcResponse;
  try {
    response = await deps.rpc.sendTx(Buffer.from(signed.encode()).toString('base64'));
  } catch (e) {
    // Network failure or timeout after signing: NEAR may still execute it.
    const why = e instanceof Error ? e.message : String(e);
    return { ok: false, unknown: true, txHash: localHash, error: relayerError('Internal', `relayer lost NEAR's reply (${why}); check the explorer`) };
  }
  if (response.error) {
    // NEAR's own TIMEOUT_ERROR: the transaction is in flight, so its hash is worth showing.
    const inFlight = response.error?.cause?.name === 'TIMEOUT_ERROR';
    return { ok: false, error: fromRpcError(response.error), ...(inFlight ? { txHash: localHash, unknown: true } : {}) };
  }
  const result = response.result;
  const txHash: string = result.transaction?.hash ?? localHash;
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

function failedReply(deps: Deps, what: string, sent: Extract<Sent, { ok: false }>): Reply {
  const tx = sent.txHash ? { txHash: sent.txHash } : {};
  if (sent.error.source === 'relayer') {
    deps.log(`${what} lost reply${sent.txHash ? ` tx ${sent.txHash}` : ''}`);
    return { status: 504, body: { error: sent.error, ...tx } };
  }
  deps.log(`${what} rejected ${sent.error.type}${sent.txHash ? ` tx ${sent.txHash}` : ''}`);
  return { status: 200, body: { error: sent.error, ...tx } };
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

/** GET /state per IP: the CDN serves most reads, this stops a flood that bypasses it. */
export function stateRateLimited(deps: Deps, ip: string): Reply | undefined {
  return rateLimited(deps, ip, `state:${ip}`, deps.config.stateRateLimitPerMin);
}

export async function takeSeat(deps: Deps, body: Body, ip: string): Promise<Reply> {
  const { config, rpc, limiter } = deps;
  const limited = rateLimited(deps, ip);
  if (limited) return limited;
  const req = validateTakeSeat(body, config);
  if (typeof req === 'string') return bad(req);
  const notReady = secretOk(config);
  if (notReady) return notReady;
  const signer = signerFor(config, req.who);
  if ('reply' in signer) return signer.reply;

  // In-memory slot on this instance: an extra guard on top of the chain checks below.
  const wait = limiter.claimTakeover(config.takeoverGapMs, deps.now());
  if (wait > 0) {
    const s = seconds(wait);
    return fail(429, relayerError('RateLimited', `one takeover every ${config.takeoverGapMs / 1000} s, try again in ${s} s`, s));
  }

  // Keep the slot only if the seat changed, or might have (reply lost).
  let keepSlot = false;
  const accountId = config.accounts[req.who].accountId;
  try {
    const [seat, coin, recent, near] = await Promise.all([
      rpc.view<SeatInfo>(config.contractId, 'get_seat'),
      rpc.view<CoinConfig>(config.contractId, 'get_config'),
      rpc.view<Takeover[]>(config.contractId, 'get_history', { from_index: 0, limit: HISTORY_PAGE }),
      rpc.nearBalance(accountId),
    ]);
    const refused = chainGuard(deps, { seat, coin, recent, nearYocto: BigInt(near) }, accountId);
    if (refused) return refused;

    const index = recent.length ? recent[0].index + 1 : 0;
    const voice = voiceKeyPair(config.voiceSecret!, accountId, index);
    // Never sign for more than the cap, even if someone takes the seat in between.
    const cap = priceCap(config, BigInt(coin.opening_price));
    const maxPrice = BigInt(req.maxPrice) < cap ? req.maxPrice : cap.toString();
    const call = actions.functionCall(
      'take_seat',
      { face: req.face, new_ceo_key: voice.getPublicKey().toString(), max_price: maxPrice },
      TAKE_SEAT_GAS,
      config.takeSeatDepositYocto,
    );
    const sent = await signAndSend(deps, accountId, signer.key, config.contractId, [call]);
    if (!sent.ok) {
      keepSlot = sent.unknown === true;
      return failedReply(deps, 'take-seat', sent);
    }
    keepSlot = true;
    const takeoverIndex: number | undefined = eventData(sent.logs, 'seat_taken')?.takeover_index;
    deps.log(`take-seat ok tx ${sent.txHash}`);
    return { status: 200, body: { txHash: sent.txHash, takeoverIndex } };
  } catch (e) {
    return readFailure(e);
  } finally {
    if (!keepSlot) limiter.releaseTakeover();
  }
}

export async function announce(deps: Deps, body: Body, ip: string): Promise<Reply> {
  const { config, rpc } = deps;
  const limited = rateLimited(deps, ip);
  if (limited) return limited;
  const req = validateAnnounce(body, config);
  if (typeof req === 'string') return bad(req);
  const notReady = secretOk(config);
  if (notReady) return notReady;

  const accountId = config.accounts[req.who].accountId;
  try {
    let takeover: Takeover | undefined;
    if (req.takeoverIndex !== undefined) {
      // A takeover the caller names (the Press office pins the one its tab is about),
      // so a key someone else made live again is never used by mistake.
      takeover = await takeoverAt(rpc, config.contractId, req.takeoverIndex);
      if (!takeover) return fail(409, relayerError('NeverCeo', `there is no takeover #${req.takeoverIndex}`));
      if (takeover.ceo !== accountId) {
        return fail(409, relayerError('NeverCeo', `takeover #${req.takeoverIndex} was made by ${takeover.ceo}, not ${accountId}`));
      }
    } else {
      // This account's latest takeover: its key is the live one if it is still CEO,
      // or the one NEAR deleted when it was pushed out.
      takeover = await findTakeover(rpc, config.contractId, (t) => t.ceo === accountId);
      if (!takeover) return fail(409, relayerError('NeverCeo', `${accountId} has never held the seat`));
    }
    const voice = findVoiceKey(config.voiceSecret!, accountId, takeover.index, takeover.voice_key);
    if (!voice) {
      return fail(409, relayerError('NoMatchingKey', `the key ${accountId} installed was not made by this relayer`));
    }
    const call = actions.functionCall('announce', { line: req.line }, ANNOUNCE_GAS, 0n);
    const sent = await signAndSend(deps, config.contractId, voice, config.contractId, [call]);
    if (!sent.ok) return failedReply(deps, 'announce', sent);
    const announcementIndex: number | undefined = eventData(sent.logs, 'announcement')?.index;
    deps.log(`announce ok tx ${sent.txHash}`);
    return { status: 200, body: { txHash: sent.txHash, announcementIndex } };
  } catch (e) {
    return readFailure(e);
  }
}
