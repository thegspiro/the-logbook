/**
 * Member ID card (NFC) credential types.
 *
 * A card is the inverse of the destination tags described in
 * `constants/nfc.ts`: those send a phone to a check-in page, these identify
 * the person holding them so a station can check them in.
 *
 * The card's credential — its serial, or the code written onto it — never
 * appears here. It is stored hashed on the backend and only ever travels *to*
 * the API, on registration and on a tap; `uidPreview` (its last four
 * characters) is all a screen gets back.
 */

import type {
  NfcCardStatus,
  NfcCheckInDirection,
  NfcCheckInStatus,
  NfcCheckInTarget,
  NfcCredentialType,
} from '../../../constants/enums';

export interface NfcCard {
  id: string;
  organizationId: string;
  userId: string;
  /** Last four characters of the credential, for telling two cards apart. */
  uidPreview: string;
  credentialType: NfcCredentialType;
  label?: string | null;
  status: NfcCardStatus;
  issuedAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  revokedReason?: string | null;
  issuedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  memberName?: string | null;
  issuedByName?: string | null;
}

export interface NfcCardListResponse {
  items: NfcCard[];
  total: number;
}

/**
 * Request payloads are snake_case, responses are camelCase.
 *
 * That is the shape of every endpoint in this codebase, not an inconsistency
 * to tidy: response schemas carry `alias_generator=to_camel`, request schemas
 * do not, so a camelCase key on the way *in* is silently dropped by Pydantic
 * and comes back as a 422 for the missing snake_case field it was meant to be.
 */
export interface NfcCardCreatePayload {
  user_id: string;
  tag_uid: string;
  credential_type: NfcCredentialType;
  label?: string | undefined;
}

export interface NfcCardUpdatePayload {
  label?: string | null;
  status?: NfcCardStatus;
  revoked_reason?: string | null;
}

export interface NfcStationCheckInPayload {
  tag_uid: string;
  /**
   * Any text written on the tag, when the reader produced some.
   *
   * Sent alongside the serial rather than instead of it: a blank tag an
   * officer wrote a code onto can be rewritten and reused, so the chip serial
   * underneath may still be registered to whoever held it before. The server
   * tries the written code first.
   */
  tag_payload?: string | undefined;
  target_type: NfcCheckInTarget;
  target_id: string;
  direction?: NfcCheckInDirection;
}

export interface NfcStationCheckInResult {
  status: NfcCheckInStatus;
  message: string;
  targetName?: string | null;
  userId?: string | null;
  memberName?: string | null;
  membershipNumber?: string | null;
  occurredAt?: string | null;
  durationMinutes?: number | null;
}
