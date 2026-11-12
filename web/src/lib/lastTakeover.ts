// The takeover this browser tab made, so the Press office can feature it even
// after other visitors take the seat (the ex-CEO panel stays on "your" story).
const storageKey = (contractId: string) => `cto:my-takeover:${contractId}`;

export function rememberTakeover(contractId: string, index: number): void {
  try {
    sessionStorage.setItem(storageKey(contractId), String(index));
  } catch {
    // private mode: the Press office falls back to the latest takeover
  }
}

export function recallTakeover(contractId: string): number | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey(contractId));
    const index = raw === null ? NaN : Number(raw);
    return Number.isInteger(index) && index >= 0 ? index : undefined;
  } catch {
    return undefined;
  }
}
