import { useNavigate } from 'react-router-dom';
import { staffToken } from '../../lib/api';

// Placeholder landing page for the staff app tree (/app/*). Real content
// (ticket list, dashboards) lands with the tickets/dashboards modules.
export function StaffHomePage() {
  const navigate = useNavigate();
  return (
    <div>
      <h1>Staff Dashboard</h1>
      <p>Signed in. Ticket list, dashboards, and the low-code admin UI land here next.</p>
      <button
        onClick={() => {
          staffToken.clear();
          navigate('/staff/login');
        }}
      >
        Sign out
      </button>
    </div>
  );
}
