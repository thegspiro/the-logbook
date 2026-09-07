/**
 * Section definitions for the Members settings screen.
 *
 * Each section is its own route under the Members Administration hub rather than
 * a `?tab=` on one page, for the reason scheduling's are: a settings screen an
 * officer is sent to — from a hub card, from another module, from their own
 * bookmarks — has to be addressable, and a query parameter only a client-side
 * `useState` reads is not. `path` is the single place those URLs are written
 * down, so the routes, the hub cards and the nav cannot drift into three
 * spellings.
 *
 * **`permission` is per section, and is the endpoint's, not the hub's.** Every
 * route under `/members/admin` stands on `members.manage`, but neither of these
 * sections saves through an endpoint that accepts it: contact visibility wants
 * `settings.manage`, `settings.manage_contact_visibility` or
 * `organization.update_settings`, and membership IDs want `settings.edit` or
 * `organization.update_settings`. Gating these on the hub's grant would put a
 * members officer on a page where every toggle 403s — which is exactly the
 * defect that took six review rounds on the scheduling close-out queue, and it
 * is cheaper to encode the endpoint's own answer here than to rediscover it.
 */

import { Eye, Hash } from 'lucide-react';
import type { SettingsSection } from '../../../../components/settings/SettingsLayout';

export type MembersSettingsTab = 'visibility' | 'ids';

export interface MembersSettingsSection extends SettingsSection<MembersSettingsTab> {
  /** The route this section is reached at. */
  path: string;
  /**
   * Any one of these admits an officer to the section.
   *
   * Mirrors the `require_permission(...)` on the endpoint the section writes
   * through. Read the endpoint before changing one of these.
   */
  permissions: string[];
}

export const MEMBERS_SETTINGS_SECTIONS: MembersSettingsSection[] = [
  {
    key: 'visibility',
    label: 'Contact Visibility',
    icon: Eye,
    description: 'What members see of each other',
    path: '/members/admin/settings/visibility',
    // PATCH /organization/settings/contact-info
    permissions: ['settings.manage', 'settings.manage_contact_visibility', 'organization.update_settings'],
  },
  {
    key: 'ids',
    label: 'Membership IDs',
    icon: Hash,
    description: 'Numbering and prefixes',
    path: '/members/admin/settings/ids',
    // PATCH /organization/settings/membership-id
    permissions: ['settings.edit', 'organization.update_settings'],
  },
];

/** The first section's path, and the fallback for an unknown tab. */
const DEFAULT_SECTION_PATH = '/members/admin/settings/visibility';

export const membersSettingsPathFor = (tab: MembersSettingsTab): string =>
  MEMBERS_SETTINGS_SECTIONS.find((section) => section.key === tab)?.path ?? DEFAULT_SECTION_PATH;
