/**
 * Membership Module
 *
 * This module manages organization membership — member profiles,
 * role assignments, member import, admin management, and the NFC ID cards
 * issued to members (plus the check-in station that reads them).
 *
 * To enable/disable this module, simply include or exclude the
 * getMembershipRoutes function call in your main App.tsx routing.
 */

// Export routes
export { getMembershipRoutes } from './routes';

// Export store
export { useMembershipStore } from './store/membershipStore';

// Member ID cards (NFC credentials)
export { MemberIdCardsPanel } from './components/MemberIdCardsPanel';
export { nfcCardService } from './services/nfcCardService';
export {
  NFC_ID_CARDS_INTEGRATION,
  NFC_CARD_STATUS_LABELS,
  generateCardCode,
  isIssuedCardCode,
  isPlausibleCardSerial,
  normalizeCardSerial,
} from './constants/idCards';
export type * from './types/idCard';

// Export types
export * from './types';
