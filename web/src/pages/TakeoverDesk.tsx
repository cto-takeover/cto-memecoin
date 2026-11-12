import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { DEMO_ACCOUNTS, FACE_COUNT, TAKE_SEAT_NEAR } from '../config';
import { useActor, useActorCtx } from '../hooks/actor';
import { useCoinData } from '../hooks/coinData';
import { coinPath, pause, useCoinKey, usePoll, useReducedMotion } from '../hooks/hooks';
import { ActorPicker } from '../components/ActorPicker';
import { FaceImg, Loading, ReadError } from '../components/bits';
import { PhoneBar } from '../components/PhoneBar';
import { TakeoverSequence, type SequenceData } from '../components/TakeoverSequence';
import { demoTakeSeat } from '../lib/demo';
import { PART_KEYS, PART_NAMES, faceId, faceWords, type Face, type PartKey } from '../lib/faces';
import { cto, dateTime, nsToDate, ratio, times } from '../lib/format';
import { rememberTakeover } from '../lib/lastTakeover';
import type { ApiError } from '../lib/near-errors';
import { view } from '../lib/rpc';
import { saveTx } from '../lib/txlinks';
import type { ConfigView, FaucetStatus, SeatView, Takeover } from '../lib/types';
import {
  discardPendingVoiceKey,
  downloadVoiceKey,
  eventData,
  loadPendingVoiceKey,
  newVoiceKey,
  promoteVoiceKey,
  savePendingVoiceKey,
  type StoredVoiceKey,
} from '../lib/voice';
import { txOutcome, useWallet, DEPOSITS, type CallResult } from '../lib/wallet';

const TAB_LABELS: Record<PartKey, string> = { bg: 'BACKGROUND', eyes: 'EYES', mouth: 'MOUTH', extra: 'EXTRA' };
const randomPart = () => crypto.getRandomValues(new Uint8Array(1))[0] % 8;
const randomFace = (): Face => ({ bg: randomPart(), eyes: randomPart(), mouth: randomPart(), extra: randomPart() });

type DeskError = ApiError | { source: 'wallet'; type: string; message: string };

type Status =
  | { kind: 'idle' }
  | { kind: 'sending'; quote: Quote }
  | { kind: 'error'; error: DeskError; txHash?: string; /** ms; the relayer said when to try again */ retryAt?: number }
  | { kind: 'info'; message: string };

interface Quote {
  price: string;
  payout: string;
  burned: string;
  ceo: string | null;
}

type Before = { seat: SeatView; burned: string };

/** An error as sent, plus the relayer's retryAfterS (rate limit, price cap) as a deadline. */
function errorStatus(error: DeskError, txHash?: string): Status {
  const after = 'retryAfterS' in error && typeof error.retryAfterS === 'number' ? error.retryAfterS : undefined;
  return { kind: 'error', error, txHash, retryAt: after !== undefined ? Date.now() + after * 1000 : undefined };
}

const PENDING = 'cto:pending';

export function TakeoverDesk() {
  const { state, error, config, contractId, refresh } = useCoinData();
  const coinKey = useCoinKey();
  const actor = useActor(coinKey, state?.seat.ceo);
  const { mode, setMode } = useActorCtx();
  const wallet = useWallet();
  const reduced = useReducedMotion();
  const { pathname } = useLocation();

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

  const claimedMessage = async (account: string) => {
    try {
      const f = await view<FaucetStatus>(contractId, 'faucet_status', { account_id: account });
      return `Claimed ${cto(f.amount)} CTO.`;
    } catch {
      return 'Claimed.';
    }
  };

  // Back from a redirecting wallet (MyNearWallet): finish what was pending.
  useEffect(() => {
    const url = new URL(window.location.href);
    const hashes = url.searchParams.get('transactionHashes');
    const errorCode = url.searchParams.get('errorCode');
    const errorMessage = url.searchParams.get('errorMessage');
    const pendingRaw = sessionStorage.getItem(PENDING);
    if (!pendingRaw || (!hashes && !errorCode)) return;
    sessionStorage.removeItem(PENDING);
    for (const p of ['transactionHashes', 'errorCode', 'errorMessage', 'account_id', 'public_key', 'all_keys']) url.searchParams.delete(p);
    window.history.replaceState(null, '', url.toString());
    const pending = JSON.parse(pendingRaw) as { kind: 'claim_faucet' | 'take_seat'; account: string; contractId?: string; before?: Before };
    const voiceContract = pending.contractId ?? contractId;
    if (errorCode) {
      if (pending.kind === 'take_seat') discardPendingVoiceKey(voiceContract, pending.account);
      setStatus(errorStatus({ source: 'wallet', type: errorCode, message: errorMessage ?? 'The wallet did not send the transaction.' }));
      return;
    }
    void (async () => {
      const hash = hashes!.split(',').at(-1)!;
      const outcome = await txOutcome(hash, pending.account);
      if (pending.kind === 'claim_faucet') {
        if (outcome.ok === false) setStatus(errorStatus(outcome.error, outcome.txHash));
        else setStatus({ kind: 'info', message: await claimedMessage(pending.account) });
        void balances.refresh();
        void faucet.refresh();
        return;
      }
      await finishTakeover(outcome, pending.before!, pending.account, loadPendingVoiceKey(voiceContract, pending.account), voiceContract);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A wallet take_seat came back (popup or redirect): promote or discard the pending voice key, then play the sequence. */
  async function finishTakeover(outcome: CallResult, before: Before, accountId: string, voice: StoredVoiceKey | undefined, voiceContract: string) {
    if (outcome.ok === 'redirect') return;
    if (outcome.ok === false) {
      discardPendingVoiceKey(voiceContract, accountId);
      setStatus(errorStatus(outcome.error, outcome.txHash));
      return;
    }
    const index: number | undefined = eventData(outcome.logs, 'seat_taken')?.takeover_index;
    await showSequence(outcome.txHash, index, before, accountId, voice);
  }

  async function showSequence(txHash: string, index: number | undefined, before: Before, accountId: string, voice?: StoredVoiceKey) {
    if (index !== undefined) rememberTakeover(contractId, index);
    // The takeover already succeeded; a failed read (rate limit, lagging node) must
    // not lose the sequence, so read the history up to 4 times.
    let t: Takeover | undefined;
    let readError: unknown;
    for (let i = 0; i < 4 && !t; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1000 * i));
      try {
        const recent = await view<Takeover[]>(contractId, 'get_history', { from_index: 0, limit: 10 });
        t = recent.find((x) => (index !== undefined ? x.index === index : voice ? x.voice_key === voice.public_key : x.ceo === accountId));
      } catch (e) {
        readError = e;
      }
    }
    // Wallet mode: the new key is this account's voice key only once NEAR has it.
    // Confirmed by the seat_taken event, or by the history entry carrying the key.
    let onDownloadKey: (() => void) | undefined;
    if (voice && (index !== undefined || t?.voice_key === voice.public_key)) {
      const record = promoteVoiceKey(voice);
      onDownloadKey = () => downloadVoiceKey(record);
    }
    const fresh = await refresh();
    if (!t && readError) {
      setStatus({ kind: 'info', message: `The takeover went through (tx ${txHash}), but the history could not be read: ${readError instanceof Error ? readError.message : String(readError)}` });
      void balances.refresh();
      return;
    }
    if (t) {
      saveTx(contractId, `takeover:${t.index}`, txHash);
      rememberTakeover(contractId, t.index);
    }
    setStatus({ kind: 'idle' });
    void balances.refresh();
    if (!t) return;
    setSequence({
      takeover: t,
      oldFace: before.seat.face,
      burnedBefore: before.burned,
      burnedTotal: fresh?.burned ?? (BigInt(before.burned) + BigInt(t.burned)).toString(),
      txHash,
      contractId,
      onDownloadKey,
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
  // No number until get_config answers: the ratio is the chain's, never a guess.
  const takeRatio = config ? times(ratio(config.takeover_ratio)) : undefined;
  const faucetEmpty = faucet.data !== undefined && !faucet.data.claimed && BigInt(faucet.data.pool_left) < BigInt(faucet.data.amount);

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
      if (!r.ok) return setStatus(errorStatus(r.error, r.txHash));
      await showSequence(r.txHash, r.takeoverIndex, before, actor.accountId);
      return;
    }
    // The new key waits in a pending slot: the account's current voice key (an
    // ex-CEO's "try posting") stays put until take_seat succeeds.
    const record = savePendingVoiceKey(contractId, actor.accountId, newVoiceKey());
    sessionStorage.setItem(PENDING, JSON.stringify({ kind: 'take_seat', account: actor.accountId, contractId, before }));
    const r = await wallet.call(contractId, 'take_seat', { face, new_ceo_key: record.public_key, max_price: frozen.price }, DEPOSITS.takeSeat);
    if (r.ok === 'redirect') return;
    sessionStorage.removeItem(PENDING);
    await finishTakeover(r, before, actor.accountId, record, contractId);
  };

  const claim = async () => {
    if (actor.mode !== 'wallet') return;
    setStatus({ kind: 'info', message: 'Waiting for the wallet…' });
    sessionStorage.setItem(PENDING, JSON.stringify({ kind: 'claim_faucet', account: actor.accountId, contractId }));
    const r = await wallet.call(contractId, 'claim_faucet', {}, DEPOSITS.storage, 30);
    if (r.ok === 'redirect') return;
    sessionStorage.removeItem(PENDING);
    if (r.ok === false) return setStatus(errorStatus(r.error, r.txHash));
    setStatus({ kind: 'info', message: await claimedMessage(actor.accountId) });
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
            {seat.vacant
              ? "Build the coin's first face, pay the opening price, and the seat is yours."
              : `Build the coin's next face, pay ${takeRatio ?? 'the takeover price'}, and the seat is yours.`}
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
        <div style={{ position: 'relative', maxWidth: 440, justifySelf: 'center', alignSelf: 'start', width: '100%' }}>
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

          {actor.mode === 'wallet' && faucet.data && !faucet.data.claimed && !faucetEmpty && (
            <div>
              <button type="button" className="ghost" onClick={() => void claim()}>
                Claim {cto(faucet.data.amount)} CTO
              </button>
            </div>
          )}
          {actor.mode === 'wallet' && faucetEmpty && faucet.data && (
            <p className="mono" style={{ margin: 0, fontSize: 13 }}>
              The faucet is empty: {cto(faucet.data.pool_left)} CTO left in its pool, less than one {cto(faucet.data.amount)} CTO claim.
            </p>
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
            {short && actor.mode === 'wallet' && coinKey === 'main' && (
              <Shortfall
                seat={seat}
                config={config}
                faucet={faucet.data}
                readAt={state.readAt}
                demoTo={coinPath(pathname, 'demo')}
                onDemo={() => setMode('demo')}
              />
            )}
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
              {status.retryAt !== undefined && <RetryIn at={status.retryAt} />}
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

/** "Try again in N s": counts down each second; with reduced motion it changes once, when the wait is over. */
function RetryIn({ at }: { at: number }) {
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (now >= at) return;
    const id = setTimeout(() => setNow(Date.now()), reduced ? at - now : Math.min(1000, at - now));
    return () => clearTimeout(id);
  }, [now, at, reduced]);
  const left = Math.ceil((at - now) / 1000);
  return (
    <p className="mono" aria-live="off" style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700 }} data-testid="retry-in">
      {left > 0 ? `Try again in ${left} s.` : 'You can try again now.'}
    </p>
  );
}

/**
 * Main coin, wallet mode, not enough CTO. The faucet gives one fixed claim and the
 * price ladder soon passes it, so say so plainly, say when decay brings the price
 * down (from get_seat + get_config), and offer the demo coin.
 */
function Shortfall({
  seat,
  config,
  faucet,
  readAt,
  demoTo,
  onDemo,
}: {
  seat: SeatView;
  config: ConfigView | undefined;
  faucet: FaucetStatus | undefined;
  readAt: number;
  demoTo: string;
  onDemo: () => void;
}) {
  const price = BigInt(seat.current_price);
  const aboveClaim = faucet !== undefined && price > BigInt(faucet.amount);
  let decay: string | undefined;
  if (config && !seat.vacant && seat.since_ns && price > BigInt(seat.floor)) {
    const floor = `${cto(seat.floor)} CTO`;
    if (seat.decaying) {
      const floorAt = nsToDate(seat.since_ns).getTime() + (config.decay_delay_s + config.decay_length_s) * 1000;
      decay = `The price is already falling and reaches its floor of ${floor} on ${dateTime(new Date(floorAt))}.`;
    } else {
      const startAt = readAt + seat.seconds_until_decay * 1000;
      const floorAt = startAt + config.decay_length_s * 1000;
      decay = `If nobody takes the seat first, the price starts falling on ${dateTime(new Date(startAt))} and reaches its floor of ${floor} on ${dateTime(new Date(floorAt))}.`;
    }
  }
  return (
    <div className="card" style={{ padding: 14, boxShadow: 'none', display: 'grid', gap: 8 }} data-testid="shortfall">
      {aboveClaim && (
        <p style={{ margin: 0 }}>
          The seat costs {cto(seat.current_price)} CTO, more than the {cto(faucet.amount)} CTO one faucet claim gives{faucet.claimed ? ', and each wallet can claim once' : ''}.
        </p>
      )}
      {decay && <p style={{ margin: 0 }}>{decay}</p>}
      <p style={{ margin: 0 }}>Or run the whole story now on the demo coin, with ready-made accounts and no wallet.</p>
      <div>
        <Link className="ghost" to={demoTo} onClick={onDemo}>
          Switch to the demo coin →
        </Link>
      </div>
    </div>
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
