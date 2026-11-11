import { describe, expect, it } from 'vitest';
import { findVoiceKey, voiceKeyPair, voiceSeed } from '../../api/_lib/keys.js';
import { errorPath, fromFailure, fromRpcError } from '../../api/_lib/errors.js';
import { RateLimiter } from '../../api/_lib/relayer.js';

const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

// Fixed vector, computed independently with node:crypto (HMAC-SHA256 seed ->
// PKCS#8 ed25519 -> public JWK -> base58). Change it only with the derivation rule.
const VECTOR: [string, number, string][] = [
  ['ani-cto.testnet', 0, 'ed25519:9XKFZrwmXKe43oeQ28MGLPBqF5bJk9F9JCMv4TpnDLVt'],
  ['ani-cto.testnet', 1, 'ed25519:9W6BVjw5iEGfeUuCHSd4wXeTEiXsNW4MFvt361z9RNqL'],
  ['budi-cto.testnet', 1, 'ed25519:6u3fcnBGCQcQVezCGuUrSunTQHbskhs3Sb8zHPoJDfiS'],
];

describe('voice key derivation', () => {
  it('matches the committed test vector', () => {
    for (const [account, index, pk] of VECTOR) {
      expect(voiceKeyPair(SECRET, account, index).getPublicKey().toString()).toBe(pk);
    }
  });

  it('is stable for the same account and index, and differs otherwise', () => {
    const a = voiceKeyPair(SECRET, 'ani-cto.testnet', 3).toString();
    expect(voiceKeyPair(SECRET, 'ani-cto.testnet', 3).toString()).toBe(a);
    expect(voiceKeyPair(SECRET, 'ani-cto.testnet', 4).toString()).not.toBe(a);
    expect(voiceKeyPair(SECRET, 'budi-cto.testnet', 3).toString()).not.toBe(a);
    expect(voiceKeyPair(SECRET.replace(/^00/, '01'), 'ani-cto.testnet', 3).toString()).not.toBe(a);
  });

  it('signs with the derived key', () => {
    const kp = voiceKeyPair(SECRET, 'ani-cto.testnet', 0);
    const msg = new TextEncoder().encode('gm');
    expect(kp.verify(msg, kp.sign(msg).signature)).toBe(true);
    expect(voiceSeed(SECRET, 'ani-cto.testnet', 0)).toHaveLength(32);
  });

  it('finds the key a takeover installed when it landed at a later index', () => {
    const installed = voiceKeyPair(SECRET, 'ani-cto.testnet', 5).getPublicKey().toString();
    expect(findVoiceKey(SECRET, 'ani-cto.testnet', 7, installed)?.getPublicKey().toString()).toBe(installed);
    expect(findVoiceKey(SECRET, 'budi-cto.testnet', 7, installed)).toBeUndefined();
  });

  it('refuses a malformed secret', () => {
    expect(() => voiceKeyPair('abc', 'ani-cto.testnet', 0)).toThrow('VOICE_SECRET');
  });
});

describe('NEAR error shape', () => {
  it('names an invalid transaction by its key path below TxExecutionError', () => {
    const raw = {
      name: 'HANDLER_ERROR',
      cause: { info: {}, name: 'INVALID_TRANSACTION' },
      code: -32000,
      message: 'Server error',
      data: {
        TxExecutionError: {
          InvalidTxError: {
            InvalidAccessKeyError: { AccessKeyNotFound: { account_id: 'demo-cto.testnet', public_key: 'ed25519:x' } },
          },
        },
      },
    };
    const e = fromRpcError(raw);
    expect(e.type).toBe('InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound');
    expect(e.message).toBe('{"account_id":"demo-cto.testnet","public_key":"ed25519:x"}');
    expect(e.raw).toBe(raw);
  });

  it('walks ActionError past its index field', () => {
    const failure = { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: CTO: x' } } } };
    expect(errorPath(failure).path).toEqual(['ActionError', 'kind', 'FunctionCallError', 'ExecutionError']);
    const e = fromFailure(failure);
    expect(e.message).toBe('Smart contract panicked: CTO: x');
    expect(e.raw).toEqual({ Failure: failure });
  });
});

describe('rate limiter', () => {
  it('allows 6 a minute per IP, then refuses until the window slides', () => {
    const l = new RateLimiter();
    for (let i = 0; i < 6; i++) expect(l.allow('1.1.1.1', 6, 1000 + i)).toBe(true);
    expect(l.allow('1.1.1.1', 6, 1010)).toBe(false);
    expect(l.allow('2.2.2.2', 6, 1010)).toBe(true);
    expect(l.allow('1.1.1.1', 6, 61_001)).toBe(true);
  });

  it('allows one takeover per gap overall', () => {
    const l = new RateLimiter();
    expect(l.claimTakeover(10_000, 0)).toBe(0);
    expect(l.claimTakeover(10_000, 4_000)).toBe(6_000);
    expect(l.claimTakeover(10_000, 10_000)).toBe(0);
  });
});
