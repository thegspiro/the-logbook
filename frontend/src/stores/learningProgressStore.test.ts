import { beforeEach, describe, expect, it } from 'vitest';

import { useLearningProgressStore } from './learningProgressStore';

const reset = () => useLearningProgressStore.setState({ userId: null, completed: {}, promptDismissed: false });

describe('learningProgressStore', () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  it('keeps one member’s progress out of another member’s view', () => {
    // The v1 bug: a shared station browser wrote every member's checkmarks to
    // the same key, so whoever signed in next saw — and overwrote — them.
    const store = useLearningProgressStore.getState();

    store.loadFor('member-a');
    useLearningProgressStore.getState().setStepComplete('getting-started', 'dashboard', true);

    useLearningProgressStore.getState().loadFor('member-b');
    expect(useLearningProgressStore.getState().completed).toEqual({});

    useLearningProgressStore.getState().setStepComplete('mobile', 'install', true);
    useLearningProgressStore.getState().loadFor('member-a');
    expect(useLearningProgressStore.getState().completed).toEqual({ 'getting-started.dashboard': true });
  });

  it('persists progress across a reload for the same member', () => {
    useLearningProgressStore.getState().loadFor('member-a');
    useLearningProgressStore.getState().setStepComplete('getting-started', 'account', true);

    reset();
    useLearningProgressStore.getState().loadFor('member-a');

    expect(useLearningProgressStore.getState().completed).toEqual({ 'getting-started.account': true });
  });

  it('discards the unattributable v1 payload instead of adopting it', () => {
    localStorage.setItem('logbook.learning-progress.v1', JSON.stringify({ 'getting-started.dashboard': true }));

    useLearningProgressStore.getState().loadFor('member-a');

    expect(useLearningProgressStore.getState().completed).toEqual({});
    expect(localStorage.getItem('logbook.learning-progress.v1')).toBeNull();
  });

  it('ignores a stored value that is not a map of booleans', () => {
    localStorage.setItem('logbook.learning-progress.v2.member-a', '["nope"]');
    useLearningProgressStore.getState().loadFor('member-a');
    expect(useLearningProgressStore.getState().completed).toEqual({});

    reset();
    localStorage.setItem('logbook.learning-progress.v2.member-a', '{ not json');
    useLearningProgressStore.getState().loadFor('member-a');
    expect(useLearningProgressStore.getState().completed).toEqual({});

    reset();
    localStorage.setItem('logbook.learning-progress.v2.member-a', JSON.stringify({ good: true, bad: 'yes' }));
    useLearningProgressStore.getState().loadFor('member-a');
    expect(useLearningProgressStore.getState().completed).toEqual({ good: true });
  });

  it('clears progress and the dashboard dismissal together on reset', () => {
    useLearningProgressStore.getState().loadFor('member-a');
    useLearningProgressStore.getState().setStepComplete('getting-started', 'dashboard', true);
    useLearningProgressStore.getState().dismissPrompt();
    expect(localStorage.getItem('logbook.learning-prompt-dismissed.v1.member-a')).toBe('1');

    useLearningProgressStore.getState().reset();

    expect(useLearningProgressStore.getState().completed).toEqual({});
    // Un-dismissed on purpose: a member starting over needs the dashboard
    // prompt back, or there is no route to the lessons from where they land.
    expect(useLearningProgressStore.getState().promptDismissed).toBe(false);
    expect(localStorage.getItem('logbook.learning-progress.v2.member-a')).toBeNull();
    expect(localStorage.getItem('logbook.learning-prompt-dismissed.v1.member-a')).toBeNull();
  });

  it('remembers a dismissal per member', () => {
    useLearningProgressStore.getState().loadFor('member-a');
    useLearningProgressStore.getState().dismissPrompt();

    useLearningProgressStore.getState().loadFor('member-b');
    expect(useLearningProgressStore.getState().promptDismissed).toBe(false);

    useLearningProgressStore.getState().loadFor('member-a');
    expect(useLearningProgressStore.getState().promptDismissed).toBe(true);
  });

  it('still tracks progress in memory when there is no signed-in member', () => {
    useLearningProgressStore.getState().loadFor(null);
    useLearningProgressStore.getState().setStepComplete('getting-started', 'dashboard', true);

    expect(useLearningProgressStore.getState().completed).toEqual({ 'getting-started.dashboard': true });
    expect(localStorage.length).toBe(0);
  });
});
