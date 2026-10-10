/**
 * The Members administration hub's sections, kept apart from the page so the
 * command palette — part of the always-loaded shell — can offer each one
 * without pulling the hub into the main bundle.
 */

import { BadgeCheck, Settings, Upload, UserPlus, Users } from 'lucide-react';
import type { AdminHubCardTab } from '../components/admin/AdminHubCardTabs';

export type MembersAdminTab = 'manage' | 'add' | 'import' | 'qualifications' | 'settings';

/**
 * Settings is always last — the frame's rule, on every module. Adding and
 * importing are their own permission: members.manage lets an officer edit the
 * roster, users.create is what puts a new person on it.
 *
 * users.create, not members.create, despite the latter's name _(2026-09-06)_.
 * Both tabs submit through `userService.createMember`, which posts to
 * `POST /users`, and that endpoint requires `users.create`. `members.create`
 * reads like the right grant and is not: nothing that creates a member
 * enforces it — it gates the prospect pipeline (`POST /prospects` and
 * `/prospects/check-existing`), and its registry description said "Create new
 * members", which is what led these tabs to it. The two grants are held by the
 * same seeded positions, so this corrects the name rather than anyone's access.
 */
export const MEMBERS_ADMIN_TABS: (AdminHubCardTab<MembersAdminTab> & { permission?: string })[] = [
  {
    id: 'manage',
    label: 'Member Management',
    description: 'Edit members, assign roles and reset passwords',
    icon: Users,
  },
  {
    id: 'add',
    label: 'Add Member',
    description: 'Put one new person on the roster',
    icon: UserPlus,
    permission: 'users.create',
  },
  {
    id: 'import',
    label: 'Import Members',
    description: 'Add many members at once from a CSV file',
    icon: Upload,
    permission: 'users.create',
  },
  // members.manage, which reaching this hub already requires: the endpoint
  // writes qualifications onto existing members, it creates nobody.
  {
    id: 'qualifications',
    label: 'Import Qualifications',
    description: 'Licences and cards members already hold, from a CSV file',
    icon: BadgeCheck,
  },
  { id: 'settings', label: 'Settings', description: 'Roster settings and headline metrics', icon: Settings },
];
