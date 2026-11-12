// JSON-RPC over fetch with a fallback endpoint, shared by the app, the relayer and
// the e2e tests. A rate limit (HTTP 429 or error code -429), a 5xx, a network
// failure or a timeout moves on to the next endpoint after a short wait, and that
// endpoint rests for 30 s. Every other answer, NEAR's errors included, is returned
// unedited.
//
// A signed transaction is resent only after an explicit 429 (the RPC refused it
// before NEAR saw it), never after a network failure or a timeout, so it cannot
// land twice.
//
// Every request has its own timeout (AbortController): 8 s for reads, 30 s for
// send_tx / broadcast_tx_commit, which wait for NEAR to execute the transaction.

export interface RpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: any;
  error?: any;
}

export interface PostRpcOptions {
  /** Per-request timeout in ms. Defaults: 8 s for reads, 30 s for sending a transaction. */
  timeoutMs?: number;
}

export const VIEW_TIMEOUT_MS = 8_000;
export const SEND_TIMEOUT_MS = 30_000;

/** The endpoint did not answer in time. For a transaction, NEAR may still have it. */
export class RpcTimeout extends Error {
  constructor(
    readonly url: string,
    readonly ms: number,
  ) {
    super(`RPC ${url} did not answer within ${Math.round(ms / 1000)} s`);
    this.name = 'RpcTimeout';
  }
}

const REST_MS = 30_000;
const WAITS_MS = [0, 300, 1000, 2500];
const resting = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The first endpoint not resting; if all are, the one that rests the least. */
function pick(urls: readonly string[]): string {
  const now = Date.now();
  return urls.find((u) => (resting.get(u) ?? 0) <= now) ?? [...urls].sort((a, b) => (resting.get(a) ?? 0) - (resting.get(b) ?? 0))[0];
}

const isRateLimit = (status: number, body: RpcResponse | undefined) => status === 429 || body?.error?.code === -429;

/** One POST with a timeout covering both the request and reading the body. */
async function fetchText(url: string, body: string, timeoutMs: number): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ctrl.signal });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    if (ctrl.signal.aborted) throw new RpcTimeout(url, timeoutMs);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function postRpc(
  urls: readonly string[],
  method: string,
  params: unknown,
  id = 'cto',
  options: PostRpcOptions = {},
): Promise<RpcResponse> {
  const once = method === 'send_tx' || method === 'broadcast_tx_commit';
  const timeoutMs = options.timeoutMs ?? (once ? SEND_TIMEOUT_MS : VIEW_TIMEOUT_MS);
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  let lastBody: RpcResponse | undefined;
  let lastError: unknown;
  for (const wait of WAITS_MS) {
    if (wait) await sleep(wait);
    const url = pick(urls);
    let res: { status: number; text: string };
    try {
      res = await fetchText(url, body, timeoutMs);
    } catch (e) {
      // Browsers report a 429 without CORS headers as a network error. A signed
      // transaction may have reached NEAR, so it is never resent.
      if (once) throw e;
      resting.set(url, Date.now() + REST_MS);
      lastError = e;
      continue;
    }
    const { status, text } = res;
    let parsed: RpcResponse | undefined;
    try {
      parsed = JSON.parse(text) as RpcResponse;
    } catch {
      parsed = undefined;
    }
    const transient = isRateLimit(status, parsed) || (!once && status >= 500 && !parsed?.error?.name);
    if (!transient && parsed) return parsed;
    if (!transient) throw new Error(`RPC ${url} answered HTTP ${status}: ${text.slice(0, 300)}`);
    resting.set(url, Date.now() + REST_MS);
    lastBody = parsed;
    lastError = new Error(`RPC ${url} answered HTTP ${status}: ${text.slice(0, 300)}`);
  }
  if (lastBody) return lastBody;
  throw lastError;
}
