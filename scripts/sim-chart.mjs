// README chart for spec 5: the busy scenario as two small multiples sharing the
// day axis (seat price, burned total). Reads web/public/sim/busy.csv, the same
// file the Receipts screen charts, so the README can't drift from the simulation.
//   node scripts/sim-chart.mjs           writes docs/sim-busy.svg
//   node scripts/sim-chart.mjs --check   fails if docs/sim-busy.svg is stale
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV = join(ROOT, 'web/public/sim/busy.csv');
const OUT = join(ROOT, 'docs/sim-busy.svg');
const TOTAL_SUPPLY = Number(JSON.parse(readFileSync(join(ROOT, 'reference/constants.json'), 'utf8')).total_supply);

const [header, ...rows] = readFileSync(CSV, 'utf8').trim().split('\n');
const cols = header.split(',');
const data = rows.map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
const days = data.map((r) => Number(r.day));
const price = data.map((r) => Number(r.seat_price) / 1e6);
const burned = data.map((r) => Number(r.burned_total) / 1e6);
const last = data.at(-1);
const takeovers = Number(last.takeovers_total);

const C = { paper: '#FFF6E0', ink: '#111111', red: '#D7141A', muted: '#5C5346', grid: '#E6DCC4' };
const W = 880, H = 470, L = 64, R = 96;
const MONO = "font-family=\"'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace\"";
const SANS = "font-family=\"'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif\"";
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const x = (d) => L + ((W - L - R) * d) / days.at(-1);

/** Upper bound of the y axis: a round step above the max. */
const niceMax = (max, step) => Math.ceil(max / step) * step;

function panel({ top, height, values, max, step, color, title, endLabel, dots }) {
  const y = (v) => top + height - (height * v) / max;
  const out = [];
  out.push(`<text x="${L}" y="${top - 14}" ${SANS} font-size="15" font-weight="700" fill="${C.ink}">${title}</text>`);
  for (let v = 0; v <= max; v += step) {
    out.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? C.ink : C.grid}" stroke-width="${v === 0 ? 1.5 : 1}"/>`);
    out.push(`<text x="${L - 8}" y="${y(v) + 4}" ${MONO} font-size="12" text-anchor="end" fill="${C.muted}">${v}M</text>`);
  }
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(days[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');
  out.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  for (const i of dots ?? []) {
    out.push(`<circle cx="${x(days[i]).toFixed(1)}" cy="${y(values[i]).toFixed(1)}" r="4" fill="${color}" stroke="${C.paper}" stroke-width="2"/>`);
  }
  const lv = values.at(-1);
  out.push(`<text x="${W - R + 10}" y="${y(lv) + 4}" ${MONO} font-size="13" font-weight="700" fill="${C.ink}">${endLabel}</text>`);
  return out.join('\n  ');
}

const takeoverRows = data.flatMap((r, i) => (r.event === 'takeover' ? [i] : []));
const pTop = 112, pH = 120, bTop = 290, bH = 110;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
  <title id="t">CTO 60-day simulation, busy scenario</title>
  <desc id="d">${takeovers} takeovers in 60 days. The seat price climbs 1.4x per takeover to ${fmt(Number(last.seat_price))} CTO on day 60, and ${fmt(Number(last.burned_total))} CTO is burned, leaving a supply of ${fmt(Number(last.supply))}.</desc>
  <rect width="${W}" height="${H}" fill="${C.paper}" stroke="${C.ink}" stroke-width="3"/>
  <text x="${L}" y="40" font-family="'Archivo Black', 'Arial Black', Impact, sans-serif" font-size="22" fill="${C.ink}">Busy scenario: ${takeovers} takeovers in 60 days</text>
  <text x="${L}" y="64" ${SANS} font-size="14" fill="${C.muted}">The mechanic, not a price prediction. Generated from contract/src/price.rs by contract/examples/sim.rs.</text>
  ${panel({ top: pTop, height: pH, values: price, max: niceMax(Math.max(...price), 10), step: 10, color: C.ink, title: 'Seat price (million CTO) · dot = takeover', endLabel: `${price.at(-1).toFixed(1)}M`, dots: takeoverRows })}
  ${panel({ top: bTop, height: bH, values: burned, max: niceMax(Math.max(...burned), 10), step: 10, color: C.red, title: 'Burned since launch (million CTO)', endLabel: `${burned.at(-1).toFixed(1)}M` })}
  ${[0, 10, 20, 30, 40, 50, 60].map((d) => `<text x="${x(d)}" y="${bTop + bH + 22}" ${MONO} font-size="12" text-anchor="middle" fill="${C.muted}">day ${d}</text>`).join('\n  ')}
  <text x="${L}" y="${H - 18}" ${MONO} font-size="13" fill="${C.ink}">Day 60: supply ${fmt(Number(last.supply))} · burned ${fmt(Number(last.burned_total))} (${((100 * Number(last.burned_total)) / TOTAL_SUPPLY).toFixed(1)}% of supply)</text>
</svg>
`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8');
  if (current !== svg) {
    console.error('docs/sim-busy.svg is stale: run node scripts/sim-chart.mjs');
    process.exit(1);
  }
  console.log('sim chart: ok');
} else {
  writeFileSync(OUT, svg);
  console.log(`wrote ${OUT}`);
}
