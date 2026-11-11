// Wallet mode (spec 2): MyNearWallet and Meteor through near-wallet-selector.
// Loaded only when someone connects (or is already connected), so the demo path stays light.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { NETWORK, STORAGE_DEPOSIT_NEAR, TAKE_SEAT_NEAR } from '../config';
import { fromFailure, type NearError } from './near-errors';
import { rpcCall } from './rpc';

type Selector = import('@near-wallet-selector/core').WalletSelector;
type Modal = import('@near-wallet-selector/modal-ui').WalletSelectorModal;

export type CallResult =
  | { ok: true; txHash: string; logs: string[] }
  | { ok: false; error: NearError | { source: 'wallet'; type: string; message: string }; txHash?: string }
  | { ok: 'redirect' };

interface Wallet {
  accountId: string | null;
  ready: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  call: (contractId: string, method: string, args: object, depositNear: string, gasTgas?: number) => Promise<CallResult>;
}

const Ctx = createContext<Wallet | null>(null);

function nearToYocto(near: string): string {
  const [w, f = ''] = near.split('.');
  return (BigInt(w) * 10n ** 24n + BigInt(f.padEnd(24, '0'))).toString();
}

let loading: Promise<{ selector: Selector; modal: Modal }> | undefined;
function load() {
  loading ??= (async () => {
    // The wallet modules expect Node's Buffer; give them the browser polyfill first.
    const { Buffer } = await import('buffer');
    const g = globalThis as { Buffer?: unknown; global?: unknown; process?: unknown };
    g.Buffer ??= Buffer;
    g.global ??= globalThis;
    g.process ??= { env: {}, browser: true, version: '' };
    const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
      import('@near-wallet-selector/core'),
      import('@near-wallet-selector/modal-ui'),
      import('@near-wallet-selector/my-near-wallet'),
      import('@near-wallet-selector/meteor-wallet'),
      import('@near-wallet-selector/modal-ui/styles.css'),
    ]);
    const selector = await setupWalletSelector({ network: NETWORK as 'testnet', modules: [setupMyNearWallet(), setupMeteorWallet()] });
    const modal = setupModal(selector, { description: 'Connect a NEAR testnet wallet to claim CTO and take the seat yourself.' });
    return { selector, modal };
  })();
  return loading;
}

const hadSession = () => {
  try {
    return !!localStorage.getItem('near-wallet:selectedWalletId') || !!localStorage.getItem('near-wallet-selector:selectedWalletId');
  } catch {
    return false;
  }
};

/** Outcome of a tx the wallet sent (or that came back through a redirect). */
export async function txOutcome(hash: string, sender: string): Promise<CallResult> {
  const r = await rpcCall('tx', { tx_hash: hash, sender_account_id: sender, wait_until: 'EXECUTED_OPTIMISTIC' });
  if (r.error) return { ok: true, txHash: hash, logs: [] };
  return fromOutcome(r.result);
}

function fromOutcome(o: any): CallResult {
  const hash = o?.transaction?.hash ?? o?.transaction_outcome?.id;
  if (o?.status && 'Failure' in o.status) return { ok: false, error: fromFailure(o.status.Failure), txHash: hash };
  const logs = (o?.receipts_outcome ?? []).flatMap((r: any) => r.outcome?.logs ?? []);
  return { ok: true, txHash: hash, logs };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const attach = useCallback(async () => {
    const { selector } = await load();
    const sync = () => setAccountId(selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null);
    sync();
    selector.store.observable.subscribe(sync);
    setReady(true);
    return selector;
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (hadSession() || url.searchParams.has('transactionHashes') || url.searchParams.has('account_id')) void attach();
  }, [attach]);

  const connect = useCallback(async () => {
    await attach();
    (await load()).modal.show();
  }, [attach]);

  const disconnect = useCallback(async () => {
    const { selector } = await load();
    const wallet = await selector.wallet();
    await wallet.signOut();
    setAccountId(null);
  }, []);

  const call = useCallback(
    async (contractId: string, method: string, args: object, depositNear: string, gasTgas = 100): Promise<CallResult> => {
      const { selector } = await load();
      const wallet = await selector.wallet();
      const { actionCreators } = await import('@near-js/transactions');
      try {
        const outcome = await wallet.signAndSendTransaction({
          receiverId: contractId,
          actions: [actionCreators.functionCall(method, args, BigInt(gasTgas) * 10n ** 12n, BigInt(nearToYocto(depositNear)))],
        });
        if (!outcome) return { ok: 'redirect' };
        return fromOutcome(outcome);
      } catch (e) {
        return { ok: false, error: { source: 'wallet', type: 'WalletError', message: e instanceof Error ? e.message : String(e) } };
      }
    },
    [],
  );

  return <Ctx.Provider value={{ accountId, ready, connect, disconnect, call }}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

export const DEPOSITS = { takeSeat: TAKE_SEAT_NEAR, storage: STORAGE_DEPOSIT_NEAR };
