// Keyless checks the browser can run against a deployed coin (the live layer of
// `npm run verify`, spec 4). Each returns PASS/FAIL with what it saw.
import { TOTAL_SUPPLY_WHOLE } from '../config';
import { faceSvg } from './faces';
import { cto, wholeToBase } from './format';
import { view, viewAccessKeyList, viewAccount } from './rpc';
import type { SeatView, Takeover } from './types';

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

async function allHistory(contractId: string): Promise<Takeover[]> {
  const out: Takeover[] = [];
  for (let from = 0; ; from += 50) {
    const page = await view<Takeover[]>(contractId, 'get_history', { from_index: from, limit: 50 });
    out.push(...page);
    if (page.length < 50) return out;
  }
}

function decodeIcon(icon: string): string {
  const b64 = icon.replace(/^data:image\/svg\+xml;base64,/, '');
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

export async function runLiveChecks(contractId: string, expectedCodeHash?: string): Promise<Check[]> {
  const [keys, account, seat, supply, meta, history] = await Promise.all([
    viewAccessKeyList(contractId),
    viewAccount(contractId),
    view<SeatView>(contractId, 'get_seat'),
    view<string>(contractId, 'ft_total_supply'),
    view<{ icon: string }>(contractId, 'ft_metadata'),
    allHistory(contractId),
  ]);
  const full = keys.filter((k) => k.access_key.permission === 'FullAccess').length;
  const fc = keys.filter((k) => k.access_key.permission !== 'FullAccess');
  const onlyAnnounce = fc.every((k) => {
    const p = k.access_key.permission;
    return p !== 'FullAccess' && p.FunctionCall.receiver_id === contractId && p.FunctionCall.method_names.join() === 'announce';
  });
  const burned = history.reduce((s, t) => s + BigInt(t.burned), 0n);
  const expectedSupply = BigInt(wholeToBase(TOTAL_SUPPLY_WHOLE)) - burned;
  const icon = decodeIcon(meta.icon);
  const chainSvg = await view<string>(contractId, 'face_svg', { face: seat.face });

  const checks: Check[] = [
    { name: `full-access keys on ${contractId}: ${full}`, pass: full === 0 },
    { name: `voice keys: ${fc.length}, may only call announce`, pass: fc.length <= 1 && onlyAnnounce },
    {
      name: `total supply = ${Number(TOTAL_SUPPLY_WHOLE).toLocaleString('en-US')} - burned`,
      pass: BigInt(supply) === expectedSupply,
      detail: `${cto(supply)} = ${Number(TOTAL_SUPPLY_WHOLE).toLocaleString('en-US')} - ${cto(burned)}`,
    },
    { name: 'face in ft_metadata = face_svg(seat.face)', pass: icon === chainSvg },
    { name: 'this page draws the same face as the chain', pass: faceSvg(seat.face) === chainSvg },
  ];
  if (expectedCodeHash) {
    checks.push({ name: 'deployed code matches res/cto.wasm', pass: account.code_hash === expectedCodeHash, detail: account.code_hash });
  }
  return checks;
}
