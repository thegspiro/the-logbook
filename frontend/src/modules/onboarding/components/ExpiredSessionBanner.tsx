import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { AlertTriangle, X } from 'lucide-react';
import { apiClient } from '../services/api-client';
import { useOnboardingStore } from '../store/onboardingStore';

const FIRST_STEP = '/onboarding/start';

/**
 * Says so when the wizard reopens on answers whose session has ended.
 *
 * The session id is tab-scoped (sessionStorage) so a credential that can
 * change setup never outlives the tab, but the typed answers persist in
 * localStorage so a part-finished profile is not lost. After a browser
 * restart the form therefore repaints with no session behind it, and the
 * first save failed with a bare "session expired". Owner decision 2026-11-01:
 * say it up front instead. Only the first step starts or resumes a session,
 * so the banner points there.
 *
 * Decided once, when the step mounts: a session started on this page does
 * not hide the banner until the next step, which is when it stops being true
 * that nothing here has a session.
 */
export const ExpiredSessionBanner: React.FC = () => {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(
    () => !apiClient.hasSession() && Boolean(useOnboardingStore.getState().departmentName)
  );

  if (!visible) return null;

  return (
    <div className="alert-warning mx-auto mt-4 flex max-w-3xl items-start gap-3 px-4 py-3" role="status">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Your setup session has ended</p>
        <p className="mt-1">
          Closing the browser, or 30 minutes without activity, ends it. The answers shown are a draft kept on this
          device: steps you finished are saved, but anything you had not yet continued past has not reached the server.{' '}
          {pathname === FIRST_STEP ? (
            'Continue from here to start a new session.'
          ) : (
            <>
              <Link to={FIRST_STEP} className="font-medium underline">
                Return to the first step
              </Link>{' '}
              to start a new session, then continue.
            </>
          )}{' '}
          If the System Owner account already exists, you will be asked to sign in with it.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="btn-icon shrink-0"
        aria-label="Dismiss the session notice"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};

export default ExpiredSessionBanner;
