// Polls the coin's views every 3 s for every screen: one source, no invented numbers.
// The seat and announcements are read on every poll. Supply, total burned and
// history only change with a takeover, so they are read again when the seat
// changes (new CEO or new since_ns), and at least every 30 s. That keeps a visitor
// at 2 RPC calls per poll instead of 5, well inside public RPC rate limits.
import { createContext, useContext, useRef, type ReactNode } from 'react';
import { usePoll } from './hooks';
import { view, viewAccessKeyList } from '../lib/rpc';
import type { Announcement, ConfigView, SeatView, Takeover } from '../lib/types';

export interface CoinState {
  seat: SeatView;
  supply: string;
  burned: string;
  history: Takeover[];
  announcements: Announcement[];
  /** When this snapshot was read (ms), to tick countdowns between polls. */
  readAt: number;
}

interface CoinData {
  contractId: string;
  state: CoinState | undefined;
  error: unknown;
  config: ConfigView | undefined;
  fullAccessKeys: number | undefined;
  refresh: () => Promise<CoinState | undefined>;
}

const Ctx = createContext<CoinData | null>(null);

export function CoinDataProvider({ contractId, children }: { contractId: string; children: ReactNode }) {
  const slow = useRef<{ key: string; at: number; supply: string; burned: string; history: Takeover[] } | null>(null);
  const poll = usePoll<CoinState>(
    async () => {
      const [seat, announcements] = await Promise.all([
        view<SeatView>(contractId, 'get_seat'),
        view<Announcement[]>(contractId, 'get_announcements', { limit: 20 }),
      ]);
      const key = `${contractId}|${seat.ceo}|${seat.since_ns}`;
      let rest = slow.current;
      if (!rest || rest.key !== key || Date.now() - rest.at > 30_000) {
        const [supply, burned, history] = await Promise.all([
          view<string>(contractId, 'ft_total_supply'),
          view<string>(contractId, 'total_burned'),
          view<Takeover[]>(contractId, 'get_history', { from_index: 0, limit: 8 }),
        ]);
        rest = { key, at: Date.now(), supply, burned, history };
        slow.current = rest;
      }
      return { seat, supply: rest.supply, burned: rest.burned, history: rest.history, announcements, readAt: Date.now() };
    },
    3000,
    [contractId],
  );
  const config = usePoll(() => view<ConfigView>(contractId, 'get_config'), null, [contractId]);
  const keys = usePoll(
    async () => (await viewAccessKeyList(contractId)).filter((k) => k.access_key.permission === 'FullAccess').length,
    30_000,
    [contractId],
  );
  return (
    <Ctx.Provider
      value={{
        contractId,
        state: poll.data,
        error: poll.error,
        config: config.data,
        fullAccessKeys: keys.data,
        refresh: poll.refresh,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCoinData(): CoinData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCoinData outside CoinDataProvider');
  return v;
}
