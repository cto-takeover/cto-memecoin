// "Supply over 60 days" from /sim/*.csv (spec 5): no hard-coded points.
import { useEffect, useState } from 'react';
import { usePoll } from '../hooks/hooks';

type Scenario = 'busy' | 'quiet' | 'abandoned';
const SCENARIOS: Scenario[] = ['busy', 'quiet', 'abandoned'];

interface Row {
  day: number;
  supply: number;
  price: number;
  burned: number;
  takeovers: number;
  event: string;
}

function parse(csv: string): Row[] {
  const [head, ...rows] = csv.trim().split('\n');
  const cols = head.split(',');
  const at = (name: string) => cols.indexOf(name);
  return rows.map((r) => {
    const c = r.split(',');
    return {
      day: Number(c[at('day')]),
      supply: Number(c[at('supply')]),
      price: Number(c[at('seat_price')]),
      burned: Number(c[at('burned_total')]),
      takeovers: Number(c[at('takeovers_total')]),
      event: c[at('event')] ?? '',
    };
  });
}

const fmtM = (n: number) => `${+(n / 1e6).toFixed(1)}M`;

export function SimChart() {
  const [tab, setTab] = useState<Scenario>('busy');
  const [drawKey, setDrawKey] = useState(0);
  const data = usePoll(() => fetch(`/sim/${tab}.csv`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`/sim/${tab}.csv: HTTP ${r.status}`)))).then(parse), null, [tab]);
  useEffect(() => setDrawKey((k) => k + 1), [tab]);
  const rows = data.data;

  const W = 720, H = 290, L = 60, R = 660, T = 24, B = 250;
  let chart = null;
  if (rows?.length) {
    const maxDay = rows[rows.length - 1].day;
    const sMax = Math.max(...rows.map((r) => r.supply));
    const sMin = Math.min(...rows.map((r) => r.supply));
    const sLo = sMin === sMax ? sMin - 1 : sMin - (sMax - sMin) * 0.05;
    const pMax = Math.max(...rows.map((r) => r.price)) * 1.05;
    const x = (d: number) => L + ((R - L) * d) / maxDay;
    const ys = (s: number) => T + 6 + ((B - T - 6) * (sMax - s)) / (sMax - sLo);
    const yp = (p: number) => B - ((B - T - 6) * p) / pMax;
    const supplyPts = rows.map((r) => `${x(r.day).toFixed(1)},${ys(r.supply).toFixed(1)}`).join(' ');
    const pricePts = rows.map((r) => `${x(r.day).toFixed(1)},${yp(r.price).toFixed(1)}`).join(' ');
    const last = rows[rows.length - 1];
    chart = (
      <>
        <svg key={drawKey} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${tab} scenario: supply falls from ${fmtM(sMax)} to ${fmtM(last.supply)} over ${maxDay} days with ${last.takeovers} takeovers; seat price peaks at ${fmtM(Math.max(...rows.map((r) => r.price)))}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'var(--color-card)', border: '2px solid var(--color-ink)' }}>
          <line x1={L} y1={B} x2={R} y2={B} stroke="#111111" strokeWidth="2" />
          <line x1={L} y1={T} x2={L} y2={B} stroke="#111111" strokeWidth="2" />
          <line x1={R} y1={T} x2={R} y2={B} stroke="#D7141A" strokeWidth="2" />
          <text x={L - 6} y={ys(sMax) + 4} textAnchor="end" fontFamily="JetBrains Mono" fontSize="11" fill="#111111">{fmtM(sMax)}</text>
          <text x={L - 6} y={ys(sMin) + 4} textAnchor="end" fontFamily="JetBrains Mono" fontSize="11" fill="#111111">{fmtM(sMin)}</text>
          <text x={R + 6} y={T + 10} fontFamily="JetBrains Mono" fontSize="11" fill="#D7141A">{fmtM(pMax / 1.05)}</text>
          <text x={R + 6} y={B + 2} fontFamily="JetBrains Mono" fontSize="11" fill="#D7141A">0</text>
          <polyline className="a-draw" pathLength={1} points={pricePts} fill="none" stroke="#D7141A" strokeWidth="3" strokeLinejoin="round" />
          <polyline className="a-draw" pathLength={1} points={supplyPts} fill="none" stroke="#111111" strokeWidth="4" strokeLinejoin="round" />
          {rows.filter((r) => r.event === 'takeover').map((r) => (
            <circle key={r.day} cx={x(r.day)} cy={ys(r.supply)} r="4" fill="#D7141A" stroke="#111111" strokeWidth="1.5" />
          ))}
          <text x={L + 4} y={B + 22} fontFamily="JetBrains Mono" fontSize="12" fill="#5C5346">day 0</text>
          <text x={R - 48} y={B + 22} fontFamily="JetBrains Mono" fontSize="12" fill="#5C5346">day {maxDay}</text>
        </svg>
        <div className="g3 mono" style={{ marginTop: 12, fontSize: 14 }}>
          <div>
            <span className="muted">takeovers</span>
            <br />
            <b>{last.takeovers}</b>
          </div>
          <div>
            <span className="muted">burned</span>
            <br />
            <b>{last.burned.toLocaleString('en-US')} CTO</b>
          </div>
          <div>
            <span className="muted">supply on day {maxDay}</span>
            <br />
            <b>{last.supply.toLocaleString('en-US')}</b>
          </div>
        </div>
      </>
    );
  }

  return (
    <section className="card" style={{ boxShadow: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, alignItems: 'end', marginBottom: 14 }}>
        <div>
          <h2 className="hd" style={{ fontSize: 28 }}>
            SUPPLY OVER 60 DAYS
          </h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            The mechanic, not a price prediction. Scripted scenarios from the main coin's launch rules, computed with the contract's own price code.{' '}
            <b style={{ color: 'var(--color-ink)' }}>Black: supply.</b> <b style={{ color: 'var(--color-red)' }}>Red: seat price.</b> Dots: takeovers.
          </p>
        </div>
        <div role="tablist" aria-label="Scenario" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {SCENARIOS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={tab === s} className="tab" onClick={() => setTab(s)}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {data.error ? <p className="mono">Could not load the simulation: {String((data.error as Error).message)}</p> : chart ?? <p className="mono muted">Loading /sim/{tab}.csv…</p>}
    </section>
  );
}
