/**
 * The onboarding wizard's step order — the single declaration of it.
 *
 * The order used to live in three places that each restated it: this list's
 * predecessor inside ProgressIndicatorEnhanced, the route table, and a
 * hardcoded next-step path passed to navigate() in all thirteen pages. They
 * drifted, which is what the progress indicator's own history records. A page
 * now names only itself and asks for its successor, so inserting or moving a
 * step is an edit to this array alone.
 *
 * Order reflects what a department can answer rather than what the system
 * wants to store. Identity comes second so the rest of setup belongs to a real
 * account; what the department uses (modules, ranks, stations, apparatus)
 * comes before the external integrations (email, storage, sign-in), which are
 * the steps that send someone off to find credentials and are all skippable.
 */

export interface OnboardingStep {
  /** Stable id. Pages and the backend's `STEPS` agree on these. */
  key: string;
  name: string;
  shortName: string;
  path: string;
  /**
   * True when setup can complete without the step being answered. Only the
   * organization and the administrator account are genuinely required — see
   * `required_steps` in `OnboardingService.complete_onboarding`.
   */
  optional: boolean;
}

export const ONBOARDING_STEPS = [
  {
    key: 'organization',
    name: 'Organization Setup',
    shortName: 'Organization',
    path: '/onboarding/start',
    optional: false,
  },
  {
    key: 'system_owner',
    name: 'Administrator Account',
    shortName: 'Administrator',
    path: '/onboarding/system-owner',
    optional: false,
  },
  {
    key: 'modules',
    name: 'Modules',
    shortName: 'Modules',
    path: '/onboarding/modules',
    optional: true,
  },
  {
    key: 'positions',
    name: 'Ranks & Positions',
    shortName: 'Positions',
    path: '/onboarding/positions',
    optional: true,
  },
  {
    key: 'stations',
    name: 'Stations',
    shortName: 'Stations',
    path: '/onboarding/stations',
    optional: true,
  },
  {
    key: 'apparatus',
    name: 'Apparatus',
    shortName: 'Apparatus',
    path: '/onboarding/apparatus',
    optional: true,
  },
  {
    key: 'it_team',
    name: 'IT & Backup Contacts',
    shortName: 'IT Contacts',
    path: '/onboarding/it-team',
    optional: true,
  },
  {
    key: 'email',
    name: 'Email',
    shortName: 'Email',
    path: '/onboarding/email-platform',
    optional: true,
  },
  {
    key: 'file_storage',
    name: 'File Storage',
    shortName: 'Storage',
    path: '/onboarding/file-storage',
    optional: true,
  },
  {
    key: 'authentication',
    name: 'Sign-In Method',
    shortName: 'Sign-In',
    path: '/onboarding/authentication',
    optional: true,
  },
  {
    key: 'navigation',
    name: 'Navigation Layout',
    shortName: 'Layout',
    path: '/onboarding/navigation-choice',
    optional: true,
  },
] as const satisfies readonly OnboardingStep[];

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]['key'];

/**
 * Routes that configure the provider a step just chose. They deliberately have
 * no entry of their own: a department that picks SMTP has not reached a
 * twelfth step, it is still on Email. Email's config page used to count as a
 * step while File Storage's did not, which made the same decision cost a
 * different amount of visible progress depending on which one you were making.
 */
export const ONBOARDING_CONFIG_PATHS = {
  email: '/onboarding/email-config',
  fileStorage: '/onboarding/file-storage-config',
} as const;

/** Where the wizard hands off once the last step is done. */
export const ONBOARDING_COMPLETE_PATH = '/onboarding/complete';

const stepIndex = (key: OnboardingStepKey): number => ONBOARDING_STEPS.findIndex((step) => step.key === key);

/** The route for a named step. Use this instead of retyping a path. */
export const stepPath = (key: OnboardingStepKey): string => {
  const index = stepIndex(key);
  // A key that is not in the list is a programming error, not a runtime state;
  // sending the operator back to step 1 beats navigating to `undefined`.
  return ONBOARDING_STEPS[index]?.path ?? '/onboarding/start';
};

/**
 * The route after `key`. The last step hands off to the completion screen.
 */
export const nextStepPath = (key: OnboardingStepKey): string => {
  const index = stepIndex(key);
  if (index < 0) return ONBOARDING_COMPLETE_PATH;
  return ONBOARDING_STEPS[index + 1]?.path ?? ONBOARDING_COMPLETE_PATH;
};

/**
 * The route before `key`. The first step has no predecessor inside the wizard,
 * so it goes back to the Welcome screen.
 *
 * Back links were hardcoded per page exactly like the forward ones, and the
 * reorder proved why that does not hold: every one of them still pointed at
 * the step that used to precede it.
 */
export const previousStepPath = (key: OnboardingStepKey): string => {
  const index = stepIndex(key);
  if (index <= 0) return '/';
  return ONBOARDING_STEPS[index - 1]?.path ?? '/';
};

/**
 * The name of the step after `key`, for a button that says where it goes.
 *
 * Two buttons named their successor as a literal and the 2026-09-11 reorder
 * left both lying: Ranks & Positions offered "Continue to Modules" while
 * going to Stations, and IT Contacts offered "Continue to Module Selection"
 * while going to Email. A label is a promise about navigation, so it comes
 * from the same array the navigation does.
 */
export const nextStepName = (key: OnboardingStepKey): string => {
  const index = stepIndex(key);
  if (index < 0) return 'the next step';
  return ONBOARDING_STEPS[index + 1]?.name ?? 'Finish';
};
