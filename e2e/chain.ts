// Keyless chain reads for the e2e tests, plus a signing budget that keeps the
// tests inside the demo relayer's limits (6 signing requests per minute per IP,
// one takeover per 10 s overall; spec 3).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import constants from '../reference/constants.json' with { type: 'json' };

export const S = {
  rpc: process.env.E2E_RPC_URL || constants.rpc,
  demo: process.env.E2E_DEMO_ID || constants.coins.demo.account,
  main: process.env.E2E_MAIN_ID || constants.coins.main.account,
  ani: process.env.E2E_ANI_ID || constants.demo_accounts.ani,
  budi: process.env.E2E_BUDI_ID || constants.demo_accounts.budi,
  /** Off only for a local sandbox, which no explorer indexes. */
  explorer: process.env.E2E_EXPLORER !== '0',
};

export interface Face {
  bg: number;
  eyes: number;
  mouth: number;
  extra: number;
}
export interface Seat {
  ceo: string | null;
  vacant: boolean;
  face: Face;
  current_price: string;
  paid: string | null;
}
export interface Takeover {
  index: number;
  ceo: string;
  previous_ceo: string | null;
  paid: string;
  payout: string;
  burned: string;
  face: Face;
  voice_key: string;
}
export interface Announcement {
  index: number;
  line: number;
  text: string;
  ceo: string;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(S.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'e2e', method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result as T;
}

export async function view<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>('query', {
    request_type: 'call_function',
    finality: 'optimistic',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(r.result).toString('utf8')) as T;
}

export const seat = (c = S.demo) => view<Seat>(c, 'get_seat');
export const supply = (c = S.demo) => view<string>(c, 'ft_total_supply').then(BigInt);
export const history = (limit = 2, c = S.demo) => view<Takeover[]>(c, 'get_history', { from_index: 0, limit });
export const announcements = (limit = 1, c = S.demo) => view<Announcement[]>(c, 'get_announcements', { limit });
export const balance = (account: string, c = S.demo) => view<string>(c, 'ft_balance_of', { account_id: account }).then(BigInt);
export const config = (c: string) => view<Record<string, unknown>>(c, 'get_config');
export async function fullAccessKeys(c: string): Promise<number> {
  const r = await rpc<{ keys: { access_key: { permission: unknown } }[] }>('query', { request_type: 'view_access_key_list', finality: 'final', account_id: c });
  return r.keys.filter((k) => k.access_key.permission === 'FullAccess').length;
}
/** The transaction's final status, to prove a link points at a real, successful tx. */
export const txStatus = (hash: string, sender: string) =>
  rpc<{ status: Record<string, unknown> }>('tx', { tx_hash: hash, sender_account_id: sender, wait_until: 'EXECUTED_OPTIMISTIC' });

const ONE = 10n ** 18n;
/** Whole CTO with commas, rounded down: the app's `cto()`. */
export const cto = (base: string | bigint) => (BigInt(base) / ONE).toLocaleString('en-US');

export type Who = 'ani' | 'budi';
export const demoWho = (account: string | null): Who | undefined => (account === S.ani ? 'ani' : account === S.budi ? 'budi' : undefined);
/** Whoever is not CEO takes the seat (ani if it is vacant). */
export function taker(s: Seat): { who: Who; account: string } {
  return s.ceo === S.ani ? { who: 'budi', account: S.budi } : { who: 'ani', account: S.ani };
}

// ------------------------------------------------------------------ signing budget

const LEDGER = join(tmpdir(), `cto-e2e-signing-${S.demo}.json`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until one more signing request (and, for takeovers, the 10 s gap) is allowed. */
export async function budget(kind: 'take-seat' | 'announce'): Promise<void> {
  for (;;) {
    const now = Date.now();
    const raw: { t: number; kind: string }[] = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : [];
    const recent = raw.filter((e) => now - e.t < 61_000);
    const lastTake = Math.max(0, ...recent.filter((e) => e.kind === 'take-seat').map((e) => e.t));
    const waitRate = recent.length >= 5 ? recent[0].t + 61_000 - now : 0;
    const waitGap = kind === 'take-seat' && lastTake ? lastTake + 11_000 - now : 0;
    const wait = Math.max(waitRate, waitGap);
    if (wait <= 0) {
      writeFileSync(LEDGER, JSON.stringify([...recent, { t: now, kind }]));
      return;
    }
    await sleep(wait + 50);
  }
}
