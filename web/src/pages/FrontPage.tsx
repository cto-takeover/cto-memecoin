import { Link } from 'react-router';
import { FACE_COUNT } from '../config';
import { useCoinData } from '../hooks/coinData';
import { useCoinLink, useNow } from '../hooks/hooks';
import { CountUp, FaceImg, Flame, Loading, ReadError, TxChip, useAsync } from '../components/bits';
import { SeatClock } from '../components/SeatClock';
import { PhoneBar } from '../components/PhoneBar';
import { faceId, faceWords } from '../lib/faces';
import { ago, cto, duration, nsToDate, shortDate } from '../lib/format';
import { view } from '../lib/rpc';
import { announcementTx, deployTx, takeoverTx } from '../lib/txlinks';
import type { Announcement, Takeover } from '../lib/types';

export function FrontPage() {
  const { state, error, config, contractId } = useCoinData();
  const link = useCoinLink();
  const now = useNow(1000);
  if (!state) return error ? <ReadError error={error} /> : <Loading />;
  const { seat, supply, burned, history, announcements } = state;
  const takeovers = history.length ? history[0].index + 1 : 0;
  const inOffice = seat.since_ns ? (now - Number(BigInt(seat.since_ns) / 1_000_000n)) / 1000 : 0;
  const ceoShort = seat.ceo ?? '';

  return (
    <>
      <section className="g2 halftone" style={{ alignItems: 'center', padding: 24, border: '3px solid var(--color-ink)' }}>
        <div style={{ position: 'relative', maxWidth: 420, justifySelf: 'center', width: '100%' }}>
          <div className="card a-bob" style={{ padding: 14 }}>
            <FaceImg face={seat.face} size={400} />
            <p className="mono" style={{ margin: '10px 0 0', fontSize: 12 }}>
              TODAY'S FACE · #{faceId(seat.face).toLocaleString('en-US')} of {FACE_COUNT.toLocaleString('en-US')} · {faceWords(seat.face)}
            </p>
          </div>
          {!seat.vacant && (
            <span className="stamp a-thunk" style={{ position: 'absolute', top: -16, right: -12, color: 'var(--color-ink)', background: 'var(--color-near)', borderColor: 'var(--color-ink)', animationDelay: '.3s' }}>
              CEO
            </span>
          )}
        </div>
        <div>
          {seat.vacant ? (
            <>
              <p className="kick">The seat</p>
              <h1 className="hd a-rise" style={{ fontSize: 'clamp(40px, 8vw, 60px)' }}>
                SEAT OPEN
              </h1>
              <p className="mono" style={{ margin: '10px 0 22px', fontSize: 14 }}>
                No CEO yet · the first taker pays the opening price · all of it burns
              </p>
            </>
          ) : (
            <>
              <p className="kick">Current CEO</p>
              <h1 className="hd a-rise" style={{ fontSize: 'clamp(34px, 7vw, 60px)', overflowWrap: 'anywhere' }}>
                <span className="sr-only">Current CEO: </span>
                {seat.ceo}
              </h1>
              <p className="mono" style={{ margin: '10px 0 22px', fontSize: 14 }}>
                In office {duration(inOffice)} · paid {cto(seat.paid)} CTO · announces as the coin
              </p>
            </>
          )}
          <div className="sticker">
            <span className="kick" style={{ margin: 0 }}>
              {seat.vacant ? 'Seat open' : 'Seat price'}
            </span>
            <br />
            <span className="mono" style={{ fontSize: 30, fontWeight: 700 }}>
              {cto(seat.current_price)} CTO
            </span>
          </div>
          <div style={{ margin: '26px 0 14px' }}>
            <Link className="btn a-wiggle" to={link('/takeover')}>
              TAKE OVER →
            </Link>
          </div>
          <p className="mono" style={{ margin: '0 0 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {seat.vacant ? (
              <>
                Seat is vacant, so nobody is paid out ·
                <Flame /> {cto(seat.next_burned)} burned
              </>
            ) : (
              <>
                {ceoShort} gets {cto(seat.next_payout)} ·
                <Flame /> {cto(seat.next_burned)} burned
              </>
            )}
          </p>
          <SeatClock seat={seat} config={config} />
        </div>
      </section>

      <section className="g3">
        <div className="card a-rise">
          <p className="kick">Total supply</p>
          <p className="mono" style={{ margin: 0, fontSize: 30, fontWeight: 700 }}>
            <CountUp value={BigInt(supply)} format={cto} />
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            CTO · view call ft_total_supply
          </p>
        </div>
        <div className="card a-rise" style={{ animationDelay: '.1s', background: 'var(--color-burn)' }}>
          <p className="kick">Total burned</p>
          <p className="mono" style={{ margin: 0, fontSize: 30, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Flame />
            <CountUp value={BigInt(burned)} format={cto} />
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            CTO destroyed by takeovers
          </p>
        </div>
        <div className="card a-rise" style={{ animationDelay: '.2s' }}>
          <p className="kick">Takeovers</p>
          <p className="mono" style={{ margin: 0, fontSize: 30, fontWeight: 700 }}>
            {takeovers.toLocaleString('en-US')}
          </p>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
            since launch
            {takeovers > 0 && <FirstTakeover contractId={contractId} loaded={history} count={takeovers} />}
          </p>
        </div>
      </section>

      <section className="g2">
        <div>
          <h2 className="hd" style={{ fontSize: 28, marginBottom: 14 }}>
            PRESS RELEASES
          </h2>
          <div style={{ display: 'grid', gap: 14 }}>
            {announcements.slice(0, 3).map((a, i) => (
              <PressRelease key={a.index} a={a} contractId={contractId} delay={0.35 + i * 0.1} now={now} />
            ))}
            {announcements.length < 3 && <LaunchNotice contractId={contractId} />}
          </div>
        </div>
        <div>
          <h2 className="hd" style={{ fontSize: 28, marginBottom: 14 }}>
            CEO HALL OF FAME
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16 }}>
            {[...history]
              .slice(0, 3)
              .reverse()
              .map((t) => (
                <HallCard key={t.index} t={t} current={t.index === takeovers - 1} contractId={contractId} />
              ))}
            <Link
              to={link('/takeover')}
              className="a-pulse"
              style={{ border: '3px dashed var(--color-ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 12, minHeight: 230, textAlign: 'center', textDecoration: 'none', background: 'var(--color-card)' }}
            >
              <span className="hd" style={{ fontSize: 30 }}>
                #{takeovers + 1} YOU?
              </span>
              <span className="mono" style={{ margin: '8px 0 0', fontSize: 13 }}>
                {cto(seat.current_price)} CTO
                <br />
                takes the seat
              </span>
            </Link>
          </div>
        </div>
      </section>
      <PhoneBar price={seat.current_price} to={link('/takeover')} />
      <div className="has-phonebar" aria-hidden="true" />
    </>
  );
}

/**
 * " · first {date}": the oldest takeover. get_history pages newest first, so the
 * oldest is at from_index = count - 1; the 8 loaded entries only hold it while
 * there are 8 or fewer takeovers.
 */
function FirstTakeover({ contractId, loaded, count }: { contractId: string; loaded: Takeover[]; count: number }) {
  const inPage = loaded.find((t) => t.index === 0);
  const fetched = useAsync(
    () => (inPage ? Promise.resolve(undefined) : view<Takeover[]>(contractId, 'get_history', { from_index: count - 1, limit: 1 }).then((r) => r.find((t) => t.index === 0))),
    [contractId, !!inPage],
  );
  const first = inPage ?? fetched;
  return first ? <> · first {shortDate(nsToDate(first.at_ns))}</> : null;
}

function PressRelease({ a, contractId, delay, now }: { a: Announcement; contractId: string; delay: number; now: number }) {
  const hash = useAsync(() => announcementTx(contractId, a), [contractId, a.index]);
  return (
    <article className="card a-rise" style={{ animationDelay: `${delay}s` }}>
      <p className="mono muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        FROM THE DESK OF THE CEO · {ago(a.at_ns, now).toUpperCase()}
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 500 }}>"{a.text}"</p>
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

function LaunchNotice({ contractId }: { contractId: string }) {
  const hash = useAsync(() => deployTx(contractId), [contractId]);
  return (
    <article className="card a-rise" style={{ animationDelay: '.45s' }}>
      <p className="mono muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        LAUNCH NOTICE
      </p>
      <p style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 500 }}>Coin launched. Seat is open. No admin keys.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span className="mono muted" style={{ fontSize: 12 }}>
          deploy
        </span>
        <TxChip hash={hash} account={contractId} />
      </div>
    </article>
  );
}

function HallCard({ t, current, contractId }: { t: Takeover; current: boolean; contractId: string }) {
  const hash = useAsync(() => takeoverTx(contractId, t), [contractId, t.index]);
  return (
    <div className="card" style={{ padding: 12, position: 'relative' }}>
      <FaceImg face={t.face} size={150} />
      <p className="mono" style={{ margin: '8px 0 2px', fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>
        #{t.index + 1} {t.ceo}
      </p>
      <p className="mono muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        {current ? 'in office' : 'fired'} · paid {cto(t.paid)}
        <br />
        {t.previous_ceo ? `${t.previous_ceo} got ${cto(t.payout)}` : 'seat was vacant: all burned'}
      </p>
      <TxChip hash={hash} account={contractId} />
      {current && (
        <span className="chip ok" style={{ position: 'absolute', top: 8, right: 8 }}>
          NOW
        </span>
      )}
    </div>
  );
}
