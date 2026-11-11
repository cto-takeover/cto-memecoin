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
  /** Minimum time between two takeovers through this relayer instance. */
  takeoverGapMs: number;
  /** Extra origins allowed besides the app's own (comma list in APP_ORIGINS). */
  allowedOrigins: string[];
}

/** "0.25" NEAR -> yoctoNEAR, exact. */
export function nearToYocto(near: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,24}))?$/.exec(near);
  if (!m) throw new Error(`not a NEAR amount: ${near}`);
  return BigInt(m[1]) * 10n ** 24n + BigInt((m[2] ?? '').padEnd(24, '0'));
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
    takeoverGapMs: 10_000,
    allowedOrigins: (env.APP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
