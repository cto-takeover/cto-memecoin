// Who acts: demo mode (the relayer plays ani or budi, demo coin only) or the
// connected wallet. Demo is the default so a judge needs no wallet.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { DEMO_ACCOUNTS, type Who } from '../config';
import { useWallet } from '../lib/wallet';

export type Actor = { mode: 'demo'; who: Who; accountId: string } | { mode: 'wallet'; accountId: string } | { mode: 'none' };

interface ActorCtx {
  mode: 'demo' | 'wallet';
  setMode: (m: 'demo' | 'wallet') => void;
  /** Explicit "Play as" choice; null = automatic (whoever is not CEO). */
  demoWho: Who | null;
  setDemoWho: (w: Who | null) => void;
}

const Ctx = createContext<ActorCtx | null>(null);

export function ActorProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'demo' | 'wallet'>(() => (sessionStorage.getItem('cto:mode') === 'wallet' ? 'wallet' : 'demo'));
  const [demoWho, setDemoWho] = useState<Who | null>(() => {
    const w = sessionStorage.getItem('cto:who');
    return w === 'ani' || w === 'budi' ? w : null;
  });
  return (
    <Ctx.Provider
      value={{
        mode,
        setMode: (m) => {
          sessionStorage.setItem('cto:mode', m);
          setMode(m);
        },
        demoWho,
        setDemoWho: (w) => {
          if (w) sessionStorage.setItem('cto:who', w);
          else sessionStorage.removeItem('cto:who');
          setDemoWho(w);
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useActorCtx() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useActorCtx outside ActorProvider');
  return v;
}

/** The current actor. Demo mode only exists on the demo coin. */
export function useActor(coinKey: 'demo' | 'main', ceo: string | null | undefined): Actor {
  const { mode, demoWho } = useActorCtx();
  const wallet = useWallet();
  if (mode === 'wallet' || coinKey === 'main') {
    return wallet.accountId ? { mode: 'wallet', accountId: wallet.accountId } : { mode: 'none' };
  }
  const who: Who = demoWho ?? (ceo === DEMO_ACCOUNTS.ani ? 'budi' : 'ani');
  return { mode: 'demo', who, accountId: DEMO_ACCOUNTS[who] };
}

export const otherWho = (w: Who): Who => (w === 'ani' ? 'budi' : 'ani');
