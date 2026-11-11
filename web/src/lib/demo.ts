// Client for the demo relayer (spec 3). Errors come back as the relayer sent them.
import type { Who } from '../config';
import type { ApiError } from './near-errors';
import type { Face } from './faces';

export interface DemoAccountState {
  account: string;
  cto: string;
  near: string;
}
export interface DemoState {
  ani: DemoAccountState;
  budi: DemoAccountState;
  ceo: string | null;
  price: string;
  decaySecondsLeft: number;
}

export type Reply<T> = ({ ok: true } & T) | { ok: false; error: ApiError; txHash?: string; status: number };

async function call<T>(path: string, init?: RequestInit): Promise<Reply<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/demo/${path}`, init);
  } catch (e) {
    return { ok: false, status: 0, error: { source: 'relayer', type: 'Internal', message: `relayer unreachable: ${(e as Error).message}` } };
  }
  const body = await res.json().catch(() => ({ error: { source: 'relayer', type: 'Internal', message: `HTTP ${res.status}` } }));
  if (body?.error) return { ok: false, status: res.status, error: body.error, txHash: body.txHash };
  return { ok: true, ...(body as T) };
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const demoState = () => call<DemoState>('state');

export const demoTakeSeat = (who: Who, face: Face, maxPrice: string) =>
  call<{ txHash: string; takeoverIndex?: number }>('take-seat', post({ as: who, face, maxPrice }));

export const demoAnnounce = (who: Who, line: number) =>
  call<{ txHash: string; announcementIndex?: number }>('announce', post({ as: who, line }));
