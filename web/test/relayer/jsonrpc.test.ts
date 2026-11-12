// The RPC fallback (src/lib/jsonrpc.ts): rate limits move to the next endpoint,
// NEAR's errors come back unedited, and a signed transaction is never resent after
// a network failure.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcTimeout, SEND_TIMEOUT_MS, VIEW_TIMEOUT_MS, postRpc } from '../../src/lib/jsonrpc.js';

/** A fetch that never answers, until its AbortSignal fires. */
const hang = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NEAR_ERROR = { name: 'HANDLER_ERROR', cause: { name: 'INVALID_TRANSACTION', info: {} }, code: -32000, message: 'Server error', data: { TxExecutionError: { InvalidTxError: { InvalidAccessKeyError: { AccessKeyNotFound: { account_id: 'demo-cto.testnet', public_key: 'ed25519:x' } } } } } };

let n = 0;
const urls = () => [`https://a${++n}.test`, `https://b${n}.test`];

afterEach(() => vi.unstubAllGlobals());

describe('postRpc', () => {
  it('moves to the fallback after HTTP 429', async () => {
    const [a, b] = urls();
    const fetch = vi.fn(async (url: string) => (url === a ? json(429, { error: { code: -429, message: 'Rate limits exceeded' } }) : json(200, { result: 'ok' })));
    vi.stubGlobal('fetch', fetch);
    expect(await postRpc([a, b], 'block', {})).toEqual({ result: 'ok' });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([a, b]);
  });

  it('moves to the fallback after a network error (a browser sees a CORS-less 429 this way)', async () => {
    const [a, b] = urls();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === a ? Promise.reject(new TypeError('Failed to fetch')) : json(200, { result: 1 }))));
    expect(await postRpc([a, b], 'query', {})).toEqual({ result: 1 });
  });

  it('rests a rate-limited endpoint: the next call starts at the fallback', async () => {
    const [a, b] = urls();
    const fetch = vi.fn(async (url: string) => (url === a ? json(429, {}) : json(200, { result: 2 })));
    vi.stubGlobal('fetch', fetch);
    await postRpc([a, b], 'query', {});
    fetch.mockClear();
    await postRpc([a, b], 'query', {});
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([b]);
  });

  it("returns NEAR's error unedited, without retrying", async () => {
    const [a, b] = urls();
    const fetch = vi.fn(async () => json(200, { jsonrpc: '2.0', id: 'cto', error: NEAR_ERROR }));
    vi.stubGlobal('fetch', fetch);
    expect((await postRpc([a, b], 'send_tx', {})).error).toEqual(NEAR_ERROR);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never resends a signed transaction after a network error', async () => {
    const [a, b] = urls();
    const fetch = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetch);
    await expect(postRpc([a, b], 'send_tx', {})).rejects.toThrow('Failed to fetch');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resends a signed transaction after an explicit 429 (NEAR never saw it)', async () => {
    const [a, b] = urls();
    const fetch = vi.fn(async (url: string) => (url === a ? json(429, {}) : json(200, { result: { status: {} } })));
    vi.stubGlobal('fetch', fetch);
    expect(await postRpc([a, b], 'send_tx', {})).toEqual({ result: { status: {} } });
  });

  it('gives back the last rate-limit answer when every endpoint keeps refusing', async () => {
    const [a, b] = urls();
    const fetch = vi.fn(async () => json(429, { error: { code: -429, message: 'Rate limits exceeded' } }));
    vi.stubGlobal('fetch', fetch);
    expect((await postRpc([a, b], 'query', {})).error.code).toBe(-429);
    expect(fetch).toHaveBeenCalledTimes(4);
  }, 10_000);

  it('times out a slow read and moves on to the fallback', async () => {
    const [a, b] = urls();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => (url === a ? hang(url, init) : json(200, { result: 3 })));
    vi.stubGlobal('fetch', fetch);
    expect(await postRpc([a, b], 'query', {}, 'cto', { timeoutMs: 50 })).toEqual({ result: 3 });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([a, b]);
  });

  it('a timed-out send_tx throws RpcTimeout and is never resent', async () => {
    const [a, b] = urls();
    const fetch = vi.fn(hang);
    vi.stubGlobal('fetch', fetch);
    await expect(postRpc([a, b], 'send_tx', {}, 'cto', { timeoutMs: 50 })).rejects.toBeInstanceOf(RpcTimeout);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('defaults: 8 s for reads, 30 s for transactions; every request gets a signal', async () => {
    expect([VIEW_TIMEOUT_MS, SEND_TIMEOUT_MS]).toEqual([8_000, 30_000]);
    const [a, b] = urls();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return json(200, { result: 4 });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await postRpc([a, b], 'block', {})).toEqual({ result: 4 });
  });
});
