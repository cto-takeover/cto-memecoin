// GET /api/demo/state: both demo accounts' balances, the CEO, the price.
import { defaultDeps, json, originAllowed } from '../_lib/http.js';
import { relayerError } from '../../src/lib/near-errors.js';
import { state } from '../_lib/relayer.js';

export async function GET(req: Request): Promise<Response> {
  const deps = defaultDeps();
  if (!originAllowed(req, deps.config)) {
    return json({ status: 403, body: { error: relayerError('Forbidden', 'cross-origin requests are not allowed') } });
  }
  return json(await state(deps));
}
