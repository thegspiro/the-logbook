/**
 * What step 1 sends when a department is asked whether its members carry
 * numbers.
 *
 * Two answers have to stay distinguishable on the wire — "we do not number our
 * members" and "nobody asked me" — because the first must survive a change to
 * the shipped default and the second must not.
 */
import { describe, it, expect } from 'vitest';
import { membershipIdPayload } from './memberNumbering';

describe('membershipIdPayload', () => {
  it('sends nothing when the department does not number its members', () => {
    // Not `{ enabled: false }`: an absent block leaves the shipped default
    // alone, so skipping the question stays distinguishable from answering no.
    expect(membershipIdPayload({ enabled: false, prefix: 'FD-', start: '7' })).toBeUndefined();
  });

  it('carries the prefix and the starting number the department chose', () => {
    expect(membershipIdPayload({ enabled: true, prefix: 'FD-', start: '7' })).toEqual({
      enabled: true,
      auto_generate: true,
      prefix: 'FD-',
      next_number: 7,
    });
  });

  it('trims a prefix typed with a stray space', () => {
    expect(membershipIdPayload({ enabled: true, prefix: '  FD- ', start: '1' })?.prefix).toBe('FD-');
  });

  it('starts at one when the field is left empty', () => {
    // `next_number` is `ge=1` on the backend. Failing the whole of step 1 over
    // an optional answer is worse than settling it.
    expect(membershipIdPayload({ enabled: true, prefix: '', start: '' })?.next_number).toBe(1);
  });

  it('starts at one when the field holds something that is not a number', () => {
    expect(membershipIdPayload({ enabled: true, prefix: '', start: 'abc' })?.next_number).toBe(1);
  });

  it('starts at one rather than sending a number the backend rejects', () => {
    expect(membershipIdPayload({ enabled: true, prefix: '', start: '0' })?.next_number).toBe(1);
    expect(membershipIdPayload({ enabled: true, prefix: '', start: '-5' })?.next_number).toBe(1);
  });

  it('turns auto-generation on, which is the point of asking during setup', () => {
    // The answer exists so the accounts setup itself creates are numbered.
    expect(membershipIdPayload({ enabled: true, prefix: '', start: '1' })?.auto_generate).toBe(true);
  });
});
