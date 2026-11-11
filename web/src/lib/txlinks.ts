// Explorer links for history items. The contract cannot know its own tx hashes, so:
// 1) hashes this browser saw itself (relayer / wallet replies), saved in localStorage;
// 2) else a match in nearblocks' list of the coin's transactions;
// 3) else no hash: the chip links to the coin's account page instead. Never a made-up hash.
import { EXPLORER_ON, NEARBLOCKS_API } from '../config';
import type { Announcement, Takeover } from './types';

const key = (contractId: string) => `cto:tx:${contractId}`;

function readSaved(contractId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key(contractId)) ?? '{}');
  } catch {
    return {};
  }
}

export function saveTx(contractId: string, id: string, hash: string) {
  try {
    const all = readSaved(contractId);
    all[id] = hash;
    localStorage.setItem(key(contractId), JSON.stringify(all));
  } catch {
    // storage unavailable: links fall back to the explorer lookup
  }
}

export interface IndexedTx {
  hash: string;
  block: number;
  timestampNs: bigint;
  signer: string;
  method: string | null;
  kinds: string[];
  ok: boolean;
}

let cache: { contractId: string; at: number; txs: Promise<IndexedTx[]> } | undefined;

/** The coin's latest transactions from nearblocks (cached 20 s). Empty if unavailable. */
export function indexedTxs(contractId: string): Promise<IndexedTx[]> {
  if (!EXPLORER_ON) return Promise.resolve([]);
  if (cache && cache.contractId === contractId && Date.now() - cache.at < 20_000) return cache.txs;
  const txs = fetch(`${NEARBLOCKS_API}/accounts/${contractId}/txns?per_page=50`)
    .then((r) => (r.ok ? r.json() : { data: [] }))
    .then((j: any) =>
      (j.data ?? []).map(
        (t: any): IndexedTx => ({
          hash: t.transaction_hash,
          block: Number(t.block?.block_height ?? 0),
          timestampNs: BigInt(t.block_timestamp ?? 0),
          signer: t.signer_account_id,
          method: t.actions?.find((a: any) => a.method)?.method ?? null,
          kinds: (t.actions ?? []).map((a: any) => a.action),
          ok: t.outcomes?.status !== false,
        }),
      ),
    )
    .catch(() => [] as IndexedTx[]);
  cache = { contractId, at: Date.now(), txs };
  return txs;
}

export async function takeoverTx(contractId: string, t: Takeover): Promise<string | undefined> {
  const saved = readSaved(contractId)[`takeover:${t.index}`];
  if (saved) return saved;
  const hit = (await indexedTxs(contractId)).find(
    (x) => x.ok && x.method === 'take_seat' && x.signer === t.ceo && x.block <= t.block_height && x.block >= t.block_height - 5,
  );
  return hit?.hash;
}

export async function announcementTx(contractId: string, a: Announcement): Promise<string | undefined> {
  const saved = readSaved(contractId)[`announce:${a.index}`];
  if (saved) return saved;
  const at = BigInt(a.at_ns);
  const hit = (await indexedTxs(contractId)).find(
    (x) => x.ok && x.method === 'announce' && x.signer === contractId && (x.timestampNs > at ? x.timestampNs - at : at - x.timestampNs) < 6_000_000_000n,
  );
  return hit?.hash;
}

export async function deployTx(contractId: string): Promise<string | undefined> {
  const txs = await indexedTxs(contractId);
  return txs.filter((x) => x.kinds.includes('DEPLOY_CONTRACT')).at(-1)?.hash;
}
