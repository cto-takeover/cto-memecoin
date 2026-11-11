// POST /api/demo/announce { as, line }: signs announce(line) as the coin with that account's voice key.
import { serve } from '../_lib/http.js';
import { announce } from '../_lib/relayer.js';

export function POST(req: Request): Promise<Response> {
  return serve(req, announce);
}
