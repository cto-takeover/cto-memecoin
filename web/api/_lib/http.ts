// Web-standard Request/Response glue shared by the three Vercel functions.
import { configFromEnv, type RelayerConfig } from './config.js';
import { relayerError } from './errors.js';
import { RateLimiter, type Deps, type Reply } from './relayer.js';
import { Rpc } from './rpc.js';

let shared: Deps | undefined;

/** One set of deps per function instance, so the in-memory limits persist between requests. */
export function defaultDeps(): Deps {
  if (!shared) {
    const config = configFromEnv();
    shared = {
      config,
      rpc: new Rpc(config.rpcUrl),
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

/** Only the app's own origin (same host) or one listed in APP_ORIGINS. */
export function originAllowed(req: Request, config: RelayerConfig): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin GETs and server-side callers send none
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (new URL(origin).host === host) return true;
  } catch {
    return false;
  }
  return config.allowedOrigins.includes(origin);
}

export function json(reply: Reply): Response {
  if (typeof reply.status !== 'number' || reply.body === undefined) {
    // Never serialize something that is not a reply (it could hold a key).
    reply = { status: 500, body: { error: relayerError('Internal', 'no reply') } };
  }
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const MAX_BODY = 2_048;

export async function serve(
  req: Request,
  handle: (deps: Deps, body: Record<string, unknown>, ip: string) => Promise<Reply>,
  deps: Deps = defaultDeps(),
): Promise<Response> {
  if (!originAllowed(req, deps.config)) {
    return json({ status: 403, body: { error: relayerError('Forbidden', 'cross-origin requests are not allowed') } });
  }
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
