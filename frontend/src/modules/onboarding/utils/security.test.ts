import { describe, it, expect } from 'vitest';
import { sanitizeInput, isValidPhone, isValidEmailSecure, isValidHostSecure, isValidUsernameSecure } from './security';

describe('onboarding security utils', () => {
  describe('sanitizeInput', () => {
    it('strips angle brackets so markup cannot survive the field', () => {
      expect(sanitizeInput('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
    });

    it('strips single and double quotes', () => {
      expect(sanitizeInput(`O'Brien "The Chief"`)).toBe('OBrien The Chief');
    });

    it('removes the javascript: protocol regardless of case', () => {
      expect(sanitizeInput('JaVaScRiPt:alert(1)')).toBe('alert(1)');
    });

    it('removes inline event-handler attributes regardless of case', () => {
      expect(sanitizeInput('onerror=boom')).toBe('boom');
      expect(sanitizeInput('OnClick=boom')).toBe('boom');
    });

    it('trims surrounding whitespace', () => {
      expect(sanitizeInput('   Station 1   ')).toBe('Station 1');
    });

    it('leaves ordinary text untouched', () => {
      expect(sanitizeInput('Falls Church Volunteer Fire Department')).toBe('Falls Church Volunteer Fire Department');
    });

    it('strips a protocol split by angle brackets, because brackets go first', () => {
      expect(sanitizeInput('java<>script:alert(1)')).toBe('alert(1)');
    });

    // Each replace() is a single left-to-right pass that never re-scans text it
    // has already emitted, so a split token reassembles behind the cursor and
    // survives. These two are the documented limit of this function, not a
    // regression: sanitizeInput is defence in depth, and its output still must
    // never be interpolated as HTML or used as a URL.
    it('lets a split token reassemble — javascript: survives nesting', () => {
      expect(sanitizeInput('javajavascript:script:alert(1)')).toBe('javascript:alert(1)');
    });

    it('lets a split token reassemble — an event handler survives nesting', () => {
      expect(sanitizeInput('ononerror=error=x')).toBe('error=x');
    });
  });

  describe('isValidEmailSecure', () => {
    it.each(['chief@fallschurchfire.org', 'first.last@example.co.uk', "o'brien@example.com", 'tag+filter@example.com'])(
      'accepts %s',
      (email) => {
        expect(isValidEmailSecure(email)).toBe(true);
      }
    );

    it.each([
      ['no at sign', 'chief.example.com'],
      ['no domain', 'chief@'],
      ['no local part', '@example.com'],
      ['spaces', 'chief @example.com'],
      ['empty', ''],
    ])('rejects %s', (_label, email) => {
      expect(isValidEmailSecure(email)).toBe(false);
    });

    // Header injection: a newline in an address lets an attacker append their
    // own SMTP headers when the value reaches the mail layer.
    it.each([
      ['literal LF', 'chief@example.com\nBcc: evil@example.com'],
      ['literal CR', 'chief@example.com\rBcc: evil@example.com'],
    ])('rejects an address carrying a %s', (_label, email) => {
      expect(isValidEmailSecure(email)).toBe(false);
    });

    // `%` is a legal local-part character, so a percent-encoded newline passes
    // the format regex and is caught only by the explicit guard after it. If
    // the value is later decoded anywhere on its way to the mail layer, this is
    // the same header injection as a literal newline.
    it.each([
      ['encoded LF', 'chief%0a@example.com'],
      ['encoded CR', 'chief%0d@example.com'],
    ])('rejects an address carrying an %s', (_label, email) => {
      expect(isValidEmailSecure(email)).toBe(false);
    });

    it('rejects an encoded newline regardless of case', () => {
      expect(isValidEmailSecure('chief%0A@example.com')).toBe(false);
      expect(isValidEmailSecure('chief%0D@example.com')).toBe(false);
    });

    it('rejects an address longer than 254 characters', () => {
      const local = 'a'.repeat(250);
      expect(isValidEmailSecure(`${local}@example.com`)).toBe(false);
    });

    it('accepts an address at exactly the 254-character limit', () => {
      const domain = '@example.com';
      const email = 'a'.repeat(254 - domain.length) + domain;
      expect(email).toHaveLength(254);
      expect(isValidEmailSecure(email)).toBe(true);
    });
  });

  describe('isValidHostSecure', () => {
    it.each(['smtp.gmail.com', 'localhost', 'mail-01.example.co.uk', '192.168.1.10', '10.0.0.1'])(
      'accepts %s',
      (host) => {
        expect(isValidHostSecure(host)).toBe(true);
      }
    );

    it.each([
      ['a URL rather than a host', 'https://smtp.gmail.com'],
      ['a host with a port', 'smtp.gmail.com:587'],
      ['a leading hyphen', '-smtp.example.com'],
      ['a trailing dot-space', 'smtp.example.com '],
      ['empty', ''],
    ])('rejects %s', (_label, host) => {
      expect(isValidHostSecure(host)).toBe(false);
    });

    // An all-numeric dotted string satisfies the hostname grammar — DNS labels
    // may be digits — so it is accepted even though it is not a valid IPv4
    // address. This is the validator behaving correctly, and it means the check
    // is a syntax gate, not a reachability or address-range check.
    it('accepts an all-numeric host that is not a valid IPv4 address', () => {
      expect(isValidHostSecure('999.1.1.1')).toBe(true);
    });

    // The implementation is `hostnameRegex.test(h) || ipRegex.test(h)`, and the
    // second operand is unreachable: ipRegex only ever matches digits and dots,
    // and every digit-only label is already a legal hostname label, so
    // hostnameRegex short-circuits first for every address ipRegex would accept.
    // Mutation testing surfaced this — 34 mutants inside the IPv4 pattern have
    // no input that can distinguish them. The assertion below is the observable
    // consequence: octet ranges are not enforced, so do not read this function
    // as validating an IP address.
    it('does not enforce IPv4 octet ranges, because the IP branch is unreachable', () => {
      expect(isValidHostSecure('192.168.1.10')).toBe(true);
      expect(isValidHostSecure('256.256.256.256')).toBe(true);
    });
  });

  describe('isValidUsernameSecure', () => {
    it.each(['chief', 'fire_chief', 'chief-01', 'a'.repeat(32)])('accepts %s', (name) => {
      expect(isValidUsernameSecure(name)).toBe(true);
    });

    it.each([
      ['under 3 characters', 'ab'],
      ['over 32 characters', 'a'.repeat(33)],
      ['a space', 'fire chief'],
      ['a dot', 'fire.chief'],
      ['an at sign', 'chief@example.com'],
      ['empty', ''],
    ])('rejects a username with %s', (_label, name) => {
      expect(isValidUsernameSecure(name)).toBe(false);
    });

    it('accepts exactly 3 characters, the documented lower bound', () => {
      expect(isValidUsernameSecure('abc')).toBe(true);
    });
  });

  describe('isValidPhone', () => {
    it.each(['+1 703 555 0100', '(703) 555-0100', '703-555-0100', '7035550100'])('accepts %s', (phone) => {
      expect(isValidPhone(phone)).toBe(true);
    });

    it.each([
      ['letters', '703-555-CALL'],
      ['empty', ''],
    ])('rejects a number with %s', (_label, phone) => {
      expect(isValidPhone(phone)).toBe(false);
    });
  });
});
