import { describe, it, expect } from 'vitest';
import { resendNote } from './attendancePetitionResends';

describe('resendNote', () => {
  it('is silent for a request never withdrawn', () => {
    expect(resendNote(undefined)).toBeNull();
    expect(resendNote(0)).toBeNull();
  });

  it('counts the resends in words', () => {
    expect(resendNote(1)).toBe('Withdrawn and sent again once');
    expect(resendNote(2)).toBe('Withdrawn and sent again twice');
    expect(resendNote(3)).toBe('Withdrawn and sent again 3 times');
  });
});
