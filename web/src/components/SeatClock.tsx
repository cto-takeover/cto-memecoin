// Decay countdown + bar, ticking every second between 3 s polls.
import type { ConfigView, SeatView } from '../lib/types';
import { countdown, durationWords } from '../lib/format';
import { useNow } from '../hooks/hooks';

export function seatPhase(seat: SeatView, config: ConfigView | undefined, now: number) {
  if (seat.vacant || !seat.since_ns || !config) return { phase: 'vacant' as const, idle: 0, left: 0, fill: 0 };
  const idle = Math.max(0, (now - Number(BigInt(seat.since_ns) / 1_000_000n)) / 1000);
  const D = config.decay_delay_s;
  const L = config.decay_length_s;
  if (idle <= D) return { phase: 'full' as const, idle, left: D - idle, fill: idle / D };
  if (idle < D + L) return { phase: 'decaying' as const, idle, left: D + L - idle, fill: (idle - D) / L };
  return { phase: 'floor' as const, idle, left: 0, fill: 1 };
}

export function SeatClock({ seat, config }: { seat: SeatView; config: ConfigView | undefined }) {
  const now = useNow(1000);
  if (!config || seat.vacant) return null;
  const p = seatPhase(seat, config, now);
  const decaying = p.phase !== 'full';
  return (
    <div style={{ maxWidth: 440 }}>
      <div className="rrow mono" style={{ fontSize: 12, padding: '0 0 4px', flexWrap: 'wrap' }}>
        <span>{p.phase === 'full' ? 'Full price window' : p.phase === 'decaying' ? 'Price dropping' : 'At the floor'}</span>
        <span aria-live="off">
          {p.phase === 'full' && (
            <>
              decay starts in <b>{countdown(p.left)}</b>
            </>
          )}
          {p.phase === 'decaying' && (
            <>
              floor in <b>{countdown(p.left)}</b>
            </>
          )}
          {p.phase === 'floor' && <b>opening price</b>}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={decaying ? 'Price decay progress' : 'Full price window used'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(p.fill * 100)}
        style={{ height: 14, border: '2px solid var(--color-ink)', background: 'var(--color-card)' }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(100, p.fill * 100)}%`,
            background: decaying ? 'var(--color-red)' : 'var(--color-hi)',
            borderRight: p.fill > 0 && p.fill < 1 ? '2px solid var(--color-ink)' : undefined,
            boxSizing: 'border-box',
          }}
        />
      </div>
      <p className="mono muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
        After {durationWords(config.decay_delay_s)} idle the price slides down over {durationWords(config.decay_length_s)} more. The seat never gets stuck.
      </p>
    </div>
  );
}
