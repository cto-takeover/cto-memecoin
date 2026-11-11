// Wallet mode voice key (spec 2): made in the browser, public half sent as
// new_ceo_key, private half kept in localStorage and offered as a download.
// Posting signs as the coin's own account with this key. No wallet pop-up.
import { KeyPair, KeyPairSigner, actions, baseDecode, createTransaction, type KeyPairString } from 'near-api-js';
import { accessKey, finalBlock, sendTx } from './rpc';
import { fromFailure, fromRpcError, type NearError } from './near-errors';

const storageKey = (contractId: string, accountId: string) => `cto:voice:${contractId}:${accountId}`;

export interface StoredVoiceKey {
  contract_id: string;
  ceo: string;
  public_key: string;
  private_key: string;
}

export const newVoiceKey = () => KeyPair.fromRandom('ed25519');

export function saveVoiceKey(contractId: string, accountId: string, kp: KeyPair): StoredVoiceKey {
  const record: StoredVoiceKey = {
    contract_id: contractId,
    ceo: accountId,
    public_key: kp.getPublicKey().toString(),
    private_key: kp.toString(),
  };
  try {
    localStorage.setItem(storageKey(contractId, accountId), JSON.stringify(record));
  } catch {
    // private mode: the download is the only copy
  }
  return record;
}

export function loadVoiceKey(contractId: string, accountId: string): StoredVoiceKey | undefined {
  try {
    const raw = localStorage.getItem(storageKey(contractId, accountId));
    return raw ? (JSON.parse(raw) as StoredVoiceKey) : undefined;
  } catch {
    return undefined;
  }
}

export function downloadVoiceKey(record: StoredVoiceKey) {
  const blob = new Blob(
    [JSON.stringify({ ...record, note: "CTO voice key. Lose this and you can't post as the coin until someone takes the seat." }, null, 2)],
    { type: 'application/json' },
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cto-voice-key.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
}

/** Reads a downloaded key file back in (e.g. in a second browser). */
export async function importVoiceKey(file: File): Promise<StoredVoiceKey> {
  const parsed = JSON.parse(await file.text()) as StoredVoiceKey;
  const kp = KeyPair.fromString(parsed.private_key as KeyPairString);
  if (kp.getPublicKey().toString() !== parsed.public_key) throw new Error('the key file does not match its public key');
  saveVoiceKey(parsed.contract_id, parsed.ceo, kp);
  return parsed;
}

export type PostResult = { ok: true; txHash: string; logs: string[] } | { ok: false; error: NearError; txHash?: string };

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/**
 * Signs announce(line) as the coin with this key and sends it. If NEAR no longer
 * has the key, it is still signed and sent, so the rejection is NEAR's own.
 */
export async function postAsCoin(contractId: string, privateKey: string, line: number): Promise<PostResult> {
  const kp = KeyPair.fromString(privateKey as KeyPairString);
  const pk = kp.getPublicKey();
  const key = await accessKey(contractId, pk.toString());
  const [nonce, blockHash] = key.found
    ? [key.nonce + 1n, key.blockHash]
    : await finalBlock().then((b) => [BigInt(b.height) * 1_000_000n, b.hash] as const);
  const tx = createTransaction(contractId, pk, contractId, nonce, [actions.functionCall('announce', { line }, 30_000_000_000_000n, 0n)], baseDecode(blockHash));
  const { signedTransaction } = await new KeyPairSigner(kp).signTransaction(tx);
  const res = await sendTx(toBase64(signedTransaction.encode()));
  if (res.error) return { ok: false, error: fromRpcError(res.error) };
  const result = res.result;
  if (result.status && 'Failure' in result.status) return { ok: false, error: fromFailure(result.status.Failure), txHash: result.transaction.hash };
  const logs = (result.receipts_outcome ?? []).flatMap((r: any) => r.outcome?.logs ?? []);
  return { ok: true, txHash: result.transaction.hash, logs };
}

/** The data of our NEP-297 event in a list of logs. */
export function eventData(logs: string[], event: string): any | undefined {
  for (const line of logs) {
    if (!line.startsWith('EVENT_JSON:')) continue;
    try {
      const e = JSON.parse(line.slice(11));
      if (e.standard === 'cto' && e.event === event) return e.data?.[0];
    } catch {
      // not ours
    }
  }
  return undefined;
}
