import { Link } from 'react-router';
import { cto } from '../lib/format';

/** Phone only (CSS): sticky seat price + TAKE OVER. */
export function PhoneBar({ price, to, label = 'TAKE OVER →', onClick }: { price: string; to?: string; label?: string; onClick?: () => void }) {
  return (
    <div className="phonebar" role="region" aria-label="Seat price">
      <div>
        <p className="kick" style={{ margin: 0 }}>
          Seat price
        </p>
        <p className="mono" style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>
          {cto(price)} CTO
        </p>
      </div>
      {to ? (
        <Link className="btn" to={to} style={{ minHeight: 48, fontSize: 17, padding: '0 16px' }}>
          {label}
        </Link>
      ) : (
        <button type="button" className="btn" onClick={onClick} style={{ minHeight: 48, fontSize: 17, padding: '0 16px' }}>
          {label}
        </button>
      )}
    </div>
  );
}
