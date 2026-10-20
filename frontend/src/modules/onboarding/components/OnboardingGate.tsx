import React, { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router';
import { Loader2 } from 'lucide-react';
import { apiClient } from '../services/api-client';
import {
  getOnboardingGateAnswer,
  setOnboardingGateAnswer,
  type OnboardingGateAnswer,
} from '../utils/onboardingGateState';

type GateState = OnboardingGateAnswer | 'checking';

/**
 * Keeps the setup steps off a department that is already set up.
 *
 * Anyone could open `/onboarding/start` on a configured installation and fill
 * in the whole Organization Setup form, only to be told when they submitted that
 * setup was closed (`LB-ONBD-001`). The backend refuses correctly, so nothing
 * was exposed, but the screen invited work that could never be saved.
 *
 * This asks `GET /onboarding/status` once and sends a visitor to sign-in when
 * setup is finished. It deliberately fails open: if the status call errors or
 * is rate limited the step renders as it always did, because the backend is the
 * authority and a first-run install must never be locked out of its own setup by
 * a failed check. `/onboarding/complete` is outside this gate, since the last
 * step of a first run lands there after setup has just been marked finished.
 */
export const OnboardingGate: React.FC = () => {
  const [state, setState] = useState<GateState>(() => getOnboardingGateAnswer() ?? 'checking');

  useEffect(() => {
    if (state !== 'checking') return undefined;
    let cancelled = false;

    apiClient
      .getStatus()
      .then((response) => {
        const needsOnboarding = (response.data as { needs_onboarding?: boolean } | undefined)?.needs_onboarding;
        if (needsOnboarding === undefined) {
          if (!cancelled) setState('open');
          return;
        }
        const next: OnboardingGateAnswer = needsOnboarding ? 'open' : 'closed';
        setOnboardingGateAnswer(next);
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState('open');
      });

    return () => {
      cancelled = true;
    };
  }, [state]);

  if (state === 'closed') {
    return <Navigate to="/login" replace />;
  }

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Checking setup status</span>
      </div>
    );
  }

  return <Outlet />;
};

export default OnboardingGate;
