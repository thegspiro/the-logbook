import { describe, expect, it } from 'vitest';

import {
  attributionName,
  displayNameOf,
  FORMER_MEMBER_LABEL,
  formatLegalName,
  formatMemberName,
  givenName,
} from './memberName';

describe('memberName', () => {
  const terry = { first_name: 'John', last_name: 'Heather', preferred_name: 'Terry' };

  it('uses the preferred name in place of the first name', () => {
    expect(formatMemberName(terry)).toBe('Terry Heather');
    expect(givenName(terry)).toBe('Terry');
  });

  it('falls back to the first name when no preferred name is set', () => {
    expect(formatMemberName({ first_name: 'John', last_name: 'Heather' })).toBe('John Heather');
    expect(formatMemberName({ ...terry, preferred_name: null })).toBe('John Heather');
    expect(formatMemberName({ ...terry, preferred_name: '  ' })).toBe('John Heather');
  });

  it('keeps the legal name for records of note', () => {
    expect(formatLegalName(terry)).toBe('John Heather');
  });

  it('leaves no stray spaces when a part is missing', () => {
    expect(formatMemberName({ last_name: 'Heather' })).toBe('Heather');
    expect(formatMemberName({ first_name: 'John', last_name: null })).toBe('John');
    expect(formatMemberName({})).toBe('');
  });
});

describe('displayNameOf', () => {
  it("prefers the server's display_name", () => {
    expect(displayNameOf({ display_name: 'Terry Heather', full_name: 'John Heather' })).toBe('Terry Heather');
  });

  it('composes from the parts when display_name is absent', () => {
    expect(
      displayNameOf({ first_name: 'John', last_name: 'Heather', preferred_name: 'Terry', full_name: 'John Heather' })
    ).toBe('Terry Heather');
  });

  it('falls back to full_name for payloads with no parts', () => {
    expect(displayNameOf({ full_name: 'John Heather' })).toBe('John Heather');
    expect(displayNameOf({})).toBe('');
  });
});

describe('attributionName', () => {
  it('shows the name when there is one', () => {
    expect(attributionName('Jane Smith', 'u1')).toBe('Jane Smith');
  });

  it('reads a cleared reference as a former member', () => {
    expect(attributionName(null, null)).toBe(FORMER_MEMBER_LABEL);
    expect(attributionName(undefined, null, '—')).toBe(FORMER_MEMBER_LABEL);
  });

  it('falls back when the member exists but the name did not load', () => {
    expect(attributionName(null, 'u1')).toBe('Unknown');
    expect(attributionName('', 'u1', '—')).toBe('—');
  });
});
