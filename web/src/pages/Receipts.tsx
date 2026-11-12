import { useCallback, useEffect, useState } from 'react';
import { COINS, REPO_URL } from '../config';
import { useCoinData } from '../hooks/coinData';
import { pause, usePoll, useReducedMotion } from '../hooks/hooks';
import { Loading, ReadError, TxChip, useAsync } from '../components/bits';
import { SimChart } from '../components/SimChart';
import { cto, durationWords, ratio, shortHash } from '../lib/format';
import { runLiveChecks, type Check } from '../lib/liveChecks';
import { view, viewAccount } from '../lib/rpc';
import { announcementTx, deployTx, takeoverTx } from '../lib/txlinks';
import type { Announcement, ConfigView, Takeover } from '../lib/types';

type Step = { at: bigint; key: string; text: string; tx: () => Promise<string | undefined> };

export function Receipts() {
  const { state, error, config, contractId, fullAccessKeys } = useCoinData();
  const reduced = useReducedMotion();
  // Optional static files; a missing one comes back as the SPA's index.html, so check the type.
  const isType = (r: Response, t: string) => r.ok && (r.headers.get('content-type') ?? '').includes(t);
  const buildInfo = usePoll(() => fetch('/build-info.json').then((r) => (isType(r, 'json') ? r.json() : null)).catch(() => null), null, []);
  const ciOutput = usePoll(() => fetch('/verify.txt').then((r) => (isType(r, 'text/plain') ? r.text() : null)).catch(() => null), null, []);
  const codeHash = usePoll(() => viewAccount(contractId).then((a) => a.code_hash), null, [contractId]);
  const history = usePoll(() => view<Takeover[]>(contractId, 'get_history', { from_index: 0, limit: 50 }), null, [contractId]);

  const [checks, setChecks] = useState<Check[] | null>(null);
  const [shown, setShown] = useState(0);
  const [checkError, setCheckError] = useState<unknown>(null);
  const run = useCallback(async () => {
    setChecks(null);
    setShown(0);
    setCheckError(null);
    try {
      const result = await runLiveChecks(contractId, buildInfo.data?.codeHash);
      setChecks(result);
      for (let i = 1; i <= result.length; i++) {
        await pause(220, reduced);
        setShown(i);
      }
    } catch (e) {
      setCheckError(e);
    }
  }, [contractId, buildInfo.data, reduced]);
  useEffect(() => {
    if (buildInfo.data !== undefined) void run();
  }, [run, buildInfo.data]);

  if (!state) return error ? <ReadError error={error} /> : <Loading />;
  const allPass = checks !== null && shown === checks.length && checks.every((c) => c.pass);

  const steps: Step[] = [
    ...(history.data ?? []).map((t) => ({
      at: BigInt(t.at_ns),
      key: `t${t.index}`,
      text: t.previous_ceo
        ? `${t.ceo} takes over · ${t.previous_ceo} paid ${cto(t.payout)} · ${cto(t.burned)} burned`
        : `${t.ceo} takes the vacant seat · ${cto(t.burned)} burned`,
      tx: () => takeoverTx(contractId, t),
    })),
    ...state.announcements.map((a: Announcement) => ({
      at: BigInt(a.at_ns),
      key: `a${a.index}`,
      text: `${a.ceo} posts as the coin: line ${a.line}`,
      tx: () => announcementTx(contractId, a),
    })),
  ]
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(-7);

  return (
    <>
      <section style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: 16 }}>
        <div>
          <p className="kick">Receipts · the calm page</p>
          <h1 className="hd" style={{ fontSize: 'clamp(40px, 8vw, 56px)' }}>
            RECEIPTS
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 18 }}>Every claim on the front page, with its transaction. No stickers on numbers here.</p>
        </div>
        {allPass && (
          <span className="stamp a-thunk" style={{ color: 'var(--color-ink)', background: 'var(--color-near)', borderColor: 'var(--color-ink)' }}>
            VERIFIED
          </span>
        )}
      </section>

      <section className="g2">
        <div className="card" style={{ boxShadow: 'none' }}>
          <h2 className="kick">On chain, step by step</h2>
          <StepRow i={0} ok={fullAccessKeys === 0} text={`Deploy · full-access keys on ${contractId}: ${fullAccessKeys ?? '…'}`} tx={() => deployTx(contractId)} contractId={contractId} />
          {steps.map((s, i) => (
            <StepRow key={s.key} i={i + 1} ok text={s.text} tx={s.tx} contractId={contractId} />
          ))}
          {steps.length === 0 && <p className="muted" style={{ margin: '12px 0 0' }}>No takeovers yet.</p>}
          <p className="mono muted" style={{ margin: '12px 0 0', fontSize: 12 }}>
            A rejected post never lands on chain, so it has no receipt: NEAR refuses it before it runs.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <div style={{ background: 'var(--color-ink)', border: '3px solid var(--color-ink)', padding: 18, minHeight: 240 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="mono" style={{ color: 'var(--color-paper)', fontSize: 13 }}>
                $ live checks · {contractId} · from this browser
              </span>
              <button type="button" className="chip" style={{ background: 'var(--color-paper)', cursor: 'pointer' }} onClick={() => void run()}>
                ↺ Run again
              </button>
            </div>
            <div className="mono" style={{ color: 'var(--color-near)', fontSize: 14, lineHeight: 1.7 }} aria-live="polite">
              {checks?.slice(0, shown).map((c) => (
                <div key={c.name} className="a-rise" style={{ animationDuration: '.2s', color: c.pass ? 'var(--color-near)' : '#FF8A8A' }}>
                  {c.pass ? 'PASS' : 'FAIL'}&nbsp; {c.name}
                  {!c.pass && c.detail ? ` (saw ${c.detail})` : ''}
                </div>
              ))}
              {checks && shown === checks.length && (
                <div style={{ color: 'var(--color-paper)' }}>
                  {checks.filter((c) => c.pass).length} passed{checks.some((c) => !c.pass) ? ` · ${checks.filter((c) => !c.pass).length} failed` : ''} · no keys needed
                </div>
              )}
              {checkError ? <div style={{ color: '#FF8A8A' }}>could not run: {String((checkError as Error).message ?? checkError)}</div> : null}
              <span className="cursor" style={{ color: 'var(--color-paper)' }} />
            </div>
            {ciOutput.data && (
              <details style={{ marginTop: 12 }}>
                <summary className="mono" style={{ color: 'var(--color-paper)', cursor: 'pointer', fontSize: 13, minHeight: 32 }}>
                  $ npm run verify · latest CI run (incl. Rust tests and the simulation)
                </summary>
                <pre className="mono" style={{ color: 'var(--color-near)', whiteSpace: 'pre-wrap', fontSize: 13, margin: '8px 0 0' }}>
                  {ciOutput.data}
                </pre>
              </details>
            )}
            <p className="mono" style={{ margin: '2px 0 0', fontSize: 12 }}>
              <a href={`${REPO_URL}/actions`} style={{ color: 'var(--color-paper)', display: 'inline-flex', alignItems: 'center', minHeight: 44 }} target="_blank" rel="noreferrer">
                All 12 checks run in CI on every push ↗
              </a>
            </p>
          </div>

          <div className="card" style={{ boxShadow: 'none' }}>
            <h2 className="kick">No owner keys</h2>
            <RulesTable config={config} fullAccessKeys={fullAccessKeys} codeHash={codeHash.data} />
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
              Read live from {contractId} with view calls.
            </p>
          </div>
        </div>
      </section>

      <SimChart />
      <ConfigCompare />
    </>
  );
}

function StepRow({ i, ok, text, tx, contractId }: { i: number; ok: boolean; text: string; tx: () => Promise<string | undefined>; contractId: string }) {
  const hash = useAsync(tx, [text]);
  return (
    <div className="a-rise" style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '2px solid var(--color-rule)', animationDelay: `${i * 0.15}s` }}>
      <span
        className="mono a-thunk"
        aria-label={ok ? 'done' : 'not yet'}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: '2px solid var(--color-ink)', background: ok ? 'var(--color-near)' : 'var(--color-card)', color: ok ? 'var(--color-ink)' : 'var(--color-red)', fontWeight: 700, transform: 'none', animationDelay: `${0.2 + i * 0.15}s` }}
      >
        {ok ? '✓' : '✗'}
      </span>
      <span style={{ overflowWrap: 'anywhere' }}>{text}</span>
      <TxChip hash={hash} account={contractId} />
    </div>
  );
}

function RulesTable({ config, fullAccessKeys, codeHash }: { config?: ConfigView; fullAccessKeys?: number; codeHash?: string }) {
  if (!config) return <Loading />;
  const take = ratio(config.takeover_ratio);
  const pay = ratio(config.payout_ratio);
  const rows: [string, string][] = [
    ['full-access keys', String(fullAccessKeys ?? '…')],
    ['takeover price', `${+take.toFixed(2)}x what the CEO paid (${config.takeover_ratio})`],
    ['old CEO payout', `${+(take * pay).toFixed(2)}x (${config.payout_ratio} of the price)`],
    ['burn', `${+(take * (1 - pay)).toFixed(2)}x (the rest)`],
    ['opening price / floor', `${cto(config.opening_price)} CTO`],
    ['decay', `${durationWords(config.decay_delay_s)} idle, then ${durationWords(config.decay_length_s)} down`],
    ['voice key', `may only call ${config.voice_key_method} · ${Number(BigInt(config.voice_key_allowance) / 10n ** 20n) / 10_000} NEAR allowance`],
    ['code hash', codeHash ? shortHash(codeHash) : '…'],
  ];
  return (
    <div className="mono" style={{ fontSize: 14, display: 'grid', gap: 2 }}>
      {rows.map(([k, v]) => (
        <div className="rrow" key={k} style={{ flexWrap: 'wrap' }}>
          <span>{k}</span>
          <b style={{ textAlign: 'right' }}>{v}</b>
        </div>
      ))}
    </div>
  );
}

function ConfigCompare() {
  const configs = usePoll(
    () =>
      Promise.all(
        (['demo', 'main'] as const).map((k) =>
          view<ConfigView>(COINS[k].contractId, 'get_config').then(
            (c) => [k, c] as const,
            () => [k, null] as const,
          ),
        ),
      ),
    null,
    [],
  );
  if (!configs.data) return null;
  const rows: [string, (c: ConfigView) => string][] = [
    ['name / symbol', (c) => `${c.name} / ${c.symbol}`],
    ['opening price', (c) => `${cto(c.opening_price)} CTO`],
    ['decay', (c) => `${durationWords(c.decay_delay_s)} idle, then ${durationWords(c.decay_length_s)} down`],
    ['faucet', (c) => `${cto(c.faucet_amount)} CTO per account`],
    ['takeover / payout', (c) => `${c.takeover_ratio} / ${c.payout_ratio}`],
  ];
  return (
    <section className="card" style={{ boxShadow: 'none' }}>
      <h2 className="hd" style={{ fontSize: 28, marginBottom: 12 }}>
        MAIN COIN VS DEMO COIN
      </h2>
      <p className="muted" style={{ margin: '0 0 12px' }}>
        Same code, different launch numbers: the demo coin decays in minutes so the whole story fits in a demo.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: 'left', borderBottom: '3px solid var(--color-ink)', padding: '6px 8px' }}>
                rule
              </th>
              {configs.data.map(([k]) => (
                <th key={k} scope="col" style={{ textAlign: 'left', borderBottom: '3px solid var(--color-ink)', padding: '6px 8px' }}>
                  {COINS[k].contractId}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label}>
                <th scope="row" style={{ textAlign: 'left', fontWeight: 500, borderBottom: '2px solid var(--color-rule)', padding: '6px 8px' }}>
                  {label}
                </th>
                {configs.data!.map(([k, c]) => (
                  <td key={k} style={{ borderBottom: '2px solid var(--color-rule)', padding: '6px 8px' }}>
                    {c ? f(c) : 'not deployed yet'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
