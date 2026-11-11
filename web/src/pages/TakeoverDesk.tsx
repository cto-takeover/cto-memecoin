import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DEMO_ACCOUNTS, FACE_COUNT, FAUCET_WHOLE, TAKE_SEAT_NEAR } from '../config';
import { useActor, useActorCtx } from '../hooks/actor';
import { useCoinData } from '../hooks/coinData';
import { pause, useCoinKey, usePoll, useReducedMotion } from '../hooks/hooks';
import { ActorPicker } from '../components/ActorPicker';
import { FaceImg, Loading, ReadError } from '../components/bits';
import { PhoneBar } from '../components/PhoneBar';
import { TakeoverSequence, type SequenceData } from '../components/TakeoverSequence';
import { demoTakeSeat } from '../lib/demo';
import { PART_KEYS, PART_NAMES, faceId, faceWords, type Face, type PartKey } from '../lib/faces';
import { cto, ratio } from '../lib/format';
import type { ApiError } from '../lib/near-errors';
import { view } from '../lib/rpc';
import { saveTx } from '../lib/txlinks';
import type { FaucetStatus, SeatView, Takeover } from '../lib/types';
import { downloadVoiceKey, eventData, newVoiceKey, saveVoiceKey } from '../lib/voice';
import { txOutcome, useWallet, DEPOSITS } from '../lib/wallet';

const TAB_LABELS: Record<PartKey, string> = { bg: 'BACKGROUND', eyes: 'EYES', mouth: 'MOUTH', extra: 'EXTRA' };
const randomPart = () => crypto.getRandomValues(new Uint8Array(1))[0] % 8;
const randomFace = (): Face => ({ bg: randomPart(), eyes: randomPart(), mouth: randomPart(), extra: randomPart() });

type Status =
  | { kind: 'idle' }
  | { kind: 'sending'; quote: Quote }
  | { kind: 'error'; error: ApiError | { source: 'wallet'; type: string; message: string }; txHash?: string }
  | { kind: 'info'; message: string };

interface Quote {
  price: string;
  payout: string;
  burned: string;
  ceo: string | null;
}

const PENDING = 'cto:pending';

export function TakeoverDesk() {
  const { state, error, config, contractId, refresh } = useCoinData();
  const coinKey = useCoinKey();
  const actor = useActor(coinKey, state?.seat.ceo);
  const { mode } = useActorCtx();
  const wallet = useWallet();
  const reduced = useReducedMotion();

  const [face, setFace] = useState<Face>(randomFace);
  const [tab, setTab] = useState<PartKey>('bg');
  const [shuffling, setShuffling] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [sequence, setSequence] = useState<SequenceData | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const accounts = actor.mode === 'wallet' ? [actor.accountId] : coinKey === 'demo' ? [DEMO_ACCOUNTS.ani, DEMO_ACCOUNTS.budi] : [];
  const balances = usePoll(
    async () => {
      const entries = await Promise.all(accounts.map(async (a) => [a, await view<string>(contractId, 'ft_balance_of', { account_id: a })] as const));
      return Object.fromEntries(entries) as Record<string, string>;
    },
    3000,
    [contractId, accounts.join(',')],
  );
  const faucet = usePoll(
    () => (actor.mode === 'wallet' ? view<FaucetStatus>(contractId, 'faucet_status', { account_id: actor.accountId }) : Promise.resolve(undefined)),
    null,
    [contractId, actor.mode === 'wallet' ? actor.accountId : ''],
  );

  // Back from a redirecting wallet (MyNearWallet): finish what was pending.
  useEffect(() => {
    const url = new URL(window.location.href);
    const hashes = url.searchParams.get('transactionHashes');
    const errorCode = url.searchParams.get('errorCode');
    const pendingRaw = sessionStorage.getItem(PENDING);
    if (!pendingRaw || (!hashes && !errorCode)) return;
    sessionStorage.removeItem(PENDING);
    for (const p of ['transactionHashes', 'errorCode', 'errorMessage', 'account_id', 'public_key', 'all_keys']) url.searchParams.delete(p);
    window.history.replaceState(null, '', url.toString());
    const pending = JSON.parse(pendingRaw);
    if (errorCode) {
      setStatus({ kind: 'error', error: { source: 'wallet', type: errorCode, message: url.searchParams.get('errorMessage') ?? 'The wallet did not send the transaction.' } });
      return;
    }
    void (async () => {
      const hash = hashes!.split(',').at(-1)!;
      const outcome = await txOutcome(hash, pending.account);
      if (pending.kind === 'claim_faucet') {
        setStatus({ kind: 'info', message: `Claimed ${FAUCET_WHOLE} CTO.` });
        void balances.refresh();
        void faucet.refresh();
        return;
      }
      await finishTakeover(outcome, pending.before, pending.account);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishTakeover = useCallback(
    async (
      outcome: { ok: true; txHash: string; logs: string[] } | { ok: false; error: any; txHash?: string } | { ok: 'redirect' },
      before: { seat: SeatView; burned: string },
      accountId: string,
    ) => {
      if (outcome.ok === 'redirect') return;
      if (outcome.ok === false) {
        setStatus({ kind: 'error', error: outcome.error, txHash: outcome.txHash });
        return;
      }
      const index: number | undefined = eventData(outcome.logs, 'seat_taken')?.takeover_index;
      await showSequence(outcome.txHash, index, before, accountId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contractId],
  );

  async function showSequence(txHash: string, index: number | undefined, before: { seat: SeatView; burned: string }, accountId: string, withKey?: () => void) {
    const fresh = await refresh();
    const recent = await view<Takeover[]>(contractId, 'get_history', { from_index: 0, limit: 10 });
    const t = recent.find((x) => (index !== undefined ? x.index === index : x.ceo === accountId));
    if (t) saveTx(contractId, `takeover:${t.index}`, txHash);
    setStatus({ kind: 'idle' });
    void balances.refresh();
    if (!t) return;
    setSequence({
      takeover: t,
      oldFace: before.seat.face,
      burnedBefore: before.burned,
      burnedTotal: fresh?.burned ?? before.burned,
      txHash,
      contractId,
      onDownloadKey: withKey,
    });
  }

  if (!state) return error ? <ReadError error={error} /> : <Loading />;
  const { seat } = state;
  const payoutShare = ratio(config?.payout_ratio);
  const quote: Quote = status.kind === 'sending' ? status.quote : { price: seat.current_price, payout: seat.next_payout, burned: seat.next_burned, ceo: seat.ceo };
  const actorId = actor.mode === 'none' ? null : actor.accountId;
  const balance = actorId ? balances.data?.[actorId] : undefined;
  const isCeo = actorId !== null && actorId === seat.ceo;
  const short = balance !== undefined && BigInt(balance) < BigInt(quote.price);
  const sending = status.kind === 'sending';
  const takeRatio = config ? `${+ratio(config.takeover_ratio).toFixed(2)}x` : '1.4x';

  const shuffle = async () => {
    if (shuffling) return;
    setShuffling(true);
    for (let i = 0; i < 8 && !reduced; i++) {
      setFace(randomFace());
      await pause(90, reduced);
    }
    setFace(randomFace());
    setShuffling(false);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = PART_KEYS.indexOf(tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % 4 : e.key === 'ArrowLeft' ? (i + 3) % 4 : e.key === 'Home' ? 0 : e.key === 'End' ? 3 : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(PART_KEYS[next]);
    tabRefs.current[PART_KEYS[next]]?.focus();
  };

  const take = async () => {
    if (actor.mode === 'none') return void wallet.connect();
    if (sending || isCeo || short) return;
    const frozen = { ...quote };
    const before = { seat, burned: state.burned };
    setStatus({ kind: 'sending', quote: frozen });
    if (actor.mode === 'demo') {
      const r = await demoTakeSeat(actor.who, face, frozen.price);
      if (!r.ok) return setStatus({ kind: 'error', error: r.error, txHash: r.txHash });
      await showSequence(r.txHash, r.takeoverIndex, before, actor.accountId);
      return;
    }
    const kp = newVoiceKey();
    const record = saveVoiceKey(contractId, actor.accountId, kp);
    sessionStorage.setItem(PENDING, JSON.stringify({ kind: 'take_seat', account: actor.accountId, before }));
    const r = await wallet.call(contractId, 'take_seat', { face, new_ceo_key: record.public_key, max_price: frozen.price }, DEPOSITS.takeSeat);
    if (r.ok === 'redirect') return;
    sessionStorage.removeItem(PENDING);
    if (r.ok === false) return setStatus({ kind: 'error', error: r.error, txHash: r.txHash });
    const index: number | undefined = eventData(r.logs, 'seat_taken')?.takeover_index;
    await showSequence(r.txHash, index, before, actor.accountId, () => downloadVoiceKey(record));
  };

  const claim = async () => {
    if (actor.mode !== 'wallet') return;
    setStatus({ kind: 'info', message: 'Waiting for the wallet…' });
    sessionStorage.setItem(PENDING, JSON.stringify({ kind: 'claim_faucet', account: actor.accountId }));
    const r = await wallet.call(contractId, 'claim_faucet', {}, DEPOSITS.storage, 30);
    if (r.ok === 'redirect') return;
    sessionStorage.removeItem(PENDING);
    if (r.ok === false) return setStatus({ kind: 'error', error: r.error, txHash: r.txHash });
    setStatus({ kind: 'info', message: `Claimed ${FAUCET_WHOLE} CTO.` });
    void balances.refresh();
    void faucet.refresh();
  };

  const priceMoved = status.kind === 'error' && status.error.source === 'near' && status.error.message.includes('price moved');

  return (
    <>
      <section style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: 16 }}>
        <div>
          <p className="kick">Takeover desk{actorId ? ` · acting as ${actorId}` : ''}</p>
          <h1 className="hd" style={{ fontSize: 'clamp(38px, 8vw, 56px)' }}>
            {seat.vacant ? 'THE SEAT IS OPEN' : 'HOSTILE TAKEOVER'}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 18 }}>
            {seat.vacant ? "Build the coin's first face, pay the opening price, and the seat is yours." : `Build the coin's next face, pay ${takeRatio}, and the seat is yours.`}
          </p>
        </div>
        {!seat.vacant && (
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
            <div style={{ width: 56 }}>
              <FaceImg face={seat.face} size={56} />
            </div>
            <div>
              <p className="kick" style={{ margin: 0 }}>
                Unseating
              </p>
              <p className="mono" style={{ margin: 0, fontWeight: 700 }}>
                {seat.ceo}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="g2">
        <div style={{ position: 'relative', maxWidth: 440, justifySelf: 'center', width: '100%' }}>
          <div className={`card${shuffling ? ' a-shuffle' : ''}`} style={{ padding: 14 }}>
            <FaceImg face={face} size={400} label={`Live preview of the coin face: ${faceWords(face)}`} />
            <div className="rrow mono" style={{ fontSize: 12, marginTop: 10, padding: 0, flexWrap: 'wrap' }} aria-live="polite">
              <span>
                Face #{faceId(face).toLocaleString('en-US')} of {FACE_COUNT.toLocaleString('en-US')}
              </span>
              <span>{faceWords(face)}</span>
            </div>
          </div>
          <span className="stamp" aria-hidden="true" style={{ position: 'absolute', top: '40%', left: '12%', color: 'var(--color-muted)', background: 'var(--color-card)', opacity: 0.9, fontSize: 24, pointerEvents: 'none' }}>
            DRAFT · NOT ON CHAIN
          </span>
        </div>

        <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <div role="tablist" aria-label="Face parts" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PART_KEYS.map((k) => (
              <button
                key={k}
                ref={(el) => {
                  tabRefs.current[k] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${k}`}
                aria-selected={tab === k}
                aria-controls="part-panel"
                tabIndex={tab === k ? 0 : -1}
                className="tab"
                onClick={() => setTab(k)}
                onKeyDown={onTabKey}
              >
                {TAB_LABELS[k]}
              </button>
            ))}
          </div>
          <div id="part-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="a-rise" key={tab} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            {PART_NAMES[tab].map((name, i) => {
              const variant = { ...face, [tab]: i };
              return (
                <button key={name} type="button" className="sw" aria-pressed={face[tab] === i} aria-label={name} title={name} onClick={() => setFace(variant)}>
                  <FaceImg face={variant} size={96} label="" />
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <button type="button" className="ghost" onClick={() => void shuffle()} disabled={shuffling}>
              ⤨ SHUFFLE FACE
            </button>
            <span className="muted" style={{ fontSize: 14 }}>
              Built only from approved parts. Nothing rude is possible.
            </span>
          </div>

          <div>
            <p className="kick">Deal memo{sending ? ' · price frozen while NEAR confirms' : ''}</p>
            <div className="rcpt">
              <div className="rrow" style={{ fontWeight: 700 }}>
                <span>YOU PAY</span>
                <span>{cto(quote.price)} CTO</span>
              </div>
              {quote.ceo ? (
                <div className="rrow">
                  <span style={{ overflowWrap: 'anywhere' }}>→ {quote.ceo} (paid to leave)</span>
                  <span>{cto(quote.payout)} CTO</span>
                </div>
              ) : (
                <div className="rrow muted">
                  <span>→ no CEO to pay (seat is vacant)</span>
                  <span>0 CTO</span>
                </div>
              )}
              <div className="rrow" style={{ color: 'var(--color-red)', fontWeight: 700 }}>
                <span>→ burned forever</span>
                <span>{cto(quote.burned)} CTO</span>
              </div>
              <div className="rrow muted">
                <span>voice key gas allowance</span>
                <span>{TAKE_SEAT_NEAR} NEAR</span>
              </div>
              <SplitBar payout={quote.ceo ? payoutShare : 0} />
            </div>
          </div>

          <ActorPicker actor={actor} balances={balances.data ?? {}} ceo={seat.ceo} />

          {actor.mode === 'wallet' && faucet.data && !faucet.data.claimed && BigInt(faucet.data.pool_left) > 0n && (
            <div>
              <button type="button" className="ghost" onClick={() => void claim()}>
                Claim {Number(FAUCET_WHOLE).toLocaleString('en-US')} CTO
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <div>
              <button
                type="button"
                className={`btn${!sending && !isCeo && !short ? ' a-wiggle' : ''}${sending ? ' busy' : ''}`}
                style={{ fontSize: 24, minHeight: 62 }}
                onClick={() => void take()}
                aria-disabled={sending || isCeo || short}
                aria-describedby="take-note"
              >
                {actor.mode === 'none' ? 'CONNECT A WALLET' : sending ? 'SENDING TO NEAR…' : 'TAKE THE SEAT'}
              </button>
            </div>
            <p id="take-note" className="mono" style={{ margin: 0, fontSize: 13 }} role="status">
              {isCeo
                ? `You are the CEO. The next taker pays you ${cto(seat.next_payout)} CTO.`
                : short
                  ? `Not enough CTO: you have ${cto(balance)}, need ${cto(quote.price)}.`
                  : quote.ceo
                    ? `One transaction: pay, burn, set face, delete ${quote.ceo}'s key, add yours.`
                    : 'One transaction: pay, burn, set face, add your key.'}
            </p>
            {mode === 'wallet' && actor.mode === 'wallet' && <p className="mono muted" style={{ margin: 0, fontSize: 12 }}>Your wallet signs take_seat with {TAKE_SEAT_NEAR} NEAR attached. A new voice key is made in this browser.</p>}
          </div>

          {status.kind === 'info' && (
            <p className="mono" role="status" style={{ margin: 0 }}>
              {status.message}
            </p>
          )}
          {status.kind === 'error' && (
            <div role="alert" className="a-shake" style={{ background: 'var(--color-reject)', border: '3px solid var(--color-ink)', padding: 16 }}>
              <p className="kick">{priceMoved ? 'Price moved' : status.error.source === 'near' ? 'NEAR rejected the transaction' : 'Not sent'}</p>
              <p style={{ margin: '0 0 10px', fontWeight: 700, overflowWrap: 'anywhere' }}>{status.error.message}</p>
              {'raw' in status.error && (
                <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--color-ink)', color: 'var(--color-paper)', padding: 12, margin: '0 0 10px', fontSize: 12, maxHeight: 220, overflow: 'auto' }}>
                  {JSON.stringify(status.error.raw, null, 2)}
                </pre>
              )}
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setStatus({ kind: 'idle' });
                  void refresh();
                }}
              >
                {priceMoved ? 'Try again at the new price' : 'Try again'}
              </button>
            </div>
          )}
        </div>
      </section>
      {sequence && <TakeoverSequence data={sequence} onClose={() => setSequence(null)} />}
      <PhoneBar price={quote.price} label={sending ? 'SENDING…' : 'TAKE THE SEAT'} onClick={() => void take()} />
      <div className="has-phonebar" aria-hidden="true" />
    </>
  );
}

function SplitBar({ payout }: { payout: number }) {
  const p = Number.isFinite(payout) ? payout : 0;
  const pct = Math.round(p * 100);
  return (
    <>
      <div style={{ display: 'flex', height: 18, border: '2px solid var(--color-ink)', marginTop: 10 }} role="img" aria-label={`${pct} percent to the old CEO, ${100 - pct} percent burned`}>
        <div className="a-fill" style={{ width: `${p * 100}%`, background: 'var(--color-ink)', transformOrigin: 'left' }} />
        <div className="a-fill" style={{ width: `${(1 - p) * 100}%`, background: 'var(--color-red)', transformOrigin: 'left', animationDelay: '.6s' }} />
      </div>
      <div className="rrow" style={{ fontSize: 12 }}>
        <span>{pct}% old CEO</span>
        <span style={{ color: 'var(--color-red)' }}>{100 - pct}% burned</span>
      </div>
    </>
  );
}
