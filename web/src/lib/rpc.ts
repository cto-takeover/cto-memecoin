// Browser JSON-RPC: views, keys, code hash, and raw send_tx. Responses come back
// as NEAR sent them so errors can be shown unedited; rate limits fall back to the
// second endpoint (lib/jsonrpc.ts).
import { RPC_URLS } from '../config';
import { postRpc, type RpcResponse } from './jsonrpc';
import type { AccessKeyInfo } from './types';

export class RpcFailure extends Error {
  constructor(readonly raw: unknown) {
    super(typeof raw === 'string' ? raw : JSON.stringify(raw));
  }
}

export type { RpcResponse };

let nextId = 0;
export function rpcCall(method: string, params: unknown): Promise<RpcResponse> {
  return postRpc(RPC_URLS, method, params, `cto-${nextId++}`);
}

async function query(params: Record<string, unknown>): Promise<any> {
  const r = await rpcCall('query', { finality: 'optimistic', ...params });
  if (r.error) throw new RpcFailure(r.error);
  if (r.result?.error) throw new RpcFailure(r.result.error);
  return r.result;
}

const toBase64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export async function view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
  const result = await query({
    request_type: 'call_function',
    account_id: contractId,
    method_name: method,
    args_base64: toBase64(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result as number[]))) as T;
}

export async function viewAccount(accountId: string): Promise<{ amount: string; code_hash: string }> {
  return query({ request_type: 'view_account', account_id: accountId });
}

export async function viewAccessKeyList(accountId: string): Promise<AccessKeyInfo[]> {
  const r = await query({ request_type: 'view_access_key_list', account_id: accountId });
  return r.keys as AccessKeyInfo[];
}

export async function accessKey(
  accountId: string,
  publicKey: string,
): Promise<{ found: true; nonce: bigint; blockHash: string } | { found: false }> {
  const r = await rpcCall('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: accountId, public_key: publicKey });
  if (r.error || r.result?.error) return { found: false };
  return { found: true, nonce: BigInt(r.result.nonce), blockHash: r.result.block_hash };
}

export async function finalBlock(): Promise<{ hash: string; height: number }> {
  const r = await rpcCall('block', { finality: 'final' });
  if (r.error) throw new RpcFailure(r.error);
  return { hash: r.result.header.hash, height: r.result.header.height };
}

export function sendTx(signedTxBase64: string): Promise<RpcResponse> {
  return rpcCall('send_tx', { signed_tx_base64: signedTxBase64, wait_until: 'EXECUTED_OPTIMISTIC' });
}
