import { describe, it, expect, beforeEach } from 'vitest';
import { clearPendingSkillsWork, getPendingSkillsWork, setPendingSkillsWork } from './pendingSkillsWork';

const SCBA = { testId: 'test-1', label: 'SCBA Donning for Nadia Belhaj' };
const LADDER = { testId: 'test-2', label: 'Ladder Raise for Callum Frazier' };

describe('pendingSkillsWork', () => {
  beforeEach(() => setPendingSkillsWork(null));

  it('reports nothing when no evaluation is unsaved', () => {
    expect(getPendingSkillsWork()).toBeNull();
  });

  it('reports what is unsaved, so the warning can name it', () => {
    setPendingSkillsWork(SCBA);

    expect(getPendingSkillsWork()).toEqual(SCBA);
  });

  it('clears when the work is saved', () => {
    setPendingSkillsWork(SCBA);
    clearPendingSkillsWork(SCBA.testId);

    expect(getPendingSkillsWork()).toBeNull();
  });

  // An examiner who opens a second evaluation while the first is still unsaved
  // must not have the first one's warning cleared by the second's unmount — a
  // bare reset on unmount would do exactly that, and the lost evaluation would
  // be the one nobody was warned about.
  it('a different test clearing does not discard the standing warning', () => {
    setPendingSkillsWork(SCBA);
    clearPendingSkillsWork(LADDER.testId);

    expect(getPendingSkillsWork()).toEqual(SCBA);
  });

  it('the most recent unsaved evaluation replaces an earlier one', () => {
    setPendingSkillsWork(SCBA);
    setPendingSkillsWork(LADDER);

    expect(getPendingSkillsWork()).toEqual(LADDER);
  });

  it('can be cleared outright, which is what a confirmed logout does', () => {
    setPendingSkillsWork(SCBA);
    setPendingSkillsWork(null);

    expect(getPendingSkillsWork()).toBeNull();
  });
});
