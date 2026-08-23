import { describe, it, expect } from 'vitest';
import {
  normalizeCardSerial,
  isPlausibleCardSerial,
  NFC_CARD_STATUS_LABELS,
  checkInResultTone,
  generateCardCode,
  isIssuedCardCode,
  CARD_CODE_PREFIX,
} from './idCards';
import { NfcCardStatus, NfcCheckInStatus } from '../../../constants/enums';

describe('normalizeCardSerial', () => {
  it('reduces every reader spelling of one card to the same string', () => {
    // Web NFC hands back a lowercase colon-separated serial; USB readers type
    // it bare; some emit dashes. A card registered on a phone has to be
    // recognised at the desk reader, or the member reports it "stopped working".
    expect(normalizeCardSerial('04:a2:24:5b')).toBe('04A2245B');
    expect(normalizeCardSerial('04-A2-24-5B')).toBe('04A2245B');
    expect(normalizeCardSerial(' 04 a2 24 5b ')).toBe('04A2245B');
  });

  it('drops punctuation a reader or a person might introduce', () => {
    expect(normalizeCardSerial('04.a2/24_5b')).toBe('04A2245B');
  });

  it('returns an empty string for a value with nothing alphanumeric in it', () => {
    expect(normalizeCardSerial('::::')).toBe('');
  });
});

describe('isPlausibleCardSerial', () => {
  it('accepts a real 7-byte UID', () => {
    expect(isPlausibleCardSerial('04:a2:24:5b:7c:11:80')).toBe(true);
  });

  it('rejects a value that is only separators', () => {
    // Otherwise every such "card" normalizes to '' and hashes alike, so the
    // first one registered would answer for all of them.
    expect(isPlausibleCardSerial('::::')).toBe(false);
  });

  it('rejects a stray keystroke', () => {
    expect(isPlausibleCardSerial('4')).toBe(false);
  });
});

describe('NFC_CARD_STATUS_LABELS', () => {
  it('names every card status', () => {
    for (const status of Object.values(NfcCardStatus)) {
      expect(NFC_CARD_STATUS_LABELS[status]).toBeTypeOf('string');
      expect(NFC_CARD_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});

describe('checkInResultTone', () => {
  it('treats a recorded check-in or check-out as success', () => {
    expect(checkInResultTone(NfcCheckInStatus.CHECKED_IN)).toBe('success');
    expect(checkInResultTone(NfcCheckInStatus.CHECKED_OUT)).toBe('success');
  });

  it('does not paint "already checked in" as an error', () => {
    // The member is where the board says they are; a red screen would send
    // them looking for an officer over nothing.
    expect(checkInResultTone(NfcCheckInStatus.ALREADY_CHECKED_IN)).toBe('info');
    expect(checkInResultTone(NfcCheckInStatus.ALREADY_CHECKED_OUT)).toBe('info');
  });

  it('flags an unusable card', () => {
    expect(checkInResultTone(NfcCheckInStatus.UNKNOWN_CARD)).toBe('error');
    expect(checkInResultTone(NfcCheckInStatus.CARD_INACTIVE)).toBe('error');
    expect(checkInResultTone(NfcCheckInStatus.MEMBER_INACTIVE)).toBe('error');
    expect(checkInResultTone(NfcCheckInStatus.REFUSED)).toBe('error');
  });
});

describe('generateCardCode', () => {
  it('mints an unguessable code, not a counter', () => {
    // The code *is* the credential and, unlike a chip serial, it is not
    // printed anywhere — so it has to be unguessable, not merely unique.
    const codes = new Set(Array.from({ length: 200 }, () => generateCardCode()));
    expect(codes.size).toBe(200);
  });

  it('produces 128 bits after the prefix', () => {
    const code = generateCardCode();
    expect(code.startsWith(CARD_CODE_PREFIX)).toBe(true);
    expect(code.slice(CARD_CODE_PREFIX.length)).toMatch(/^[0-9A-F]{32}$/);
  });

  it('survives the same normalization the reader output goes through', () => {
    // A code written to a tag comes back through normalizeCardSerial on the
    // way in; if that changed it, the card would never match what was stored.
    const code = generateCardCode();
    expect(normalizeCardSerial(code)).toBe(code);
  });
});

describe('isIssuedCardCode', () => {
  it('recognises a code this system minted', () => {
    expect(isIssuedCardCode(generateCardCode())).toBe(true);
  });

  it('does not claim a stranger\u2019s tag', () => {
    // A transit card or hotel key read at the door carries text of its own;
    // forwarding it would put arbitrary strings through a credential lookup.
    expect(isIssuedCardCode('https://example.com/promo')).toBe(false);
    expect(isIssuedCardCode('04A2245B7C1180')).toBe(false);
  });

  it('handles an absent payload', () => {
    expect(isIssuedCardCode(null)).toBe(false);
    expect(isIssuedCardCode(undefined)).toBe(false);
    expect(isIssuedCardCode('')).toBe(false);
  });
});
