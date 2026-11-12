// Web-standard Request/Response glue shared by the three Vercel functions.
import { configFromEnv, type RelayerConfig } from './config.js';
import { relayerError } from '../../src/lib/near-errors.js';
import { RateLimiter, state, stateRateLimited, type Deps, type Reply } from './relayer.js';
import { Rpc } from './rpc.js';

let shared: Deps | undefined;

/** One set of deps per function instance, so the in-memory limits persist between requests. */
export function defaultDeps(): Deps {
  if (!shared) {
    const config = configFromEnv();
    shared = {
      config,
      rpc: new Rpc(config.rpcUrls),
      limiter: new RateLimiter(),
      now: () => Date.now(),
      // Logs hold tx hashes and error types only, never keys.
      log: (line) => console.log(`[demo-relayer] ${line}`),
    };
  }
  return shared;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Only the app's own origin (same host) or one listed in APP_ORIGINS. A request
 * without an Origin header passes here (same-origin GETs send none); `serve`
 * refuses a POST without one.
 */
export function originAllowed(req: Request, config: RelayerConfig): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (new URL(origin).host === host) return true;
  } catch {
    return false;
  }
  return config.allowedOrigins.includes(origin);
}

/** CDN caching for GET /state: a flood of reads hits Vercel's edge, not the RPC. */
export const STATE_CACHE = 'public, s-maxage=3, stale-while-revalidate=10';

export function json(reply: Reply, cacheControl = 'no-store'): Response {
  if (typeof reply.status !== 'number' || reply.body === undefined) {
    // Never serialize something that is not a reply (it could hold a key).
    reply = { status: 500, body: { error: relayerError('Internal', 'no reply') } };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': cacheControl };
  if (cacheControl !== 'no-store') {
    // Vercel's CDN honours CDN-Cache-Control first, so the cache holds even where
    // a broader rule sets Cache-Control: no-store on /api.
    headers['cdn-cache-control'] = 'max-age=3, stale-while-revalidate=10';
  }
  const retryAfterS = (reply.body as { error?: { retryAfterS?: unknown } })?.error?.retryAfterS;
  if (typeof retryAfterS === 'number') headers['retry-after'] = String(retryAfterS);
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers });
}

const MAX_BODY = 2_048;
const forbidden = (message: string) => json({ status: 403, body: { error: relayerError('Forbidden', message) } });

export async function serve(
  req: Request,
  handle: (deps: Deps, body: Record<string, unknown>, ip: string) => Promise<Reply>,
  deps: Deps = defaultDeps(),
): Promise<Response> {
  // Browsers send Origin on every POST, same-origin included; scripts that leave it out are refused.
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.headers.get('origin')) {
    return forbidden('requests must come from the app (no Origin header)');
  }
  if (!originAllowed(req, deps.config)) return forbidden('cross-origin requests are not allowed');
  const text = await req.text();
  let body: unknown;
  try {
    if (text.length > MAX_BODY) throw new Error();
    body = JSON.parse(text);
  } catch {
    return json({ status: 400, body: { error: relayerError('BadRequest', 'body must be a small JSON object') } });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ status: 400, body: { error: relayerError('BadRequest', 'body must be a JSON object') } });
  }
  return json(await handle(deps, body as Record<string, unknown>, clientIp(req)));
}

/** GET /api/demo/state: origin check, per-IP limit, then a CDN-cacheable read. */
export async function serveState(req: Request, deps: Deps = defaultDeps()): Promise<Response> {
  if (!originAllowed(req, deps.config)) return forbidden('cross-origin requests are not allowed');
  const limited = stateRateLimited(deps, clientIp(req));
  if (limited) return json(limited);
  const reply = await state(deps);
  // Only a good read is cached: an error must not be served to everyone else.
  return json(reply, reply.status === 200 ? STATE_CACHE : 'no-store');
}
