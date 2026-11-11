import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { explorerAccount, explorerTx } from '../config';
import { useReducedMotion } from '../hooks/hooks';
import { faceDataUri, faceLabel, type Face } from '../lib/faces';
import { shortHash } from '../lib/format';

export function FaceImg({ face, size = 200, label, className, style }: { face: Face; size?: number; label?: string; className?: string; style?: CSSProperties }) {
  return (
    <img
      src={faceDataUri(face)}
      alt={label ?? faceLabel(face)}
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', maxWidth: '100%', height: 'auto', ...style }}
    />
  );
}

export function Flame({ size = 24 }: { size?: number }) {
  return (
    <span className="a-flame" aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block' }}>
        <path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z" fill="#D7141A" stroke="#111111" strokeWidth="2" />
        <path d="M12 13c1 2 3 3 3 5a3 3 0 0 1-6 0c0-1 1-2 1-3 1 1 2 0 2-2z" fill="#FFD60A" />
      </svg>
    </span>
  );
}

/** A tx hash chip linking to the explorer; without a hash it links to the account page. */
export function TxChip({ hash, account, label, suffix = '↗' }: { hash?: string; account: string; label?: string; suffix?: string }) {
  if (hash) {
    return (
      <a className="chip" href={explorerTx(hash)} target="_blank" rel="noreferrer" title={hash}>
        {label ? `${shortHash(hash)} · ${label}` : shortHash(hash)} {suffix}
        <span className="sr-only"> (transaction {hash} on the explorer, opens a new tab)</span>
      </a>
    );
  }
  return (
    <a className="chip" href={explorerAccount(account)} target="_blank" rel="noreferrer">
      {label ?? 'explorer'} {suffix}
      <span className="sr-only"> ({account} on the explorer, opens a new tab)</span>
    </a>
  );
}

/** Resolves a tx hash asynchronously (see lib/txlinks). */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): T | undefined {
  const [v, setV] = useState<T | undefined>(undefined);
  useEffect(() => {
    let live = true;
    load().then((x) => live && setV(x)).catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

/** Counts up to `value` (whole units) over ~0.8 s; static when motion is reduced. */
export function CountUp({ value, format, from: start0 }: { value: bigint; format: (v: bigint) => string; from?: bigint }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : (start0 ?? value));
  const from = useRef(start0 ?? value);
  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 800);
      const eased = 1 - (1 - k) ** 3;
      const scaled = BigInt(Math.round(eased * 1e6));
      setShown(start + ((value - start) * scaled) / 1_000_000n);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <>{format(shown)}</>;
}

export function Loading({ what = 'Reading the chain…' }: { what?: string }) {
  return (
    <p className="mono muted" role="status" style={{ margin: 0 }}>
      {what}
    </p>
  );
}

export function ReadError({ error }: { error: unknown }) {
  return (
    <div className="card" role="alert" style={{ background: 'var(--color-reject)' }}>
      <p className="kick">Could not read the chain</p>
      <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>
        {error instanceof Error ? error.message : JSON.stringify(error)}
      </pre>
    </div>
  );
}

export function Section({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={className} style={style}>
      {children}
    </section>
  );
}
