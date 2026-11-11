import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { DEMO_ACCOUNTS, DEMO_LINES, type Who } from '../config';
import { useActor, useActorCtx } from '../hooks/actor';
import { useWallet } from '../lib/wallet';
import { useCoinData } from '../hooks/coinData';
import { useCoinKey, useCoinLink, useNow, usePoll, useReducedMotion } from '../hooks/hooks';
import { ActorPicker } from '../components/ActorPicker';
import { CountUp, FaceImg, Loading, ReadError, TxChip, useAsync } from '../components/bits';
import { demoAnnounce } from '../lib/demo';
import { ago, cto, shortKey } from '../lib/format';
import type { ApiError } from '../lib/near-errors';
import { view, viewAccessKeyList } from '../lib/rpc';
import { announcementTx, saveTx, takeoverTx } from '../lib/txlinks';
import type { Announcement, SeatView, Takeover } from '../lib/types';
import { eventData, importVoiceKey, loadVoiceKey, postAsCoin } from '../lib/voice';

type Attempt = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done'; error?: ApiError; txHash?: string };

const demoWho = (account: string | null | undefined): Who | undefined =>
  account === DEMO_ACCOUNTS.ani ? 'ani' : account === DEMO_ACCOUNTS.budi ? 'budi' : undefined;

/** Fills a line's slots with live numbers, the way the contract will. */
function fill(line: string, seat: SeatView, burned: string) {
  return line.replaceAll('{next_price}', cto(seat.current_price)).replaceAll('{burned}', cto(burned)).replaceAll('{ceo}', seat.ceo ?? '');
}

export function PressOffice() {
  const { state, error, contractId, refresh } = useCoinData();
  const coinKey = useCoinKey();
  const link = useCoinLink();
  const actor = useActor(coinKey, state?.seat.ceo);
  const lines = usePoll(() => view<string[]>(contractId, 'get_lines'), null, [contractId]);
  const keys = usePoll(() => viewAccessKeyList(contractId), 3000, [contractId]);
  const now = useNow(5000);

  if (!state) return error ? <ReadError error={error} /> : <Loading />;
  const { seat, history, announcements, burned } = state;
  const latest = history[0];
  const previous = history[1];
  const liveKeys = keys.data?.map((k) => k.public_key);

  return (
    <>
      <Banner latest={latest} previous={previous} seat={seat} contractId={contractId} now={now} />

      {latest?.previous_ceo && previous ? (
        <section className="g2">
          <ExCeoPanel key={latest.index} latest={latest} previous={previous} contractId={contractId} coinKey={coinKey} />
          <PayoutCard latest={latest} previous={previous} contractId={contractId} />
        </section>
      ) : null}

      <section className="g2">
        <Composer seat={seat} burned={burned} lines={lines.data} contractId={contractId} coinKey={coinKey} actor={actor} history={history} onPosted={refresh} />
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <h2 className="hd" style={{ fontSize: 26 }}>
            WHO HOLDS THE PEN
          </h2>
          {seat.voice_key && seat.ceo ? (
            <div className="card a-rise">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                  {seat.ceo} key
                </span>
                {liveKeys?.includes(seat.voice_key) ? (
                  <span className="chip ok">
                    <span className="dot" style={{ background: 'var(--color-ink)' }} />
                    ACTIVE
                  </span>
                ) : (
                  <span className="chip">checking…</span>
                )}
              </div>
              <KeyPermission keys={keys.data} publicKey={seat.voice_key} contractId={contractId} />
            </div>
          ) : (
            <div className="card">
              <p style={{ margin: 0 }}>Nobody holds the pen: the seat is open.</p>
            </div>
          )}
          {previous && latest?.previous_ceo && liveKeys && !liveKeys.includes(previous.voice_key) && (
            <DeletedKeyCard previous={previous} latest={latest} contractId={contractId} />
          )}
          <div className="card" style={{ boxShadow: 'none', background: 'var(--color-paper)' }}>
            <p className="kick">How it works</p>
            <p style={{ margin: 0, fontSize: 15 }}>
              The voice is a NEAR access key on the coin's own account. Taking the seat deletes the old key and adds yours in one batch, so the protocol, not a server, decides who speaks.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="hd" style={{ fontSize: 28, marginBottom: 14 }}>
          PRESS RELEASES
        </h2>
        {announcements.length === 0 ? (
          <p className="muted">No press releases yet. The CEO speaks first.</p>
        ) : (
          <div className="g2" style={{ gap: 14 }}>
            {announcements.map((a) => (
              <Release key={a.index} a={a} contractId={contractId} now={now} />
            ))}
          </div>
        )}
        <p style={{ margin: '18px 0 0' }}>
          <Link className="ghost" to={link('/receipts')}>
            See the receipts →
          </Link>
        </p>
      </section>
    </>
  );
}

function Banner({ latest, previous, seat, contractId, now }: { latest?: Takeover; previous?: Takeover; seat: SeatView; contractId: string; now: number }) {
  const hash = useAsync(() => (latest ? takeoverTx(contractId, latest) : Promise.resolve(undefined)), [contractId, latest?.index]);
  if (!latest) {
    return (
      <section className="a-drop" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', border: '3px solid var(--color-ink)', boxShadow: '6px 6px 0 var(--color-ink)', padding: '18px 22px' }}>
        <p className="kick" style={{ color: 'var(--color-paper)' }}>
          Press office
        </p>
        <h1 className="hd" style={{ fontSize: 'clamp(28px, 6vw, 42px)', color: 'var(--color-paper)' }}>
          THE SEAT IS OPEN: NOBODY SPEAKS FOR THE COIN YET
        </h1>
      </section>
    );
  }
  return (
    <section className="a-drop" style={{ background: 'var(--color-red)', color: 'var(--color-paper)', border: '3px solid var(--color-ink)', boxShadow: '6px 6px 0 var(--color-ink)', padding: '18px 22px', display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'center' }}>
      {previous && latest.previous_ceo && (
        <>
          <div style={{ position: 'relative', width: 110, filter: 'grayscale(.6)' }}>
            <FaceImg face={previous.face} size={110} label={`Old face of ${previous.ceo}`} />
            <span className="stamp a-thunk" style={{ position: 'absolute', top: 30, left: -8, fontSize: 22, color: 'var(--color-red)', animationDelay: '.5s' }}>
              FIRED!
            </span>
          </div>
          <div className="hd" style={{ fontSize: 34 }} aria-hidden="true">
            →
          </div>
        </>
      )}
      <div className="a-bob" style={{ width: 110, background: 'var(--color-paper)', border: '3px solid var(--color-ink)' }}>
        <FaceImg face={seat.face} size={110} />
      </div>
      <div style={{ flex: '1 1 320px' }}>
        <p className="kick" style={{ color: 'var(--color-paper)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          Breaking · {ago(latest.at_ns, now)} · <TxChip hash={hash} account={contractId} />
        </p>
        <h1 className="hd" style={{ fontSize: 'clamp(28px, 6vw, 42px)', color: 'var(--color-paper)', overflowWrap: 'anywhere' }}>
          {latest.previous_ceo ? `${latest.ceo} IS THE NEW CEO` : `${latest.ceo} TAKES THE VACANT SEAT`}
        </h1>
      </div>
    </section>
  );
}

/** The wow moment: the ex-CEO tries to post with the key NEAR deleted. */
function ExCeoPanel({ latest, previous, contractId, coinKey }: { latest: Takeover; previous: Takeover; contractId: string; coinKey: 'demo' | 'main' }) {
  const exCeo = latest.previous_ceo!;
  const reduced = useReducedMotion();
  const [attempt, setAttempt] = useState<Attempt>({ kind: 'idle' });
  const who = coinKey === 'demo' ? demoWho(exCeo) : undefined;
  const stored = loadVoiceKey(contractId, exCeo);
  const canTry = who !== undefined || (stored && stored.public_key === previous.voice_key);
  const line = 3;
  const lineText = "Wait, I'm still the CEO!";
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (attempt.kind !== 'sending') return;
    if (reduced) return setTyped(lineText.length);
    setTyped(0);
    const id = setInterval(() => setTyped((n) => Math.min(lineText.length, n + 1)), 35);
    return () => clearInterval(id);
  }, [attempt.kind, reduced]);

  const tryPost = async () => {
    setAttempt({ kind: 'sending' });
    if (who) {
      const r = await demoAnnounce(who, line);
      setAttempt(r.ok ? { kind: 'done', txHash: r.txHash } : { kind: 'done', error: r.error, txHash: r.txHash });
    } else if (stored) {
      const r = await postAsCoin(contractId, stored.private_key, line);
      setAttempt(r.ok ? { kind: 'done', txHash: r.txHash } : { kind: 'done', error: r.error, txHash: r.txHash });
    }
  };

  const rejected = attempt.kind === 'done' && attempt.error?.source === 'near' && attempt.error.type.endsWith('AccessKeyNotFound');
  return (
    <div className={rejected ? 'a-shake' : ''} style={{ background: 'var(--color-reject)', border: '3px solid var(--color-ink)', boxShadow: '4px 4px 0 var(--color-ink)', padding: 20, minHeight: 330 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <p className="kick" style={{ margin: 0, overflowWrap: 'anywhere' }}>
          {exCeo} tries to post as the coin
        </p>
        <span className="chip">signing with old key {shortKey(previous.voice_key)}</span>
      </div>
      <p style={{ margin: '14px 0', fontSize: 22, fontWeight: 500, minHeight: '1.4em' }}>
        "{attempt.kind === 'idle' ? lineText : lineText.slice(0, attempt.kind === 'sending' ? typed : lineText.length)}
        {attempt.kind === 'sending' && <span className="cursor" />}"
      </p>
      {attempt.kind === 'idle' &&
        (canTry ? (
          <button type="button" className="btn" onClick={() => void tryPost()}>
            TRY POSTING AS {(who ?? exCeo).toUpperCase()}
          </button>
        ) : (
          <p className="mono muted" style={{ margin: 0 }}>
            Only {exCeo} has their old key, so only they can try this from their own browser.
          </p>
        ))}
      {attempt.kind === 'sending' && (
        <p className="mono" role="status" style={{ margin: 0, fontWeight: 700 }}>
          Sending to NEAR…
        </p>
      )}
      {attempt.kind === 'done' && (
        <div role="status">
          {rejected && (
            <span className="stamp a-thunk" style={{ color: 'var(--color-red)', fontSize: 'clamp(26px, 6vw, 38px)' }}>
              REJECTED BY NEAR
            </span>
          )}
          {attempt.error ? (
            <>
              <div className="a-rise" data-testid="near-error" style={{ background: 'var(--color-ink)', color: 'var(--color-paper)', padding: 12, margin: '16px 0 8px', border: '2px solid var(--color-ink)', animationDelay: '.25s' }}>
                {attempt.error.source === 'near' && (
                  <p className="mono" style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: 'var(--color-hi)', overflowWrap: 'anywhere' }}>
                    {attempt.error.type.split('.').join(' › ')}
                  </p>
                )}
                <pre className="mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0, fontSize: 12 }}>
                  {attempt.error.source === 'near' ? JSON.stringify(attempt.error.raw, null, 2) : attempt.error.message}
                </pre>
              </div>
              {rejected && (
                <p className="a-rise" style={{ margin: 0, fontWeight: 700, animationDelay: '.4s' }}>
                  Locked out by the protocol, not by us.
                </p>
              )}
            </>
          ) : (
            <p style={{ margin: '12px 0 0' }}>
              NEAR accepted it: <TxChip hash={attempt.txHash} account={contractId} />
            </p>
          )}
          <p style={{ margin: '12px 0 0' }}>
            <button type="button" className="ghost" onClick={() => setAttempt({ kind: 'idle' })}>
              ↺ Try again
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

function PayoutCard({ latest, previous, contractId }: { latest: Takeover; previous: Takeover; contractId: string }) {
  const hash = useAsync(() => takeoverTx(contractId, latest), [contractId, latest.index]);
  const [run, setRun] = useState(0);
  const profit = BigInt(latest.payout) - BigInt(previous.paid);
  const mult = Number((BigInt(latest.payout) * 1000n) / (BigInt(previous.paid) || 1n)) / 1000;
  return (
    <div style={{ background: 'var(--color-near)', border: '3px solid var(--color-ink)', boxShadow: '4px 4px 0 var(--color-ink)', padding: 20 }}>
      <p className="kick">Same transaction as the takeover</p>
      <p className="hd" style={{ fontSize: 'clamp(32px, 7vw, 50px)' }}>
        +<CountUp key={run} from={0n} value={BigInt(latest.payout)} format={cto} /> CTO
      </p>
      <p style={{ margin: '6px 0 14px', fontSize: 20, fontWeight: 700, overflowWrap: 'anywhere' }}>paid to {latest.previous_ceo}</p>
      <div className="rcpt" style={{ fontSize: 14 }}>
        <div className="rrow">
          <span>{latest.previous_ceo?.split('.')[0]} paid</span>
          <span>{cto(previous.paid)}</span>
        </div>
        <div className="rrow">
          <span>received ({+mult.toFixed(2)}x)</span>
          <span>{cto(latest.payout)}</span>
        </div>
        <div className="rrow" style={{ fontWeight: 700 }}>
          <span>{profit >= 0n ? 'profit for being fired' : 'paid out after the price decayed'}</span>
          <span>
            {profit >= 0n ? '+' : '−'}
            {cto(profit >= 0n ? profit : -profit)}
          </span>
        </div>
      </div>
      <p style={{ margin: '14px 0 0', fontWeight: 700, fontSize: 20 }}>Fired, but paid.</p>
      <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <TxChip hash={hash} account={contractId} label="view on explorer" />
        <button type="button" className="ghost" style={{ minHeight: 44 }} onClick={() => setRun((r) => r + 1)}>
          ↺ Replay
        </button>
      </div>
    </div>
  );
}

function KeyPermission({ keys, publicKey, contractId }: { keys?: { public_key: string; access_key: { permission: any } }[]; publicKey: string; contractId: string }) {
  const k = keys?.find((x) => x.public_key === publicKey);
  const fc = k && k.access_key.permission !== 'FullAccess' ? k.access_key.permission.FunctionCall : undefined;
  return (
    <p className="mono" style={{ margin: '8px 0 0', fontSize: 13, overflowWrap: 'anywhere' }}>
      {fc
        ? `function-call key on ${contractId} · may only call ${fc.method_names.join(', ')} · ${fc.allowance ? `${(Number(BigInt(fc.allowance) / 10n ** 20n) / 10_000).toString()} NEAR allowance left` : 'no allowance cap'}`
        : `${shortKey(publicKey)}`}
    </p>
  );
}

function DeletedKeyCard({ previous, latest, contractId }: { previous: Takeover; latest: Takeover; contractId: string }) {
  const hash = useAsync(() => takeoverTx(contractId, latest), [contractId, latest.index]);
  return (
    <div className="card" style={{ position: 'relative', background: 'var(--color-retired)' }}>
      <span className="mono struck" style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
        {previous.ceo} key
      </span>
      <p className="mono muted" style={{ margin: '8px 0 0', fontSize: 13, overflowWrap: 'anywhere' }}>
        {shortKey(previous.voice_key)} · deleted in the same transaction as the takeover
      </p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <TxChip hash={hash} account={contractId} />
        <span className="stamp a-thunk" style={{ fontSize: 24, color: 'var(--color-red)' }}>
          DELETED
        </span>
      </div>
    </div>
  );
}

function Composer({
  seat,
  burned,
  lines,
  contractId,
  coinKey,
  actor,
  history,
  onPosted,
}: {
  seat: SeatView;
  burned: string;
  lines?: string[];
  contractId: string;
  coinKey: 'demo' | 'main';
  actor: ReturnType<typeof useActor>;
  history: Takeover[];
  onPosted: () => void;
}) {
  const ceoWho = coinKey === 'demo' ? demoWho(seat.ceo) : undefined;
  const walletCeo = actor.mode === 'wallet' && actor.accountId === seat.ceo;
  const stored = seat.ceo ? loadVoiceKey(contractId, seat.ceo) : undefined;
  const storedMatches = !!stored && stored.public_key === seat.voice_key;
  const demoPosting = actor.mode === 'demo' && ceoWho !== undefined;
  const allowed = useMemo(() => (demoPosting ? DEMO_LINES : lines?.map((_, i) => i) ?? []), [demoPosting, lines]);
  const [line, setLine] = useState<number | null>(null);
  const [state, setState] = useState<Attempt>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  const chosen = line !== null && allowed.includes(line) ? line : allowed[0];

  const canPost = demoPosting || (walletCeo && storedMatches);
  const neverHeld = actor.mode !== 'none' && !history.some((t) => t.ceo === actor.accountId);

  const sign = async () => {
    if (chosen === undefined) return;
    setState({ kind: 'sending' });
    let txHash: string | undefined;
    let error: ApiError | undefined;
    let index: number | undefined;
    if (demoPosting) {
      const r = await demoAnnounce(ceoWho!, chosen);
      if (r.ok) [txHash, index] = [r.txHash, r.announcementIndex];
      else [error, txHash] = [r.error, r.txHash];
    } else if (stored) {
      const r = await postAsCoin(contractId, stored.private_key, chosen);
      if (r.ok) [txHash, index] = [r.txHash, eventData(r.logs, 'announcement')?.index];
      else [error, txHash] = [r.error, r.txHash];
    }
    if (txHash && index !== undefined) saveTx(contractId, `announce:${index}`, txHash);
    setState({ kind: 'done', error, txHash });
    onPosted();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await importVoiceKey(f);
      force((n) => n + 1);
    } catch (err) {
      setState({ kind: 'done', error: { source: 'relayer', type: 'BadRequest', message: (err as Error).message } });
    }
  };

  return (
    <div className="card">
      <h2 className="hd" style={{ fontSize: 26, marginBottom: 12 }}>
        WRITE A PRESS RELEASE
      </h2>
      {seat.vacant ? (
        <p style={{ margin: 0 }}>The seat is open. Whoever takes it gets the pen.</p>
      ) : (
        <>
          <p className="kick" id="lines-label">
            {canPost ? `As ${seat.ceo}, CEO · pick a line` : `${seat.ceo} holds the pen`}
          </p>
          <div role="radiogroup" aria-labelledby="lines-label" style={{ display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto', padding: 2 }}>
            {(lines ?? []).map((t, i) =>
              allowed.includes(i) || !demoPosting ? (
                <label
                  key={i}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: chosen === i ? '3px solid var(--color-ink)' : '2px solid var(--color-ink)', background: chosen === i ? 'var(--color-hi)' : 'var(--color-paper)', padding: '10px 12px', cursor: canPost ? 'pointer' : 'default', minHeight: 44, boxSizing: 'border-box' }}
                >
                  <input type="radio" name="line" value={i} checked={chosen === i} disabled={!canPost} onChange={() => setLine(i)} style={{ marginTop: 4, width: 18, height: 18, accentColor: '#111111' }} />
                  <span>
                    <span className="mono muted" style={{ fontSize: 12 }}>
                      #{i}{' '}
                    </span>
                    {fill(t, seat, burned)}
                  </span>
                </label>
              ) : null,
            )}
          </div>
          <p className="mono muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            Only the 24 fixed lines exist on chain; numbers fill in when NEAR runs it.{demoPosting ? ' Demo mode offers six of them.' : ''}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
            <span className="mono muted" style={{ fontSize: 12 }}>
              signer: {contractId} · no wallet pop-up
            </span>
            <button type="button" className="btn" style={{ fontSize: 18, minHeight: 48 }} disabled={!canPost || state.kind === 'sending'} onClick={() => void sign()}>
              {state.kind === 'sending' ? 'SIGNING…' : 'SIGN AS THE COIN'}
            </button>
          </div>
          {!canPost && (
            <p className="mono" style={{ margin: '10px 0 0', fontSize: 13 }} role="status">
              {actor.mode === 'demo'
                ? `${seat.ceo} is not a demo account, so only they can post right now.`
                : actor.mode === 'none'
                  ? 'Connect the CEO wallet to post.'
                  : walletCeo
                    ? 'You are the CEO, but this browser does not have your voice key. Load the key file you downloaded:'
                    : neverHeld
                      ? 'You have never held the seat. Take it at the Takeover desk to get the pen.'
                      : `You are not the CEO. ${seat.ceo} holds the pen.`}
            </p>
          )}
          {walletCeo && !storedMatches && (
            <p style={{ margin: '8px 0 0' }}>
              <input ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => void onFile(e)} aria-label="Load your cto-voice-key.json" />
            </p>
          )}
          {state.kind === 'done' && (
            <div role="status" style={{ marginTop: 12 }}>
              {state.error ? (
                <pre className="mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: 'var(--color-reject)', padding: 12, margin: 0, fontSize: 13, border: '2px solid var(--color-ink)' }}>
                  {state.error.source === 'near' ? JSON.stringify(state.error.raw, null, 2) : state.error.message}
                </pre>
              ) : (
                <p className="mono" style={{ margin: 0 }}>
                  ✓ Signed by {contractId} · <TxChip hash={state.txHash} account={contractId} />
                </p>
              )}
            </div>
          )}
        </>
      )}
      <div style={{ marginTop: 14 }}>
        {actor.mode === 'demo' ? (
          <p className="mono muted" style={{ margin: 0, fontSize: 12 }}>
            Demo mode: the test relayer signs with the CEO's voice key.{' '}
            <WalletSwitch />
          </p>
        ) : (
          <ActorPicker actor={actor} balances={{}} ceo={seat.ceo} />
        )}
      </div>
    </div>
  );
}

function WalletSwitch() {
  const { setMode } = useActorCtx();
  const wallet = useWallet();
  return (
    <button
      type="button"
      className="ghost"
      style={{ marginTop: 8 }}
      onClick={() => {
        setMode('wallet');
        if (!wallet.accountId) void wallet.connect();
      }}
    >
      Use my own wallet
    </button>
  );
}

function Release({ a, contractId, now }: { a: Announcement; contractId: string; now: number }) {
  const hash = useAsync(() => announcementTx(contractId, a), [contractId, a.index]);
  return (
    <article className="card a-rise">
      <p className="mono muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        PRESS RELEASE #{a.index + 1} · {ago(a.at_ns, now).toUpperCase()}
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 19, fontWeight: 500 }}>"{a.text}"</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span className="chip ok">✓ SIGNED BY {contractId}</span>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {a.ceo}
        </span>
        <TxChip hash={hash} account={contractId} />
      </div>
    </article>
  );
}
