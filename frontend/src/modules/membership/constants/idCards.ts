/**
 * Member ID card (NFC credential) helpers.
 *
 * Kept apart from `constants/nfc.ts`, which is about *destination* tags — the
 * ones stuck to a door that send a phone to a check-in page. This file is
 * about cards that identify a person.
 */

import { NfcCardStatus, NfcCheckInStatus } from '../../../constants/enums';

/**
 * Reduce a reader's serial to one canonical form.
 *
 * The same card reads back differently depending on what read it: Web NFC
 * returns `04:a2:24:5b` lowercase with colons, most USB readers type
 * `04A2245B` bare, and some emit dashes. The backend normalizes identically
 * before hashing — doing it here too means the field shows the operator the
 * same string that will be stored, so a card registered on a phone and one
 * read at the desk are visibly the same card.
 */
export function normalizeCardSerial(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/**
 * Whether a serial is long enough to plausibly be a card.
 *
 * ISO 14443 UIDs are 4, 7 or 10 bytes — 8 to 20 hex characters. The floor is
 * set below that rather than at it: some readers strip a leading vendor byte,
 * and a too-strict check here would reject a real card with no way to override
 * it. The backend applies the same floor.
 */
export function isPlausibleCardSerial(serial: string): boolean {
  return normalizeCardSerial(serial).length >= 4;
}

/** Human label for a card's lifecycle state. */
export const NFC_CARD_STATUS_LABELS: Record<NfcCardStatus, string> = {
  [NfcCardStatus.ACTIVE]: 'Active',
  [NfcCardStatus.SUSPENDED]: 'Suspended',
  [NfcCardStatus.LOST]: 'Lost',
  [NfcCardStatus.REVOKED]: 'Revoked',
};

/**
 * How a station result should be coloured.
 *
 * `already_checked_in` is deliberately not an error: the member is where the
 * board says they are, and a red screen would send them looking for an officer
 * over nothing.
 */
export function checkInResultTone(status: NfcCheckInStatus): 'success' | 'info' | 'error' {
  switch (status) {
    case NfcCheckInStatus.CHECKED_IN:
    case NfcCheckInStatus.CHECKED_OUT:
      return 'success';
    case NfcCheckInStatus.ALREADY_CHECKED_IN:
    case NfcCheckInStatus.ALREADY_CHECKED_OUT:
      return 'info';
    default:
      return 'error';
  }
}

/**
 * Marks a value as an ID card code this system issued.
 *
 * Present so a station can tell a card we wrote from whatever else a member
 * might be carrying — a transit card, a hotel key — instead of sending every
 * stray tag's payload to the server to be looked up.
 */
export const CARD_CODE_PREFIX = 'LBC1';

/**
 * The organization-level switch that makes ID cards exist at all.
 *
 * Matches `NFC_INTEGRATION_TYPE` in `app/utils/nfc_integration.py`. The server
 * refuses every card route while this is off; the UI reads it only so a
 * department that does not use cards is not shown a section for them.
 */
export const NFC_ID_CARDS_INTEGRATION = 'nfc-id-cards';

/**
 * Mint a code to write onto a blank tag.
 *
 * Used when the card is a writable sticker or fob rather than a printed ID
 * card with a factory serial. 128 bits from the platform CSPRNG: the code *is*
 * the credential, and unlike a chip serial it is not printed anywhere, so it
 * has to be unguessable rather than merely unique.
 */
export function generateCardCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${CARD_CODE_PREFIX}${hex.toUpperCase()}`;
}

/** True when a value read off a tag looks like a code this system issued. */
export function isIssuedCardCode(value: string | null | undefined): boolean {
  if (!value) return false;
  return normalizeCardSerial(value).startsWith(CARD_CODE_PREFIX);
}
