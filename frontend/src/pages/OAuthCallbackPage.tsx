import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

/**
 * Landing page for the Google OAuth redirect.
 *
 * By the time the browser reaches this route, the backend callback has already
 * verified the Google identity and set the httpOnly auth cookies. This page just
 * needs to mark the local session flag and hydrate the user, then send them on.
 *
 * The backend redirects failures to /login?error=... instead of here, so any
 * failure that reaches this page means loadUser() couldn't establish a session.
 */
export const OAuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const loadUser = useAuthStore((s) => s.loadUser);
  const [failed, setFailed] = useState(false);
  // StrictMode mounts effects twice in dev; guard so we only run once.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const finish = async () => {
      // The httpOnly cookies are set; tell loadUser a session may exist.
      localStorage.setItem('has_session', '1');
      try {
        await loadUser();
      } catch {
        // loadUser clears has_session on failure; fall through to the check.
      }
      if (useAuthStore.getState().isAuthenticated) {
        navigate('/dashboard', { replace: true });
      } else {
        setFailed(true);
      }
    };

    void finish();
  }, [loadUser, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-linear-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to p-4">
      <div className="card w-full max-w-md p-8 text-center">
        {failed ? (
          <>
            <h1 className="mb-3 text-2xl font-bold text-theme-text-primary">
              Sign-in could not be completed
            </h1>
            <p className="mb-6 text-theme-text-secondary">
              We couldn&apos;t finish signing you in with Google. Please try again.
            </p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="btn-primary"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 inline-block h-8 w-8 animate-spin rounded-full border-2 border-theme-surface-border border-t-transparent" />
            <p className="text-theme-text-secondary">Completing sign-in&hellip;</p>
          </>
        )}
      </div>
    </main>
  );
};
