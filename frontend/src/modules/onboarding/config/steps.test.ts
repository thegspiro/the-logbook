import { describe, it, expect } from 'vitest';

import {
  ONBOARDING_COMPLETE_PATH,
  ONBOARDING_CONFIG_PATHS,
  ONBOARDING_STEPS,
  nextStepName,
  nextStepPath,
  previousStepPath,
  stepPath,
} from './steps';

/**
 * Guards live out here rather than inside a test body: narrowing a
 * `T | undefined` (noUncheckedIndexedAccess) with an `if` inside `it()` trips
 * vitest/no-conditional-in-test, and a non-null assertion is banned outright.
 */
const lastStep = (): (typeof ONBOARDING_STEPS)[number] => {
  const step = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
  if (!step) throw new Error('ONBOARDING_STEPS is empty');
  return step;
};

/** Follow nextStepPath from the first step until it reaches completion. */
const walkFlow = (): string[] => {
  const visited: string[] = [];
  let path = stepPath('organization');

  for (let i = 0; i < ONBOARDING_STEPS.length + 1; i += 1) {
    if (path === ONBOARDING_COMPLETE_PATH) return visited;
    const step = ONBOARDING_STEPS.find((s) => s.path === path);
    if (!step) throw new Error(`no step declares the path ${path}`);
    visited.push(path);
    path = nextStepPath(step.key);
  }

  throw new Error('the flow never reached the completion screen');
};

describe('onboarding step order', () => {
  it('starts at the organization and puts identity immediately after it', () => {
    // The rest of setup should belong to a real account rather than to an
    // anonymous 30-minute session, which is what stranded installs.
    expect(ONBOARDING_STEPS[0]?.key).toBe('organization');
    expect(ONBOARDING_STEPS[1]?.key).toBe('system_owner');
  });

  it('asks what the department uses before any external integration', () => {
    const keys = ONBOARDING_STEPS.map((s) => s.key);
    const lastDepartmentStep = Math.max(
      keys.indexOf('modules'),
      keys.indexOf('positions'),
      keys.indexOf('stations'),
      keys.indexOf('apparatus')
    );
    const firstIntegration = Math.min(
      keys.indexOf('email'),
      keys.indexOf('file_storage'),
      keys.indexOf('authentication')
    );

    expect(lastDepartmentStep).toBeLessThan(firstIntegration);
  });

  it('chooses modules before configuring permissions against them', () => {
    const keys = ONBOARDING_STEPS.map((s) => s.key);
    expect(keys.indexOf('modules')).toBeLessThan(keys.indexOf('positions'));
  });

  it('marks only the organization and the administrator account as required', () => {
    // Mirrors `required_steps` in OnboardingService.complete_onboarding.
    const required = ONBOARDING_STEPS.filter((s) => !s.optional).map((s) => s.key);
    expect(required).toEqual(['organization', 'system_owner']);
  });

  it('has no duplicate keys or paths', () => {
    const keys = ONBOARDING_STEPS.map((s) => s.key);
    const paths = ONBOARDING_STEPS.map((s) => s.path);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('does not give a provider-config route a step of its own', () => {
    // Email's config page used to count as a step while File Storage's did
    // not, so the same kind of decision cost different visible progress.
    const paths = ONBOARDING_STEPS.map((s) => s.path);
    expect(paths).not.toContain(ONBOARDING_CONFIG_PATHS.email);
    expect(paths).not.toContain(ONBOARDING_CONFIG_PATHS.fileStorage);
  });
});

describe('nextStepPath', () => {
  it('walks every step exactly once and ends at the completion screen', () => {
    expect(walkFlow()).toEqual(ONBOARDING_STEPS.map((s) => s.path));
  });

  it('hands the last step off to completion', () => {
    expect(nextStepPath(lastStep().key)).toBe(ONBOARDING_COMPLETE_PATH);
  });
});

describe('stepPath', () => {
  it('returns each step its own route', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(stepPath(step.key)).toBe(step.path);
    }
  });
});

describe('previousStepPath', () => {
  it('is the inverse of nextStepPath at every step', () => {
    // Back links were hardcoded per page just like the forward ones, and the
    // reorder left every one of them pointing at the old predecessor.
    const paths = ONBOARDING_STEPS.map((s) => s.path);

    expect(ONBOARDING_STEPS.map((s) => previousStepPath(s.key))).toEqual(['/', ...paths.slice(0, -1)]);
    expect(ONBOARDING_STEPS.map((s) => nextStepPath(s.key))).toEqual([...paths.slice(1), ONBOARDING_COMPLETE_PATH]);
  });

  it('sends the first step back to the welcome screen', () => {
    expect(previousStepPath('organization')).toBe('/');
  });
});

describe('nextStepName', () => {
  it('names the step the flow actually goes to next', () => {
    const names = ONBOARDING_STEPS.map((s) => s.name);

    expect(ONBOARDING_STEPS.map((s) => nextStepName(s.key))).toEqual([...names.slice(1), 'Finish']);
  });

  it('answers for the two steps whose buttons name their destination', () => {
    // Both were wrong after the reorder — see stepLabelIntegrity.test.ts.
    expect(nextStepName('positions')).toBe('Stations');
    expect(nextStepName('it_team')).toBe('Email');
  });
});
