import { Link, useNavigate } from 'react-router-dom';
import { staffToken, staffUser } from '../../lib/api';

export function StaffHomePage() {
  const navigate = useNavigate();
  const me = staffUser.get();

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>{me ? `Welcome, ${me.name}` : 'Staff Dashboard'}</h1>
        <button
          onClick={() => {
            staffToken.clear();
            staffUser.clear();
            navigate('/staff/login');
          }}
        >
          Sign out
        </button>
      </div>
      <nav className="home-nav">
        <Link to="/app/dashboard" className="home-nav-card">
          <h2>Dashboard</h2>
          <p>Status, SLA compliance, agent workload and aging tickets for your department.</p>
        </Link>
        <Link to="/app/tickets" className="home-nav-card">
          <h2>Tickets</h2>
          <p>Browse, filter, assign, and move tickets through their statuses.</p>
        </Link>
        <Link to="/app/tickets/new" className="home-nav-card">
          <h2>New ticket</h2>
          <p>Raise a ticket on behalf of a customer.</p>
        </Link>
      </nav>
    </div>
  );
}
