import { useNavigate } from 'react-router-dom';
import { customerToken } from '../../lib/api';

// Placeholder landing page for the customer portal tree (/portal/*).
export function PortalHomePage() {
  const navigate = useNavigate();
  return (
    <div>
      <h1>My Tickets</h1>
      <p>Signed in. Your submitted tickets and their status will show here.</p>
      <button
        onClick={() => {
          customerToken.clear();
          navigate('/portal/login');
        }}
      >
        Sign out
      </button>
    </div>
  );
}
