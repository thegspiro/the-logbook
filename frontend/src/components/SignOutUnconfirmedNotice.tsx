/**
 * Shown when Sign Out could not be confirmed by the server (FE3-34-2).
 *
 * The auth cookies are httpOnly, so only a successful `POST /auth/logout` can
 * clear them. If that never succeeded, the previous member's session is still
 * live in this browser, and a login screen would tell the next person at a
 * shared station computer the opposite. This covers the whole app instead,
 * with no way to dismiss it: the member either gets the sign-out confirmed or
 * closes the browser, which ends the cookies' life in it.
 */

import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export const SignOutUnconfirmedNotice: React.FC = () => {
  const signOutUnconfirmed = useAuthStore((s) => s.signOutUnconfirmed);
  const retrySignOut = useAuthStore((s) => s.retrySignOut);
  const [retrying, setRetrying] = useState(false);

  if (!signOutUnconfirmed) return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retrySignOut();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="surface-opaque fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sign-out-unconfirmed-title"
        aria-describedby="sign-out-unconfirmed-body"
        className="card modal-panel-scroll max-w-md p-6 text-center"
      >
        <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-red-700 dark:text-red-400" aria-hidden="true" />
        <h1 id="sign-out-unconfirmed-title" className="text-theme-text-primary mb-2 text-lg font-semibold">
          Sign-out could not be confirmed
        </h1>
        <div id="sign-out-unconfirmed-body" className="text-theme-text-secondary space-y-2 text-sm">
          <p>
            The server did not confirm that your session ended, so it may still be usable from this browser. Close every
            window of this browser now, especially on a shared computer.
          </p>
          <p>If the connection is back, try signing out again.</p>
        </div>
        <button
          type="button"
          onClick={() => void handleRetry()}
          disabled={retrying}
          className="btn-primary mt-5 w-full"
        >
          {retrying ? 'Trying…' : 'Try signing out again'}
        </button>
      </div>
    </div>
  );
};

export default SignOutUnconfirmedNotice;
