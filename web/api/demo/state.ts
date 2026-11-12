// GET /api/demo/state: both demo accounts' balances, the CEO, the price.
// Per-IP limit, and CDN-cacheable for 3 s (see serveState).
import { serveState } from '../_lib/http.js';

export function GET(req: Request): Promise<Response> {
  return serveState(req);
}
