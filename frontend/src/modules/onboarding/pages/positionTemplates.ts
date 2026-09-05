/**
 * Default position templates offered by the role-setup wizard, and the
 * permission generator that fills them in per module.
 *
 * Split out of RoleSetup.tsx (2026-09-01, PR #2128 round 3, Codex review):
 * ESLint's `react-refresh/only-export-components` flags a file that exports
 * both a component and a non-component value, because Fast Refresh can only
 * hot-reload a module whose exports are all components — an export like
 * `buildPositionTemplates` forces a full reload of the page on every save
 * while working on RoleSetup.tsx. Neither function here has any UI/hook
 * dependency on RoleSetup.tsx (pure data, keyed by icon *references* rather
 * than JSX), so this is a plain `.ts` module with no behavior change —
 * `RoleSetup.tsx` imports `buildPositionTemplates` from here instead of
 * defining it locally.
 */
import {
  Users,
  Shield,
  Crown,
  Star,
  Briefcase,
  GraduationCap,
  ClipboardList,
  Wrench,
  Truck,
  Monitor,
  UserPlus,
  BadgeCheck,
  Megaphone,
  Building2,
  Flame,
  HeartPulse,
} from 'lucide-react';
import type { OrganizationType } from '../store';
import { SEEDED_POSITION_GRANTS, applyAgencyVocabulary, type ModuleDefinition } from '../config';

/**
 * Generate permissions for a specific role type.
 * This ensures new modules get sensible defaults for each role.
 */
const generateRolePermissions = (
  modules: ModuleDefinition[],
  roleType: 'full_access' | 'leadership' | 'officer' | 'specialist' | 'member' | 'probationary',
  specialties?: string[]
): Record<string, { view: boolean; manage: boolean }> => {
  const permissions: Record<string, { view: boolean; manage: boolean }> = {};

  modules.forEach((module) => {
    switch (roleType) {
      case 'full_access':
        // Full access to everything
        permissions[module.id] = { view: true, manage: true };
        break;
      case 'leadership':
        // Leaders can manage most things except sensitive system modules
        permissions[module.id] = {
          view: true,
          manage: module.id !== 'settings',
        };
        break;
      case 'officer':
        // Officers can view everything, manage their area
        permissions[module.id] = {
          view: true,
          manage: specialties?.includes(module.id) || false,
        };
        break;
      case 'specialist':
        // Specialists have narrow focus
        permissions[module.id] = {
          view: true,
          manage: specialties?.includes(module.id) || false,
        };
        break;
      case 'member':
        // Standard members can view most things
        permissions[module.id] = {
          view: module.category !== 'System',
          manage: false,
        };
        break;
      case 'probationary':
        // Limited view access
        permissions[module.id] = {
          view: ['members', 'events', 'documents', 'training', 'scheduling'].includes(module.id),
          manage: false,
        };
        break;
    }
  });

  return permissions;
};

/**
 * Build position templates dynamically using the module registry.
 * This ensures new modules are included in position permissions automatically.
 *
 * `organizationType` narrows the operational ranks to the ones this kind of
 * agency has, and renames the two that are fire-specific. Everything else is
 * administrative or universal and is offered to everyone.
 */
/**
 * The checkboxes a seeded position starts with, taken from what the backend
 * actually seeds it with rather than from its role type.
 *
 * The role-type heuristics above answer "what does a member/officer/leader
 * broadly get", which is not the same question as "what did
 * `DEFAULT_POSITIONS` put in this row". They disagreed on every seeded
 * position: the member template ticked View for every non-System module, so
 * the first Continue wrote `facilities.view` and `notifications.view` back
 * onto a `member` row the registry (and two migrations) had just had them
 * removed from, and the board template ticked Manage on eighteen modules the
 * board is not seeded with. The editor saves what its boxes say, so a wrong
 * default is a real grant on every fresh install.
 *
 * A position with no seeded row keeps its heuristic defaults — there is
 * nothing to disagree with, and saving it creates the position.
 */
const applySeededGrants = <T extends { id: string; permissions: Record<string, { view: boolean; manage: boolean }> }>(
  positions: T[],
  modules: ModuleDefinition[]
): T[] =>
  positions.map((position) => {
    const seeded = SEEDED_POSITION_GRANTS[position.id];
    if (!seeded) return position;
    const view = new Set(seeded.view);
    const manage = new Set(seeded.manage);
    return {
      ...position,
      permissions: Object.fromEntries(
        modules.map((module) => [module.id, { view: view.has(module.id), manage: manage.has(module.id) }])
      ),
    };
  });

export const buildPositionTemplates = (
  modules: ModuleDefinition[],
  organizationType: OrganizationType = 'fire_department'
) => {
  const templates = buildAllPositionTemplates(modules);
  return Object.fromEntries(
    Object.entries(templates).map(([key, category]) => [
      key,
      {
        ...category,
        positions: applySeededGrants(applyAgencyVocabulary(category.positions, organizationType), modules),
      },
    ])
  ) as typeof templates;
};

const buildAllPositionTemplates = (modules: ModuleDefinition[]) => ({
  system: {
    name: 'System / Special',
    description: 'System administration and IT management positions',
    positions: [
      {
        id: 'it_manager',
        name: 'IT Manager',
        description: 'Full system access - manages integrations, settings, and technical administration',
        icon: Monitor,
        priority: 100,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
    ],
  },
  operational_ranks: {
    name: 'Operational Ranks',
    description: 'Fire/EMS command and line positions',
    positions: [
      {
        id: 'fire_chief',
        name: 'Fire Chief',
        description: 'Highest-ranking officer with full operational and administrative authority',
        icon: Flame,
        priority: 95,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
      {
        id: 'deputy_chief',
        name: 'Deputy Chief',
        description: "Second in command, oversees operations in the Chief's absence",
        icon: Flame,
        priority: 90,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
      {
        id: 'assistant_chief',
        name: 'Assistant Chief',
        description: 'Assists the Chief and Deputy Chief with operational oversight',
        icon: Flame,
        priority: 85,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
      {
        id: 'captain',
        name: 'Captain',
        description: 'Company officer responsible for crew management and operations',
        icon: Star,
        priority: 70,
        permissions: generateRolePermissions(modules, 'officer', [
          'members',
          'training',
          'scheduling',
          'events',
          'apparatus',
        ]),
      },
      {
        id: 'lieutenant',
        name: 'Lieutenant',
        description: 'Company officer assisting the Captain with crew supervision',
        icon: Star,
        priority: 60,
        permissions: generateRolePermissions(modules, 'officer', ['training', 'scheduling', 'events', 'apparatus']),
      },
      {
        id: 'engineer',
        name: 'Engineer / Driver Operator',
        description: 'Apparatus operator responsible for vehicle operations and maintenance',
        icon: Wrench,
        priority: 40,
        permissions: generateRolePermissions(modules, 'specialist', ['apparatus']),
      },
      {
        id: 'firefighter',
        name: 'Firefighter',
        description: 'Line firefighter with standard operational access',
        icon: Shield,
        priority: 15,
        permissions: generateRolePermissions(modules, 'member'),
      },
      {
        id: 'emt',
        name: 'EMT',
        description: 'Emergency Medical Technician providing patient care on EMS calls',
        icon: HeartPulse,
        // Matches DEFAULT_POSITIONS['emt']. save_session_roles writes this
        // value over the seeded one, so a mismatch would make the stored
        // ordering depend on whether the box was ticked — and 10 would tie EMT
        // with the baseline Member position. Engineer and Firefighter are
        // aligned the same way.
        priority: 12,
        permissions: generateRolePermissions(modules, 'member'),
      },
    ],
  },
  leadership: {
    name: 'Leadership',
    description: 'Executive leadership positions',
    positions: [
      {
        id: 'president',
        name: 'President',
        description: 'Top executive leader of the organization',
        icon: Crown,
        priority: 95,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
      {
        id: 'vice_president',
        name: 'Vice President',
        description: 'Second in command, supports the President',
        icon: Star,
        priority: 80,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
      {
        id: 'board_of_directors',
        name: 'Board of Directors',
        description: 'Governing board with oversight of organizational operations',
        icon: Building2,
        priority: 85,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
    ],
  },
  officers: {
    name: 'Officers',
    description: 'Elected or appointed officers with specific duties',
    positions: [
      {
        id: 'secretary',
        name: 'Secretary',
        description: 'Records, communications, and elections',
        icon: Briefcase,
        priority: 75,
        permissions: generateRolePermissions(modules, 'officer', [
          'members',
          'events',
          'documents',
          'elections',
          'minutes',
          'reports',
          'prospective_members',
        ]),
      },
      {
        id: 'assistant_secretary',
        name: 'Assistant Secretary',
        description: 'Assists the secretary with records and communications',
        icon: Briefcase,
        priority: 70,
        permissions: generateRolePermissions(modules, 'officer', ['members', 'events', 'documents', 'minutes']),
      },
      {
        id: 'treasurer',
        name: 'Treasurer',
        description: 'Financial oversight and reporting',
        icon: Briefcase,
        priority: 75,
        permissions: generateRolePermissions(modules, 'officer', ['documents', 'reports']),
      },
      {
        id: 'training_officer',
        name: 'Training Officer',
        description: 'Manages training programs and certifications',
        icon: GraduationCap,
        priority: 65,
        permissions: generateRolePermissions(modules, 'specialist', ['training', 'events', 'documents']),
      },
      {
        id: 'safety_officer',
        name: 'Safety Officer',
        description: 'Safety compliance and oversight',
        icon: Shield,
        priority: 65,
        permissions: generateRolePermissions(modules, 'specialist', [
          'training',
          'events',
          'documents',
          'inventory',
          'reports',
          'forms',
        ]),
      },
      {
        id: 'communications_officer',
        name: 'Communications Officer / PIO',
        description: 'Public information, website, social media, newsletters, and notification management',
        icon: Megaphone,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['notifications', 'mobile', 'events', 'documents']),
      },
    ],
  },
  support: {
    name: 'Support Positions',
    description: 'Specialized support and operational positions',
    positions: [
      {
        id: 'quartermaster',
        name: 'Quartermaster',
        description: 'Equipment and inventory management',
        icon: Wrench,
        priority: 85,
        permissions: generateRolePermissions(modules, 'specialist', ['inventory', 'storefront']),
      },
      {
        id: 'scheduling_officer',
        name: 'Scheduling Officer',
        description: 'Manages duty rosters and shift scheduling',
        icon: ClipboardList,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['scheduling']),
      },
      {
        id: 'public_outreach',
        name: 'Public Outreach',
        description: 'Community events and public education',
        icon: Users,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['events', 'documents']),
      },
      {
        id: 'historian',
        name: 'Historian',
        description: 'Maintains organizational history, archives, and records',
        icon: ClipboardList,
        priority: 45,
        permissions: generateRolePermissions(modules, 'specialist', ['documents', 'events']),
      },
      {
        id: 'apparatus_officer',
        name: 'Apparatus Officer',
        description: 'Day-to-day fleet tracking, maintenance logging, and equipment checks',
        icon: Truck,
        priority: 50,
        permissions: generateRolePermissions(modules, 'specialist', ['apparatus', 'inventory', 'storefront']),
      },
      {
        id: 'membership_coordinator',
        name: 'Membership Coordinator',
        description: 'Manages member records, applications, and onboarding/offboarding',
        icon: UserPlus,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['members', 'prospective_members']),
      },
      {
        id: 'fundraising_chair',
        name: 'Fundraising Chair',
        description: 'Coordinates fundraising activities and campaigns',
        icon: BadgeCheck,
        priority: 50,
        permissions: generateRolePermissions(modules, 'specialist', ['events', 'documents', 'reports']),
      },
      {
        id: 'meeting_hall_coordinator',
        name: 'Meeting Hall Coordinator',
        description: 'Manages meeting hall and location bookings',
        icon: ClipboardList,
        priority: 60,
        permissions: generateRolePermissions(modules, 'specialist', ['events', 'scheduling']),
      },
      {
        id: 'facilities_manager',
        name: 'Facilities Manager',
        description: 'Day-to-day building management, maintenance logging, and inspections',
        icon: Building2,
        priority: 50,
        permissions: generateRolePermissions(modules, 'specialist', ['inventory', 'facilities', 'storefront']),
      },
    ],
  },
  // One entry, deliberately. This category used to offer Probationary,
  // Junior, Life, Administrative, Social and Exempt "positions" too — but
  // those are a member's *class* and *status*, not a job they hold, and
  // creating them here wrote a permission-bearing position for each. That
  // contradicted the taxonomy the User model documents ("membership types
  // carry no permissions") and left a member's standing recorded in two
  // unconnected places: `member_class`/`member_status` on the member, and a
  // held position nothing on the backend reads.
  //
  // Standing is set on the member record now. "Regular Member" stays, because
  // it is the genuine baseline position every member holds — it is in the
  // backend's DEFAULT_POSITIONS and carries the day-one grant set.
  members: {
    name: 'Member Positions',
    description: 'The baseline access every member holds',
    positions: [
      {
        id: 'member',
        name: 'Regular Member',
        description: 'Regular department member',
        icon: Users,
        priority: 10,
        permissions: generateRolePermissions(modules, 'member'),
      },
    ],
  },
});
