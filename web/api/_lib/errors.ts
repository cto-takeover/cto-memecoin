// Errors the relayer returns. NEAR's are passed through whole in `raw`; `type`
// and `message` are read off NEAR's object mechanically, never reworded.

export interface NearError {
  source: 'near';
  /** Path of keys in NEAR's error object, e.g. InvalidTxError.InvalidAccessKeyError.AccessKeyNotFound */
  type: string;
  /** The innermost value: NEAR's own string, or its JSON when it is an object. */
  message: string;
  /** NEAR's error object exactly as returned. */
  raw: unknown;
}

export interface RelayerError {
  source: 'relayer';
  type: 'BadRequest' | 'Forbidden' | 'RateLimited' | 'NotConfigured' | 'NeverCeo' | 'NoMatchingKey' | 'Internal';
  message: string;
}

export type ApiError = NearError | RelayerError;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Walks NEAR's error enum: through single-key objects, and through the one
 * object-valued key when its siblings are plain fields (ActionError's `index`).
 */
export function errorPath(value: unknown): { path: string[]; leaf: unknown } {
  const path: string[] = [];
  let node = value;
  while (isObject(node)) {
    const obj: Record<string, unknown> = node;
    const keys = Object.keys(obj);
    const objectKeys = keys.filter((k) => isObject(obj[k]));
    const next = keys.length === 1 ? keys[0] : objectKeys.length === 1 ? objectKeys[0] : undefined;
    if (next === undefined) break;
    path.push(next);
    node = obj[next];
  }
  return { path, leaf: node };
}

const leafText = (leaf: unknown) => (typeof leaf === 'string' ? leaf : JSON.stringify(leaf));

/** A JSON-RPC `error` object (transaction rejected before execution, or a handler error). */
export function fromRpcError(error: any): NearError {
  if (isObject(error?.data)) {
    const { path, leaf } = errorPath(error.data);
    // send_tx wraps validation errors in TxExecutionError; the type starts below it.
    const type = (path[0] === 'TxExecutionError' ? path.slice(1) : path).join('.');
    return { source: 'near', type, message: leafText(leaf), raw: error };
  }
  const type = [error?.name, error?.cause?.name].filter(Boolean).join('.') || 'RpcError';
  const message = typeof error?.data === 'string' ? error.data : leafText(error?.cause?.info ?? error?.message ?? error);
  return { source: 'near', type, message, raw: error };
}

/** An executed transaction whose status is `{ Failure: ... }`. */
export function fromFailure(failure: unknown): NearError {
  const { path, leaf } = errorPath(failure);
  return { source: 'near', type: path.join('.'), message: leafText(leaf), raw: { Failure: failure } };
}

export const relayerError = (type: RelayerError['type'], message: string): RelayerError => ({
  source: 'relayer',
  type,
  message,
});
