// App config. Account names and numbers come from reference/constants.json (via the
// generated lib/reference.ts); VITE_* overrides exist only for a local sandbox.
import { announcementLines, constants } from './lib/reference';

export type CoinKey = 'demo' | 'main';
export type Who = 'ani' | 'budi';

export const RPC_URL = import.meta.env.VITE_NEAR_RPC_URL || constants.rpc;
export const NETWORK = constants.network;

export const COINS: Record<CoinKey, { key: CoinKey; contractId: string; label: string; symbol: string }> = {
  demo: {
    key: 'demo',
    contractId: import.meta.env.VITE_DEMO_CONTRACT_ID || constants.coins.demo.account,
    label: 'Demo coin',
    symbol: constants.coins.demo.symbol,
  },
  main: {
    key: 'main',
    contractId: import.meta.env.VITE_MAIN_CONTRACT_ID || constants.coins.main.account,
    label: 'Main coin',
    symbol: constants.coins.main.symbol,
  },
};

export const DEMO_ACCOUNTS: Record<Who, string> = {
  ani: import.meta.env.VITE_ANI_ACCOUNT_ID || constants.demo_accounts.ani,
  budi: import.meta.env.VITE_BUDI_ACCOUNT_ID || constants.demo_accounts.budi,
};

export const DEMO_LINES: readonly number[] = announcementLines.demo_buttons;
export const TOTAL_SUPPLY_WHOLE = constants.total_supply;
export const FACE_COUNT = constants.face_parts.bg * constants.face_parts.eyes * constants.face_parts.mouth * constants.face_parts.extra;
export const TAKE_SEAT_NEAR = constants.take_seat_attached_near;
export const STORAGE_DEPOSIT_NEAR = constants.storage_deposit_near;
export const FAUCET_WHOLE = constants.faucet_amount;

export const EXPLORER_ON = import.meta.env.VITE_EXPLORER !== '0';
export const explorerTx = (hash: string) => constants.explorer_tx.replace('{hash}', hash);
export const explorerAccount = (account: string) => constants.explorer_account.replace('{account}', account);
export const NEARBLOCKS_API = 'https://api-testnet.nearblocks.io/v3';
export const REPO_URL = 'https://github.com/cto-takeover/cto-memecoin';
