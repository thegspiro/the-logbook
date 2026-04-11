/**
 * Membership Module Types
 *
 * Re-exports types from the shared types directory and adds
 * module-specific types for the membership Zustand store.
 */

// Re-export existing member types
export type {
  Member,
  MemberFormData,
  CSVMemberRow,
  MemberStats,
  EmergencyContact,
  Address,
  ContactInfo,
  Certification,
} from '../../../types/member';

import type { User, ContactInfoSettings, NotificationPreferences, ContactInfoUpdate } from '../../../types/user';
export type { User, ContactInfoSettings, NotificationPreferences, ContactInfoUpdate };

export type UserWithRoles = User & {
  roles?: { id: string; name: string }[] | undefined;
};
