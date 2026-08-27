import { describe, it, expect } from 'vitest';
import { mayHoldOperationalRank, membershipClassification } from './membership';

describe('mayHoldOperationalRank', () => {
  it('refuses an administrative member', () => {
    // A rank grants its default permissions and decides shift eligibility, so
    // it cannot sit on somebody the department has said does not respond.
    expect(mayHoldOperationalRank('administrative')).toBe(false);
  });

  it('allows every rung of the operational ladder', () => {
    // Class and status are separate questions: a probationary member and a
    // life member are both operational, and both may hold a rank.
    for (const type of ['prospective', 'probationary', 'active', 'regular', 'life', 'retired']) {
      expect(mayHoldOperationalRank(type)).toBe(true);
    }
  });

  it('allows an honorary member', () => {
    // Only the administrative class is barred. Widening this to the social
    // class would take ranks from honorary members, which is a different rule.
    expect(mayHoldOperationalRank('honorary')).toBe(true);
  });

  it('tolerates case and whitespace', () => {
    // The value comes off a form and out of an API response, neither of which
    // has ever normalised it.
    expect(mayHoldOperationalRank('  Administrative ')).toBe(false);
  });

  it('allows a member whose type is not recorded', () => {
    // Matches `may_hold_rank` on the server, which declines to guess: an
    // unrecognised value is an org-configured membership tier, not evidence
    // that the member is administrative. Guessing the other way would grey the
    // field out for members whose department merely configured its own tiers.
    for (const empty of [undefined, null, '', '   ']) {
      expect(mayHoldOperationalRank(empty)).toBe(true);
    }
  });

  it('allows a custom membership tier', () => {
    expect(mayHoldOperationalRank('senior')).toBe(true);
  });
});

describe('membershipClassification', () => {
  it('sends an operational rung as a status, not as a class', () => {
    // "regular" is a rung on the ladder. Sent as the legacy `membership_type`
    // it is not one of that field's seven values and resolves to no class and
    // no status — which drops the member out of every body keyed on either.
    expect(membershipClassification('regular')).toEqual({
      member_class: 'operational',
      member_status: 'regular',
    });
    expect(membershipClassification('probationary')).toEqual({
      member_class: 'operational',
      member_status: 'probationary',
    });
    expect(membershipClassification('life')).toEqual({
      member_class: 'operational',
      member_status: 'life',
    });
  });

  it('sends administrative as a class with no status', () => {
    // The choice says what kind of member this is and nothing about how far
    // through the progression they are. Inventing "regular" for them would
    // record a fact nobody stated.
    expect(membershipClassification('administrative')).toEqual({ member_class: 'administrative' });
  });

  it('sends nothing when no type was chosen', () => {
    // Omitting both leaves the server deriving them from `membership_type` as
    // it did before, rather than defaulting the member into a class.
    for (const empty of [undefined, null, '', '   ']) {
      expect(membershipClassification(empty)).toEqual({});
    }
  });

  it('normalises what it is given', () => {
    expect(membershipClassification('  Administrative ')).toEqual({ member_class: 'administrative' });
  });
});
