// JSON shapes of the contract's views (contract/src/lib.rs). Amounts are base-unit strings.
import type { Face } from './faces';

export interface SeatView {
  vacant: boolean;
  ceo: string | null;
  paid: string | null;
  current_price: string;
  next_payout: string;
  next_burned: string;
  floor: string;
  since_ns: string | null;
  face: Face;
  face_id: number;
  voice_key: string | null;
  seconds_until_decay: number;
  decaying: boolean;
}

export interface ConfigView {
  name: string;
  symbol: string;
  decimals: number;
  total_supply_at_launch: string;
  opening_price: string;
  decay_delay_s: number;
  decay_length_s: number;
  faucet_amount: string;
  take_seat_deposit: string;
  voice_key_allowance: string;
  voice_key_method: string;
  announcements_kept: number;
  announcement_lines: number;
  history_page_max: number;
  takeover_ratio: string;
  payout_ratio: string;
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
  at_ns: string;
  block_height: number;
}

export interface Announcement {
  index: number;
  ceo: string;
  line: number;
  text: string;
  at_ns: string;
}

export interface FaucetStatus {
  pool_left: string;
  claimed: boolean;
  amount: string;
}

export interface AccessKeyInfo {
  public_key: string;
  access_key: {
    nonce: number;
    permission: 'FullAccess' | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
  };
}
