/**
 * Who may open a member's digital ID card.
 *
 * The card is a credential, not directory information: its QR code and
 * barcode are what a scanner accepts as "this member is here", so a colleague
 * who can pull it up on their phone can present it as someone else. Everyone
 * may open their own card. Another member's card is limited to the officers
 * who manage member records or issue ID credentials.
 *
 * Members who only need to *scan* a card — quartermasters, check-in station
 * operators — do not appear here on purpose: `/members/scan` and the check-in
 * station resolve a scanned code to a member without ever rendering the badge.
 *
 * `members.view` is deliberately absent: every default position carries it,
 * which is what made every member able to open every other member's card.
 */
export const VIEW_OTHER_MEMBER_ID_CARD_PERMISSIONS = ['members.manage', 'members.manage_id_cards'] as const;

export const canViewMemberIdCard = (
  viewerId: string | undefined,
  memberId: string | undefined,
  checkPermission: (permission: string) => boolean
): boolean => {
  if (!viewerId || !memberId) return false;
  if (viewerId === memberId) return true;
  return VIEW_OTHER_MEMBER_ID_CARD_PERMISSIONS.some((permission) => checkPermission(permission));
};
