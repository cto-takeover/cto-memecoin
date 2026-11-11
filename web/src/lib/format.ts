// Display helpers. Amounts arrive as base-unit strings (18 decimals); whole CTO
// rounds down like the contract's own messages.
const ONE = 10n ** 18n;

export const big = (v: string | bigint | number | null | undefined) => BigInt(v ?? 0);

/** 1400000000000000000000000 -> "1,400,000" */
export function cto(amount: string | bigint | null | undefined): string {
  return (big(amount) / ONE).toLocaleString('en-US');
}

export const wholeToBase = (whole: string | number) => (BigInt(whole) * ONE).toString();

/** Ticker only: 1,400,000 -> "1.4M". */
export function ctoShort(amount: string | bigint): string {
  const n = Number(big(amount) / ONE);
  if (n >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/** yoctoNEAR -> "12.34" */
export function near(yocto: string | bigint, digits = 2): string {
  const v = big(yocto);
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, '0').slice(0, digits);
  return digits ? `${whole.toLocaleString('en-US')}.${frac}` : whole.toLocaleString('en-US');
}

/** Ratio string from get_config, "7/5" -> 1.4 */
export function ratio(s: string | undefined): number {
  const [n, d] = (s ?? '').split('/').map(Number);
  return d ? n / d : NaN;
}

/** 1.15 -> "1.15x" */
export const times = (x: number) => `${+x.toFixed(2)}x`;

/** "4d 19h 12m 30s" (drops leading zero units). */
export function countdown(totalSeconds: number): string {
  let s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts = [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s}s`].filter(Boolean);
  return parts.join(' ');
}

/** "2d 4h", "3h 10m", "45s" */
export function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** "2 MIN AGO" style, from a block timestamp in ns. */
export function ago(atNs: string | number | bigint, nowMs = Date.now()): string {
  const s = Math.max(0, Math.floor((nowMs - Number(big(atNs) / 1_000_000n)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const nsToDate = (ns: string | number | bigint) => new Date(Number(big(ns) / 1_000_000n));

/** "4Tn…w8E" */
export const shortHash = (h: string) => (h.length > 10 ? `${h.slice(0, 3)}…${h.slice(-3)}` : h);

/** "ed25519:7xQ…ani" style */
export function shortKey(k: string): string {
  const [curve, body] = k.includes(':') ? k.split(':') : ['', k];
  return `${curve ? `${curve}:` : ''}${body.slice(0, 4)}…${body.slice(-4)}`;
}

export const shortDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** 604800 -> "7 days", 120 -> "2 minutes" (for rule sentences). */
export function durationWords(s: number): string {
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (s % 86400 === 0) return unit(s / 86400, 'day');
  if (s % 3600 === 0) return unit(s / 3600, 'hour');
  if (s % 60 === 0) return unit(s / 60, 'minute');
  return unit(s, 'second');
}
