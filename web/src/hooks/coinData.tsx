// Polls the coin's views every 3 s for every screen: one source, no invented numbers.
import { createContext, useContext, type ReactNode } from 'react';
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
  const poll = usePoll<CoinState>(
    async () => {
      const [seat, supply, burned, history, announcements] = await Promise.all([
        view<SeatView>(contractId, 'get_seat'),
        view<string>(contractId, 'ft_total_supply'),
        view<string>(contractId, 'total_burned'),
        view<Takeover[]>(contractId, 'get_history', { from_index: 0, limit: 8 }),
        view<Announcement[]>(contractId, 'get_announcements', { limit: 20 }),
      ]);
      return { seat, supply, burned, history, announcements, readAt: Date.now() };
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
