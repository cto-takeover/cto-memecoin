// Wallet mode voice key (spec 2): made in the browser, public half sent as
// new_ceo_key, private half kept in localStorage and offered as a download.
// Posting signs as the coin's own account with this key. No wallet pop-up.
import { KeyPair, KeyPairSigner, actions, baseDecode, createTransaction, type KeyPairString } from 'near-api-js';
import { accessKey, finalBlock, sendTx } from './rpc';
import { fromFailure, fromRpcError, type NearError } from './near-errors';

const storageKey = (contractId: string, accountId: string) => `cto:voice:${contractId}:${accountId}`;
/** A key made for a take_seat the wallet has not confirmed yet (spec 2, voice key step 2). */
const pendingKey = (contractId: string, accountId: string) => `cto:voice-pending:${contractId}:${accountId}`;

export interface StoredVoiceKey {
  contract_id: string;
  ceo: string;
  public_key: string;
  private_key: string;
}

export const newVoiceKey = () => KeyPair.fromRandom('ed25519');

const toRecord = (contractId: string, accountId: string, kp: KeyPair): StoredVoiceKey => ({
  contract_id: contractId,
  ceo: accountId,
  public_key: kp.getPublicKey().toString(),
  private_key: kp.toString(),
});

function write(key: string, record: StoredVoiceKey) {
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // private mode: the download is the only copy
  }
}

function read(key: string): StoredVoiceKey | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredVoiceKey) : undefined;
  } catch {
    return undefined;
  }
}

/** Saves a key that is on chain (or imported from a key file) as this account's voice key. */
export function saveVoiceKey(contractId: string, accountId: string, kp: KeyPair): StoredVoiceKey {
  const record = toRecord(contractId, accountId, kp);
  write(storageKey(contractId, accountId), record);
  return record;
}

export function loadVoiceKey(contractId: string, accountId: string): StoredVoiceKey | undefined {
  return read(storageKey(contractId, accountId));
}

/**
 * Saves a new key before take_seat is signed, in a separate slot: until the
 * takeover succeeds, the account's current voice key (an ex-CEO's, for "try
 * posting") must stay where it is.
 */
export function savePendingVoiceKey(contractId: string, accountId: string, kp: KeyPair): StoredVoiceKey {
  const record = toRecord(contractId, accountId, kp);
  write(pendingKey(contractId, accountId), record);
  return record;
}

export function loadPendingVoiceKey(contractId: string, accountId: string): StoredVoiceKey | undefined {
  return read(pendingKey(contractId, accountId));
}

/** take_seat succeeded with this key: it becomes the account's voice key. */
export function promoteVoiceKey(record: StoredVoiceKey): StoredVoiceKey {
  write(storageKey(record.contract_id, record.ceo), record);
  discardPendingVoiceKey(record.contract_id, record.ceo);
  return record;
}

/** take_seat failed or was cancelled: the key was never installed. */
export function discardPendingVoiceKey(contractId: string, accountId: string) {
  try {
    localStorage.removeItem(pendingKey(contractId, accountId));
  } catch {
    // nothing stored
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
