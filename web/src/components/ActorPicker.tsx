// "Play as" chips (demo mode, demo coin only) or the connected wallet.
import { DEMO_ACCOUNTS, type Who } from '../config';
import { useActorCtx, type Actor } from '../hooks/actor';
import { useCoinKey } from '../hooks/hooks';
import { cto } from '../lib/format';
import { useWallet } from '../lib/wallet';

export function ActorPicker({ actor, balances, ceo }: { actor: Actor; balances: Partial<Record<string, string>>; ceo: string | null }) {
  const { mode, setMode, setDemoWho } = useActorCtx();
  const wallet = useWallet();
  const coinKey = useCoinKey();
  const demoAvailable = coinKey === 'demo';

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {demoAvailable && mode === 'demo' ? (
          <>
            <span className="mono" style={{ fontSize: 13 }} id="play-as">
              Play as:
            </span>
            <div role="radiogroup" aria-labelledby="play-as" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(['ani', 'budi'] as Who[]).map((w) => {
                const id = DEMO_ACCOUNTS[w];
                const on = actor.mode === 'demo' && actor.who === w;
                return (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="chip"
                    onClick={() => setDemoWho(w)}
                    style={{ minHeight: 44, cursor: 'pointer', background: on ? 'var(--color-ink)' : 'var(--color-card)', color: on ? 'var(--color-paper)' : 'var(--color-ink)' }}
                  >
                    {id}
                    {balances[id] !== undefined ? ` · ${cto(balances[id])} CTO` : ''}
                    {id === ceo ? ' · CEO' : ''}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setMode('wallet');
                if (!wallet.accountId) void wallet.connect();
              }}
            >
              Connect wallet
            </button>
          </>
        ) : wallet.accountId ? (
          <>
            <span className="chip" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', minHeight: 44 }}>
              {wallet.accountId}
              {balances[wallet.accountId] !== undefined ? ` · ${cto(balances[wallet.accountId])} CTO` : ''}
            </span>
            <button type="button" className="ghost" onClick={() => void wallet.disconnect()}>
              Disconnect
            </button>
            {demoAvailable && (
              <button type="button" className="ghost" onClick={() => setMode('demo')}>
                Back to demo accounts
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="ghost" onClick={() => void wallet.connect()}>
              Connect wallet
            </button>
            {demoAvailable ? (
              <button type="button" className="ghost" onClick={() => setMode('demo')}>
                Use demo accounts
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 14 }}>
                The main coin needs your own testnet wallet. The demo coin has ready-made accounts.
              </span>
            )}
          </>
        )}
      </div>
      {actor.mode === 'demo' && (
        <p className="mono muted" style={{ margin: 0, fontSize: 12 }}>
          Demo mode: a test relayer signs as {actor.accountId}. No wallet needed.
        </p>
      )}
    </div>
  );
}
