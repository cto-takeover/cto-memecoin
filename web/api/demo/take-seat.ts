// POST /api/demo/take-seat { as, face, maxPrice }: signs take_seat as ani or budi.
import { serve } from '../_lib/http.js';
import { takeSeat } from '../_lib/relayer.js';

export function POST(req: Request): Promise<Response> {
  return serve(req, takeSeat);
}
