// Voice keys are derived, never stored (spec 3):
//   seed = HMAC-SHA256(VOICE_SECRET, "{account}:{takeoverIndex}")
//   key  = ed25519 from that 32-byte seed
import { createHmac } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { KeyPair, baseEncode, type KeyPairString } from 'near-api-js';

export function parseSecret(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('VOICE_SECRET must be 32 bytes as 64 hex characters');
  }
  return Buffer.from(hex, 'hex');
}

export function voiceSeed(secretHex: string, accountId: string, takeoverIndex: number): Uint8Array {
  const mac = createHmac('sha256', parseSecret(secretHex));
  mac.update(`${accountId}:${takeoverIndex}`);
  return new Uint8Array(mac.digest());
}

export function voiceKeyPair(secretHex: string, accountId: string, takeoverIndex: number): KeyPair {
  const seed = voiceSeed(secretHex, accountId, takeoverIndex);
  const secretKey = new Uint8Array(64);
  secretKey.set(seed, 0);
  secretKey.set(ed25519.getPublicKey(seed), 32);
  return KeyPair.fromString(`ed25519:${baseEncode(secretKey)}` as KeyPairString);
}

/**
 * The derived key whose public half is `publicKey`, searching this account's
 * indices downward from `fromIndex`. A takeover's key is derived from the history
 * length when the request started, which can be lower than the index it landed at
 * if someone else took the seat in between.
 */
export function findVoiceKey(
  secretHex: string,
  accountId: string,
  fromIndex: number,
  publicKey: string,
  maxBack = 64,
): KeyPair | undefined {
  for (let i = fromIndex; i >= Math.max(0, fromIndex - maxBack); i--) {
    const kp = voiceKeyPair(secretHex, accountId, i);
    if (kp.getPublicKey().toString() === publicKey) return kp;
  }
  return undefined;
}
