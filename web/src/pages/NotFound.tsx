import { Link } from 'react-router';

export function NotFound() {
  return (
    <section className="card">
      <p className="kick">404</p>
      <p className="hd" style={{ fontSize: 40 }}>NO SUCH PAGE IN TODAY'S EDITION</p>
      <p style={{ margin: '14px 0 0' }}>
        <Link className="ghost" to="/">
          Back to the front page
        </Link>
      </p>
    </section>
  );
}
