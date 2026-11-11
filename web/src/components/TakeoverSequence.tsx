// The takeover sequence (mockup 2b). Plays only after the transaction succeeded;
// every number comes from the new get_history entry.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCoinLink, useReducedMotion } from '../hooks/hooks';
import { cto, shortHash } from '../lib/format';
import type { Face } from '../lib/faces';
import type { Takeover } from '../lib/types';
import { CountUp, FaceImg, Flame, TxChip } from './bits';

export interface SequenceData {
  takeover: Takeover;
  oldFace: Face;
  burnedTotal: string;
  burnedBefore: string;
  txHash: string;
  contractId: string;
  /** Wallet mode: offer the voice key file. */
  onDownloadKey?: () => void;
}

const STEPS = [0, 450, 950, 1600, 2700, 3100, 3700]; // ms: fired, out, drop, headline, payout, burn, buttons

export function TakeoverSequence({ data, onClose }: { data: SequenceData; onClose: () => void }) {
  const reduced = useReducedMotion();
  const link = useCoinLink();
  const [step, setStep] = useState(reduced ? STEPS.length : 0);
  const [run, setRun] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { takeover: t } = data;
  const headline = `BREAKING: ${t.ceo} IS THE NEW CEO`;
  const [typed, setTyped] = useState(reduced ? headline.length : 0);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (reduced) {
      setStep(STEPS.length);
      setTyped(headline.length);
      return;
    }
    setStep(0);
    setTyped(0);
    const timers = STEPS.map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    let typer: ReturnType<typeof setInterval> | undefined;
    timers.push(
      setTimeout(() => {
        typer = setInterval(() => setTyped((n) => (n >= headline.length ? n : n + 1)), 28);
      }, STEPS[3]),
    );
    return () => {
      timers.forEach(clearTimeout);
      if (typer) clearInterval(typer);
    };
  }, [run, reduced, headline.length]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Takeover complete" style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50, overflowY: 'auto' }}>
      <div className="halftone a-toast" style={{ backgroundColor: 'var(--color-paper)', border: '4px solid var(--color-ink)', boxShadow: '8px 8px 0 var(--color-ink)', maxWidth: 760, width: '100%', padding: 'clamp(14px, 4vw, 24px)', display: 'grid', gap: 18, boxSizing: 'border-box', margin: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>
            TX {shortHash(data.txHash)} · burned · done
          </span>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, minHeight: 230, flexWrap: 'wrap' }} aria-hidden="true">
          {step < 3 && (
            <div className={step >= 2 ? 'a-out' : ''} style={{ position: 'relative', width: 'min(200px, 40vw)' }}>
              <div className="card" style={{ padding: 8 }}>
                <FaceImg face={data.oldFace} size={200} label="" />
              </div>
              {step >= 1 && t.previous_ceo && (
                <span className="stamp a-thunk" style={{ position: 'absolute', top: 70, left: -14, color: 'var(--color-red)', fontSize: 34 }}>
                  FIRED!
                </span>
              )}
            </div>
          )}
          {step >= 3 && (
            <div className="a-drop" style={{ position: 'relative', width: 'min(200px, 40vw)' }}>
              <div className="card" style={{ padding: 8 }}>
                <FaceImg face={t.face} size={200} label="" />
              </div>
              <span className="stamp a-thunk" style={{ position: 'absolute', top: -16, right: -14, color: 'var(--color-ink)', background: 'var(--color-near)', borderColor: 'var(--color-ink)', fontSize: 24, animationDelay: '.4s' }}>
                NEW CEO
              </span>
            </div>
          )}
        </div>

        <p className="hd" style={{ fontSize: 'clamp(24px, 5vw, 34px)', textAlign: 'center', minHeight: '1.1em', overflowWrap: 'anywhere' }} aria-live="polite">
          {step >= 4 ? headline.slice(0, typed) : ''}
          {step >= 4 && typed < headline.length && <span className="cursor" />}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, minHeight: 84 }}>
          {step >= 5 && (
            <div className="a-toast" style={{ background: t.previous_ceo ? 'var(--color-near)' : 'var(--color-card)', border: '3px solid var(--color-ink)', boxShadow: '4px 4px 0 var(--color-ink)', padding: 12 }}>
              <p className="kick" style={{ margin: 0 }}>
                {t.previous_ceo ? 'Paid to leave' : 'Seat was vacant'}
              </p>
              <p className="mono" style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 700, overflowWrap: 'anywhere' }}>
                {t.previous_ceo ? `+${cto(t.payout)} CTO → ${t.previous_ceo}` : 'nobody to pay: all of it burns'}
              </p>
            </div>
          )}
          {step >= 6 && (
            <div className="a-toast" style={{ background: 'var(--color-card)', border: '3px solid var(--color-ink)', boxShadow: '4px 4px 0 var(--color-ink)', padding: 12 }}>
              <p className="kick" style={{ margin: 0, color: 'var(--color-red)' }}>
                Total burned (+{cto(t.burned)})
              </p>
              <p className="mono" style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Flame />
                <CountUp key={run} from={BigInt(data.burnedBefore)} value={BigInt(data.burnedTotal)} format={cto} />
              </p>
            </div>
          )}
        </div>

        {step >= 7 && (
          <div className="a-rise" style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link className="btn" to={link('/press')}>
              GO TO THE PRESS OFFICE →
            </Link>
            <TxChip hash={data.txHash} account={data.contractId} label="view on explorer" />
            {!reduced && (
              <button type="button" className="ghost" onClick={() => setRun((r) => r + 1)}>
                ↺ Replay
              </button>
            )}
          </div>
        )}
        {data.onDownloadKey && (
          <div className="card" style={{ background: 'var(--color-hi)' }}>
            <p className="kick">Your voice key</p>
            <p style={{ margin: '0 0 10px' }}>Lose this and you can't post as the coin until someone takes the seat.</p>
            <button type="button" className="ghost" onClick={data.onDownloadKey}>
              ⤓ Download cto-voice-key.json
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
