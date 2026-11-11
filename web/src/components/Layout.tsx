import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { COINS, type CoinKey } from '../config';
import { CoinDataProvider, useCoinData } from '../hooks/coinData';
import { useCoin, useCoinKey, useCoinLink } from '../hooks/hooks';
import { cto, ctoShort, ratio, times } from '../lib/format';

const SECTIONS = [
  ['/', 'Front page'],
  ['/takeover', 'Takeover desk'],
  ['/press', 'Press office'],
  ['/receipts', 'Receipts'],
] as const;

export function Layout() {
  const coin = useCoin();
  return (
    <CoinDataProvider contractId={coin.contractId} key={coin.contractId}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <a href="#main" className="sr-only focus:not-sr-only" style={{ position: 'absolute', left: 8, top: 8, zIndex: 60, background: 'var(--color-hi)', padding: 8 }}>
          Skip to content
        </a>
        <Masthead />
        <main id="main" style={{ overflowX: 'clip', flex: 1, width: '100%', maxWidth: 1160, margin: '0 auto', padding: '28px 16px 44px', display: 'grid', gap: 30, boxSizing: 'border-box', alignContent: 'start' }}>
          <Outlet />
        </main>
        <footer className="mono" style={{ borderTop: '4px solid var(--color-ink)', padding: '14px 24px', fontSize: 12, textAlign: 'center' }}>
          Testnet only · no sale · no admin keys · open source · CTO is a hackathon testnet experiment, not an investment.
        </footer>
      </div>
    </CoinDataProvider>
  );
}

function Masthead() {
  const { state, fullAccessKeys, contractId } = useCoinData();
  const link = useCoinLink();
  const takeovers = state?.history.length ? state.history[0].index + 1 : 0;
  const today = new Date()
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .replace(/,/g, '')
    .toUpperCase();
  return (
    <header style={{ borderBottom: '4px solid var(--color-ink)', background: 'var(--color-paper)' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '18px 16px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, boxSizing: 'border-box' }}>
        <div>
          <p className="mono" style={{ margin: '0 0 4px', fontSize: 11, letterSpacing: '.1em' }}>
            VOL. 1 · NO. {state ? takeovers + 1 : '…'} · TESTNET EDITION · {today}
          </p>
          <p className="hd" style={{ fontSize: 'clamp(34px, 7vw, 46px)' }}>
            <Link to={link('/')} style={{ textDecoration: 'none' }}>
              THE CTO TIMES
            </Link>
          </p>
          <p className="mono" style={{ margin: '6px 0 0', fontSize: 12 }}>
            There can only be one CEO · contract {contractId} · owner keys: {fullAccessKeys ?? '…'}
          </p>
        </div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <CoinSwitch />
          <nav aria-label="Sections" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SECTIONS.map(([path, label]) => (
              <NavLink key={path} to={link(path)} end className="navp">
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
      <Ticker />
    </header>
  );
}

function CoinSwitch() {
  const current = useCoinKey();
  const { pathname } = useLocation();
  const to = (k: CoinKey) => (k === 'main' ? `${pathname}?coin=main` : pathname);
  return (
    <div role="group" aria-label="Which coin" style={{ display: 'flex', gap: 0 }} className="mono">
      {(['demo', 'main'] as const).map((k) => (
        <Link
          key={k}
          to={to(k)}
          aria-current={k === current ? 'true' : undefined}
          className="chip"
          style={{
            minHeight: 32,
            fontWeight: 700,
            background: k === current ? 'var(--color-ink)' : 'var(--color-card)',
            color: k === current ? 'var(--color-paper)' : 'var(--color-ink)',
          }}
        >
          {COINS[k].label.toUpperCase()} · {COINS[k].contractId}
        </Link>
      ))}
    </div>
  );
}

function Ticker() {
  const { state, config } = useCoinData();
  if (!state) return <div className="ticker mono" style={{ fontSize: 13, minHeight: 36 }} />;
  const { seat, history, announcements, burned } = state;
  const take = ratio(config?.takeover_ratio);
  const pay = ratio(config?.payout_ratio);
  const items = [
    history[0] ? `BREAKING: ${history[0].ceo} takes the seat` : `Seat open: ${cto(seat.current_price)} CTO`,
    `${ctoShort(burned)} CTO burned so far`,
    `Seat price now ${ctoShort(seat.current_price)} CTO`,
    announcements[0] ? `${announcements[0].ceo}: "${announcements[0].text}"` : 'No press releases yet',
    'No admin keys. Rules are final.',
    Number.isFinite(take * pay) ? `Fired CEOs get paid ${times(take * pay)}` : 'Fired CEOs get paid',
    'Testnet only · no sale',
  ];
  const run = (hidden: boolean) => (
    <>
      <span aria-hidden={hidden || undefined}>
        <span className="dot" />
        LIVE
      </span>
      {items.map((t, i) => (
        <span key={i} aria-hidden={hidden || undefined}>
          ★ {t}
        </span>
      ))}
    </>
  );
  return (
    <div className="ticker mono" style={{ fontSize: 13 }} aria-label="Live news ticker">
      <div className="ticker-track">
        {run(false)}
        {run(true)}
      </div>
    </div>
  );
}
