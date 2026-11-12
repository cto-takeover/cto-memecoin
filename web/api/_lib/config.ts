// Relayer configuration. Numbers and names come from reference/constants.json
// (via the generated reference.ts); secrets come from env only.
import { announcementLines, constants } from '../../src/lib/reference.js';

export type Who = 'ani' | 'budi';
export const WHO: readonly Who[] = ['ani', 'budi'];

export interface DemoAccount {
  accountId: string;
  /** Full-access secret key, `ed25519:...`. Testnet throwaway, env only. */
  fullKey: string | undefined;
}

export interface RelayerConfig {
  /** JSON-RPC endpoints, tried in order (see src/lib/jsonrpc.ts). */
  rpcUrls: string[];
  /** The only contract the relayer will ever sign for. */
  contractId: string;
  accounts: Record<Who, DemoAccount>;
  /** 32 bytes as 64 hex chars; seeds the derived voice keys. */
  voiceSecret: string | undefined;
  /** Line numbers the demo buttons may post. */
  demoLines: readonly number[];
  facePartCount: number;
  takeSeatDepositYocto: bigint;
  /** Signing requests per IP per minute. */
  rateLimitPerMin: number;
  /** /state reads per IP per minute (the CDN absorbs most of them first). */
  stateRateLimitPerMin: number;
  /** Minimum time between two takeovers: checked against the seat's since_ns on chain,
   * and in memory per instance as an extra guard. */
  takeoverGapMs: number;
  /** The relayer refuses a takeover priced above capX × floor (DEMO_PRICE_CAP_X, default 4),
   * as thousandths so the bigint math stays exact: 4 -> 4000. */
  priceCapMilli: bigint;
  /** Takeovers per rolling hour on the coin, counted from get_history (DEMO_TAKEOVERS_PER_HOUR, default 20, max 50). */
  takeoversPerHour: number;
  /** A demo account below this many yoctoNEAR is not used to sign (DEMO_MIN_NEAR, default 2). */
  minNearYocto: bigint;
  /** take_seat's price ratio (top = paid × num / den), from constants.json. */
  takeoverRatio: { num: bigint; den: bigint };
  /** Extra origins allowed besides the app's own (comma list in APP_ORIGINS). */
  allowedOrigins: string[];
}

/** "0.25" NEAR -> yoctoNEAR, exact. */
export function nearToYocto(near: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,24}))?$/.exec(near);
  if (!m) throw new Error(`not a NEAR amount: ${near}`);
  return BigInt(m[1]) * 10n ** 24n + BigInt((m[2] ?? '').padEnd(24, '0'));
}

/** A positive number from env, or the default when unset or not a number in range. */
function envNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): RelayerConfig {
  return {
    rpcUrls: env.NEAR_RPC_URL ? [env.NEAR_RPC_URL] : [constants.rpc, constants.rpc_fallback],
    contractId: env.DEMO_CONTRACT_ID || constants.coins.demo.account,
    accounts: {
      ani: { accountId: env.ANI_ACCOUNT_ID || constants.demo_accounts.ani, fullKey: env.ANI_FULL_KEY },
      budi: { accountId: env.BUDI_ACCOUNT_ID || constants.demo_accounts.budi, fullKey: env.BUDI_FULL_KEY },
    },
    voiceSecret: env.VOICE_SECRET,
    demoLines: announcementLines.demo_buttons,
    facePartCount: constants.face_parts.bg,
    takeSeatDepositYocto: nearToYocto(constants.take_seat_attached_near),
    rateLimitPerMin: 6,
    stateRateLimitPerMin: 30,
    takeoverGapMs: 10_000,
    priceCapMilli: BigInt(Math.round(envNumber(env.DEMO_PRICE_CAP_X, 4, 1, 1_000_000) * 1000)),
    takeoversPerHour: Math.floor(envNumber(env.DEMO_TAKEOVERS_PER_HOUR, 20, 1, constants.history_page_max)),
    minNearYocto: nearToYocto(envNumber(env.DEMO_MIN_NEAR, 2, 0, 1_000_000).toFixed(6)),
    takeoverRatio: { num: BigInt(constants.takeover_ratio.num), den: BigInt(constants.takeover_ratio.den) },
    allowedOrigins: (env.APP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
