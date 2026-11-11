// Plain JSON-RPC over fetch. Responses are returned as NEAR sent them, so errors
// can be passed through unedited.

export interface RpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: any;
  error?: any;
}

/** A failed read (view call, account lookup). Carries NEAR's error object as is. */
export class RpcFailure extends Error {
  constructor(readonly raw: unknown) {
    super(typeof raw === 'string' ? raw : JSON.stringify(raw));
  }
}

export type KeyLookup =
  | { found: true; nonce: bigint; blockHash: string }
  | { found: false; raw: unknown };

export class Rpc {
  constructor(readonly url: string) {}

  async call(method: string, params: unknown): Promise<RpcResponse> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'cto', method, params }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as RpcResponse;
    } catch {
      throw new RpcFailure({ status: res.status, body: text });
    }
  }

  private async query(params: Record<string, unknown>): Promise<any> {
    const r = await this.call('query', { finality: 'optimistic', ...params });
    if (r.error) throw new RpcFailure(r.error);
    if (r.result?.error) throw new RpcFailure(r.result.error);
    return r.result;
  }

  async view<T = any>(contractId: string, method: string, args: object = {}): Promise<T> {
    const result = await this.query({
      request_type: 'call_function',
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    });
    return JSON.parse(Buffer.from(result.result as number[]).toString('utf8')) as T;
  }

  /** NEAR balance in yoctoNEAR. */
  async nearBalance(accountId: string): Promise<string> {
    const result = await this.query({ request_type: 'view_account', account_id: accountId });
    return result.amount as string;
  }

  async accessKey(accountId: string, publicKey: string): Promise<KeyLookup> {
    const r = await this.call('query', {
      request_type: 'view_access_key',
      // optimistic: a voice key added one block ago must already count as found.
      finality: 'optimistic',
      account_id: accountId,
      public_key: publicKey,
    });
    const err = r.error ?? r.result?.error;
    if (err) return { found: false, raw: err };
    return { found: true, nonce: BigInt(r.result.nonce), blockHash: r.result.block_hash };
  }

  async finalBlock(): Promise<{ hash: string; height: number }> {
    const r = await this.call('block', { finality: 'final' });
    if (r.error) throw new RpcFailure(r.error);
    return { hash: r.result.header.hash as string, height: r.result.header.height as number };
  }

  /** Broadcasts a signed transaction and waits until it has executed. */
  sendTx(signedTxBase64: string): Promise<RpcResponse> {
    return this.call('send_tx', { signed_tx_base64: signedTxBase64, wait_until: 'EXECUTED_OPTIMISTIC' });
  }
}
