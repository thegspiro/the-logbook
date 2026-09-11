import React from 'react';
import { useNavigate } from 'react-router';
import { ClipboardList, Building2, KeyRound, ArrowRight, Check, SkipForward } from 'lucide-react';

import { OnboardingHeader } from '../components';
import { ONBOARDING_STEPS, stepPath } from '../config/steps';

/**
 * What setup will ask for, before it starts asking.
 *
 * The wizard's own health screen tells an operator the database is up; nothing
 * told them the flow would want SMTP credentials, an OAuth client secret and a
 * storage key. So they started, hit a step they could not answer, and went to
 * find it — and walking away is exactly what used to end the install, because
 * the onboarding session lapses after thirty idle minutes.
 *
 * Two things make that unlikely now: the credential steps moved to the end,
 * and a lapsed session is recoverable. This closes the gap at the front, by
 * saying up front what is genuinely required (very little) and what can be
 * left for later (everything else).
 *
 * The two lists are derived from `ONBOARDING_STEPS`, not restated, so a step
 * that changes its `optional` flag changes this screen with it.
 */
const SetupPrerequisites: React.FC = () => {
  const navigate = useNavigate();

  const requiredSteps = ONBOARDING_STEPS.filter((step) => !step.optional);
  const optionalSteps = ONBOARDING_STEPS.filter((step) => step.optional);

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader departmentName="Department Setup" subtitle="Before you begin" />

      <main id="main-content" tabIndex={-1} className="flex flex-1 items-start justify-center p-4 py-10">
        <div className="w-full max-w-3xl space-y-8">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
              <ClipboardList className="h-8 w-8 text-red-700 dark:text-red-400" aria-hidden="true" />
            </div>
            <h2 className="text-theme-text-primary text-3xl font-bold">What setup will ask for</h2>
            <p className="text-theme-text-secondary mx-auto mt-2 max-w-xl">
              Only the first two steps are required. Everything after them can be skipped now and set up later from
              Settings, so you do not need to go looking for credentials before you start.
            </p>
          </div>

          {/* Required */}
          <section className="card p-6" aria-labelledby="required-heading">
            <h3
              id="required-heading"
              className="text-theme-text-primary mb-1 flex items-center gap-2 text-sm font-semibold"
            >
              <Building2 className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              Have these ready
            </h3>
            <p className="text-theme-text-muted mb-4 text-xs">
              {requiredSteps.map((step) => step.name).join(' and ')} — the only steps setup cannot finish without.
            </p>
            <ul className="space-y-3">
              {REQUIRED_ITEMS.map((entry) => (
                <li key={entry.title} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                    <Check className="h-3 w-3 text-red-700 dark:text-red-400" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-theme-text-primary text-sm font-medium">{entry.title}</p>
                    <p className="text-theme-text-muted text-xs">{entry.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Skippable */}
          <section className="card p-6" aria-labelledby="optional-heading">
            <h3
              id="optional-heading"
              className="text-theme-text-primary mb-1 flex items-center gap-2 text-sm font-semibold"
            >
              <KeyRound className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
              Useful to have, but skippable
            </h3>
            <p className="text-theme-text-muted mb-4 text-xs">
              Every one of these steps has a Skip. Skipping is a complete answer, not a deferral you will be nagged
              about.
            </p>
            <ul className="space-y-3">
              {OPTIONAL_ITEMS.map((entry) => (
                <li key={entry.title} className="flex items-start gap-3">
                  <span className="bg-theme-surface mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                    <SkipForward className="text-theme-text-muted h-3 w-3" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-theme-text-primary text-sm font-medium">{entry.title}</p>
                    <p className="text-theme-text-muted text-xs">{entry.description}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-theme-text-muted border-theme-surface-border mt-4 border-t pt-4 text-xs">
              {optionalSteps.length} of the {ONBOARDING_STEPS.length} steps are optional.
            </p>
          </section>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => void navigate(stepPath('organization'))}
              className="btn-primary flex flex-1 items-center justify-center gap-2"
            >
              Start setup
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

const REQUIRED_ITEMS: Array<{ title: string; description: string }> = [
  {
    title: 'Your department’s name and mailing address',
    description: 'Used for official correspondence and on anything the system prints.',
  },
  {
    title: 'A name, email address and password for the administrator account',
    description: 'Yours. It is created early so the rest of setup belongs to a real account you can sign back in to.',
  },
];

const OPTIONAL_ITEMS: Array<{ title: string; description: string }> = [
  {
    title: 'Which modules your department will use',
    description: 'Training, scheduling, inventory and the rest. Any of them can be turned on later.',
  },
  {
    title: 'Your ranks, positions, stations and apparatus',
    description: 'Rough is fine — all four are editable afterwards, and setup seeds sensible defaults.',
  },
  {
    title: 'Email sending credentials',
    description: 'An SMTP host, port, username and password, or a Google Workspace or Microsoft 365 account.',
  },
  {
    title: 'File storage credentials',
    description: 'Keys for S3, Google Drive, OneDrive or Azure. Local storage is the default and needs nothing.',
  },
  {
    title: 'A sign-in provider’s client ID and secret',
    description: 'Only if members should sign in with Google or Microsoft. Username and password is the default.',
  },
];

export default SetupPrerequisites;
