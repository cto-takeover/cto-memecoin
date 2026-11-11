// Layer 4 of spec 4: keyless checks against the deployed coins over JSON-RPC.
//
//   node verify/live.mjs            prints the live lines on their own
//   import { liveLines } from './live.mjs'   used by verify/run.mjs
//
// Env overrides (for a local sandbox, e.g. after `npm run dev:chain`):
//   NEAR_RPC_URL, MAIN_CONTRACT_ID, DEMO_CONTRACT_ID, CTO_WASM (default res/cto.wasm)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = JSON.parse(readFileSync(join(ROOT, 'reference/constants.json'), 'utf8'));
const ONE = 10n ** BigInt(C.decimals);
const NO_CODE = '11111111111111111111111111111111';

export function settings(env = process.env) {
  return {
    // Tried in order on rate limits or network errors; an override has no fallback.
    rpcs: env.NEAR_RPC_URL ? [env.NEAR_RPC_URL] : [C.rpc, C.rpc_fallback],
    main: env.MAIN_CONTRACT_ID || C.coins.main.account,
    demo: env.DEMO_CONTRACT_ID || C.coins.demo.account,
    wasm: env.CTO_WASM || join(ROOT, 'res/cto.wasm'),
  };
}

// ------------------------------------------------------------------ helpers

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes) {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export const codeHashOf = (file) => base58(createHash('sha256').update(readFileSync(file)).digest());

/** Whole decimal amount ("0.25") times 10^decimals, exactly. */
function units(whole, decimals) {
  const [i, f = ''] = String(whole).split('.');
  return (BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
}

const commas = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const whole = (base) => commas(BigInt(base) / ONE) + (BigInt(base) % ONE ? '.' + (BigInt(base) % ONE).toString().padStart(C.decimals, '0').replace(/0+$/, '') : '');

class Rpc {
  constructor(urls) {
    this.urls = urls;
  }
  /** One read; a rate limit, 5xx or network error tries the next endpoint (3 rounds). */
  async call(method, params) {
    let last;
    for (let i = 0; i < 3 * this.urls.length; i++) {
      const url = this.urls[i % this.urls.length];
      if (i >= this.urls.length) await new Promise((r) => setTimeout(r, 1000 * Math.floor(i / this.urls.length)));
      let res, body;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'verify', method, params }),
          signal: AbortSignal.timeout(20_000),
        });
        body = await res.json();
      } catch (e) {
        last = new Error(`${url}: ${e.message}`);
        continue;
      }
      if (res.status === 429 || body.error?.code === -429 || (res.status >= 500 && !body.error?.name)) {
        last = new Error(`${url}: ${JSON.stringify(body.error ?? body)}`);
        continue;
      }
      if (body.error) {
        const e = new Error(JSON.stringify(body.error));
        e.rpc = body.error;
        throw e;
      }
      return body.result;
    }
    throw last;
  }
  query(params) {
    return this.call('query', { finality: 'final', ...params });
  }
  async view(account_id, method_name, args = {}) {
    const r = await this.query({ request_type: 'call_function', account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    return JSON.parse(Buffer.from(r.result).toString('utf8'));
  }
}

/** null if the account does not exist or holds no contract. */
async function deployed(rpc, id) {
  try {
    const a = await rpc.query({ request_type: 'view_account', account_id: id });
    return a.code_hash === NO_CODE ? null : a;
  } catch (e) {
    if (JSON.stringify(e.rpc ?? '').includes('UNKNOWN_ACCOUNT')) return null;
    throw e;
  }
}

async function allHistory(rpc, id) {
  const out = [];
  for (let from = 0; ; from += C.history_page_max) {
    const page = await rpc.view(id, 'get_history', { from_index: from, limit: C.history_page_max });
    out.push(...page);
    if (page.length < C.history_page_max) return out;
  }
}

function expectedConfig(coin) {
  return {
    name: coin.name,
    symbol: coin.symbol,
    decimals: C.decimals,
    total_supply_at_launch: units(C.total_supply, C.decimals),
    opening_price: units(C.opening_price, C.decimals),
    decay_delay_s: coin.decay_delay_s,
    decay_length_s: coin.decay_length_s,
    faucet_amount: units(C.faucet_amount, C.decimals),
    take_seat_deposit: units(C.take_seat_attached_near, 24),
    voice_key_allowance: units(C.voice_key_allowance_near, 24),
    voice_key_method: 'announce',
    announcements_kept: C.announcements_kept,
    announcement_lines: C.announcement_lines,
    history_page_max: C.history_page_max,
    takeover_ratio: `${C.takeover_ratio.num}/${C.takeover_ratio.den}`,
    payout_ratio: `${C.payout_ratio_of_payment.num}/${C.payout_ratio_of_payment.den}`,
  };
}

const configDiff = (want, got) =>
  Object.keys({ ...want, ...got })
    .filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]))
    .map((k) => `get_config.${k}: expected ${JSON.stringify(want[k])}, got ${JSON.stringify(got[k])}`);

// ------------------------------------------------------------------ the checks

/**
 * Every check is { status: 'PASS'|'FAIL'|'SKIP', detail?: string[] }.
 * Returns the four live lines of the 12, plus `icon`, which verify/run.mjs
 * folds into "face changes in ft_metadata".
 */
export async function liveChecks(s = settings()) {
  const rpc = new Rpc(s.rpcs);
  const coins = [
    { id: s.main, rules: C.coins.main },
    { id: s.demo, rules: C.coins.demo },
  ];
  for (const c of coins) {
    try {
      c.account = await deployed(rpc, c.id);
    } catch (e) {
      c.error = `RPC: ${e.message}`;
    }
  }
  const live = coins.filter((c) => c.account);
  const skip = { status: 'SKIP', note: 'not deployed yet' };
  const errorOf = (c) => ({ status: 'FAIL', detail: [c.error] });

  const keysLine = async (c) => {
    if (c.error) return errorOf(c);
    if (!c.account) return skip;
    const { keys } = await rpc.query({ request_type: 'view_access_key_list', account_id: c.id });
    const full = keys.filter((k) => k.access_key.permission === 'FullAccess');
    const fc = keys.filter((k) => k.access_key.permission !== 'FullAccess');
    const detail = [];
    if (full.length) detail.push(`expected 0 full-access keys, got ${full.length}: ${full.map((k) => k.public_key).join(', ')}`);
    if (fc.length > 1) detail.push(`expected at most one function-call key, got ${fc.length}`);
    for (const k of fc) {
      const p = k.access_key.permission.FunctionCall;
      if (p.receiver_id !== c.id || p.method_names.join() !== 'announce') {
        detail.push(`key ${k.public_key}: expected receiver ${c.id} method announce, got ${p.receiver_id} [${p.method_names.join(', ')}]`);
      }
    }
    return detail.length ? { status: 'FAIL', detail } : { status: 'PASS' };
  };

  const all = async (fn) => {
    const broken = coins.find((c) => c.error);
    if (broken) return errorOf(broken);
    if (!live.length) return skip;
    const detail = (await Promise.all(live.map(fn))).flat();
    return detail.length ? { status: 'FAIL', detail } : { status: 'PASS' };
  };

  const codeLine = () =>
    all(async (c) => {
      if (!existsSync(s.wasm)) return [`${relative(ROOT, s.wasm) || s.wasm} is missing, so ${c.id}'s code hash ${c.account.code_hash} cannot be checked`];
      const want = codeHashOf(s.wasm);
      const out = [];
      if (c.account.code_hash !== want) out.push(`${c.id} code hash: expected ${want}, got ${c.account.code_hash}`);
      const got = await rpc.view(c.id, 'get_config');
      out.push(...configDiff(expectedConfig(c.rules), got).map((d) => `${c.id} ${d}`));
      return out;
    });

  const supplyLine = () =>
    all(async (c) => {
      const [supply, history] = await Promise.all([rpc.view(c.id, 'ft_total_supply'), allHistory(rpc, c.id)]);
      const burned = history.reduce((sum, t) => sum + BigInt(t.burned), 0n);
      const want = BigInt(units(C.total_supply, C.decimals)) - burned;
      return BigInt(supply) === want ? [] : [`${c.id} ft_total_supply: expected ${whole(want)} (burned ${whole(burned)}), got ${whole(supply)}`];
    });

  const iconLine = () =>
    all(async (c) => {
      const [seat, meta] = await Promise.all([rpc.view(c.id, 'get_seat'), rpc.view(c.id, 'ft_metadata')]);
      const svg = await rpc.view(c.id, 'face_svg', { face: seat.face });
      const icon = Buffer.from(String(meta.icon).replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8');
      return icon === svg ? [] : [`${c.id} ft_metadata.icon does not decode to face_svg(get_seat.face)`];
    });

  const guard = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      return { status: 'FAIL', detail: [`RPC: ${e.message}`] };
    }
  };

  return {
    keysMain: { line: `full-access keys on ${s.main}: 0`, ...(await guard(() => keysLine(coins[0]))) },
    keysDemo: { line: `full-access keys on ${s.demo}: 0`, ...(await guard(() => keysLine(coins[1]))) },
    code: { line: `deployed code matches res/cto.wasm`, ...(await guard(codeLine)) },
    supply: { line: `total supply = ${commas(C.total_supply)} - burned`, ...(await guard(supplyLine)) },
    icon: await guard(iconLine),
  };
}

export function format({ line, status, note, detail = [] }) {
  const out = [`${status}  ${line}${status === 'SKIP' && note ? `  (${note})` : ''}`];
  for (const d of detail) out.push(`      ${d}`);
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await liveChecks();
  const lines = [r.keysMain, r.keysDemo, r.code, r.supply, { line: 'face in ft_metadata = face_svg(seat.face)', ...r.icon }];
  for (const l of lines) console.log(format(l));
  process.exit(lines.some((l) => l.status === 'FAIL') ? 1 : 0);
}
