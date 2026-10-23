import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, FileQuestion, LayoutDashboard } from 'lucide-react';
import { EmptyState } from '../components/ux';

/**
 * The page an unknown address lands on.
 *
 * Until now App.tsx's catch-all quietly redirected to the dashboard, which made
 * a bookmark to a removed page (`/scheduling/templates`, `/nfc-tags`) look like
 * the app had simply ignored the click. This says what happened instead.
 *
 * It sits inside the signed-in layout, so a signed-out visitor is sent to sign
 * in first (as before) and sees this afterwards, and a signed-in one keeps the
 * navigation to get back on track.
 */
const NotFoundPage: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Only the path is echoed. A query string or fragment can carry a token (a
  // password-reset or approval link), and this page should not display one.
  const where = pathname.length > 80 ? `${pathname.slice(0, 80)}…` : pathname;

  const goBack = () => {
    // A link opened in a new tab has no history to return to.
    if (window.history.length > 1) {
      void navigate(-1);
    } else {
      void navigate('/dashboard');
    }
  };

  return (
    <div data-page-main className="mx-auto max-w-2xl py-8">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        headingLevel={1}
        description={`There is no page at ${where}. The link may be out of date or mistyped, or the page may have moved.`}
        actions={[
          { label: 'Go to the dashboard', onClick: () => void navigate('/dashboard'), icon: LayoutDashboard },
          { label: 'Go back', onClick: goBack, variant: 'secondary', icon: ArrowLeft },
        ]}
      />
    </div>
  );
};

export default NotFoundPage;
