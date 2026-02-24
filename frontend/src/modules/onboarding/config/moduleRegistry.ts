/**
 * Central Module Registry
 *
 * This is the single source of truth for all application modules.
 * When adding a new module, add it here and it will automatically
 * appear in ModuleOverview, ModuleConfigTemplate, and PositionSetup pages.
 */

import {
  Users,
  Calendar,
  FileText,
  GraduationCap,
  Package,
  Clock,
  Vote,
  ClipboardList,
  BarChart3,
  Bell,
  Smartphone,
  FormInput,
  Plug,
  Shield,
  UserCog,
  Truck,
  UserPlus,
  Building2,
  type LucideIcon,
} from 'lucide-react';

export interface ModulePermissions {
  view: string[];
  manage: string[];
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  priority: 'essential' | 'recommended' | 'optional';
  category: string;
  configRoute?: string;
  // Permission details for the two-tier model
  permissions: {
    viewDescription: string;
    manageDescription: string;
    view: string[];
    manage: string[];
    defaultManagePositions: string[];
    /** @deprecated Use defaultManagePositions */
    defaultManageRoles?: string[];
  };
}

/**
 * All available modules in the application.
 * Add new modules here to have them appear throughout the onboarding process.
 */
export const MODULE_REGISTRY: ModuleDefinition[] = [
  // ============================================
  // ESSENTIAL MODULES (Core functionality)
  // ============================================
  {
    id: 'members',
    name: 'Member Management',
    description:
      'Manage your department roster, positions, contact information, and member profiles. Core functionality for any organization.',
    icon: Users,
    priority: 'essential',
    category: 'Core',
    configRoute: '/onboarding/modules/members/config',
    permissions: {
      viewDescription: 'View member directory, contact information, and profiles',
      manageDescription: 'Add/edit members, assign positions, update member status',
      view: ['View member directory', 'See contact information', 'View member profiles'],
      manage: ['Add new members', 'Edit member information', 'Assign positions', 'Manage member status'],
      defaultManagePositions: ['it_manager', 'fire_chief', 'president', 'membership_committee_chair', 'training_officer', 'captain', 'secretary', 'assistant_secretary'],
    },
  },
  {
    id: 'events',
    name: 'Events & RSVP',
    description:
      'Create events, track RSVPs, manage attendance, and send event notifications. Perfect for meetings, trainings, and social gatherings.',
    icon: Calendar,
    priority: 'essential',
    category: 'Core',
    configRoute: '/onboarding/modules/events/config',
    permissions: {
      viewDescription: 'View upcoming events, RSVP, and check attendance',
      manageDescription: 'Create events, manage RSVPs, record attendance',
      view: ['View all events', 'RSVP to events', "See who's attending", 'Check in to events'],
      manage: ['Create new events', 'Edit/cancel events', 'Manage RSVPs', 'Override attendance'],
      defaultManagePositions: ['it_manager', 'fire_chief', 'president', 'secretary', 'training_officer', 'meeting_hall_coordinator', 'public_outreach', 'scheduling_officer', 'facilities_manager'],
    },
  },
  {
    id: 'documents',
    name: 'Documents & Files',
    description:
      'Centralized document storage for SOPs, policies, forms, and department files. Used across training, compliance, and other modules.',
    icon: FileText,
    priority: 'essential',
    category: 'Core',
    configRoute: '/onboarding/modules/documents/config',
    permissions: {
      viewDescription: 'Browse and download department documents and files',
      manageDescription: 'Upload documents, manage folders, set visibility',
      view: ['Browse documents', 'Download files', 'View document history'],
      manage: ['Upload documents', 'Create folders', 'Edit/delete files', 'Set document visibility'],
      defaultManagePositions: ['it_manager', 'secretary'],
    },
  },
  {
    id: 'forms',
    name: 'Custom Forms',
    description:
      'Cross-module form builder for shift checkouts, equipment inspections, training updates, surveys, and more. Powers structured data collection across all modules.',
    icon: FormInput,
    priority: 'essential',
    category: 'Core',
    configRoute: '/onboarding/modules/forms/config',
    permissions: {
      viewDescription: 'Fill out and submit forms across all modules',
      manageDescription: 'Create forms, design fields, view submissions, export data',
      view: ['View available forms', 'Submit forms', 'See personal submissions'],
      manage: ['Create form templates', 'Design form fields', 'View all submissions', 'Export responses', 'Manage form settings'],
      defaultManagePositions: ['it_manager', 'secretary'],
    },
  },

  // ============================================
  // RECOMMENDED MODULES (Operations)
  // ============================================
  {
    id: 'training',
    name: 'Training & Certifications',
    description:
      'Track required certifications, training completions, and expiration dates. Ensure compliance and readiness.',
    icon: GraduationCap,
    priority: 'recommended',
    category: 'Operations',
    configRoute: '/onboarding/modules/training/config',
    permissions: {
      viewDescription: 'View training records, upcoming courses, and certifications',
      manageDescription: 'Create courses, record completions, manage requirements',
      view: ['View personal training records', 'See available courses', 'Track certification status'],
      manage: ['Create training courses', 'Record completions', 'Set requirements', 'Approve certifications'],
      defaultManagePositions: ['it_manager', 'fire_chief', 'president', 'training_officer', 'safety_officer'],
    },
  },
  {
    id: 'inventory',
    name: 'Equipment & Inventory',
    description:
      'Manage equipment, track maintenance schedules, and monitor inventory levels. Keep your gear mission-ready.',
    icon: Package,
    priority: 'recommended',
    category: 'Operations',
    configRoute: '/onboarding/modules/inventory/config',
    permissions: {
      viewDescription: 'View equipment, check availability, request items',
      manageDescription: 'Add equipment, track maintenance, manage assignments',
      view: ['View equipment list', 'Check item status', 'Request equipment'],
      manage: ['Add/edit equipment', 'Assign items', 'Record maintenance', 'Manage inventory levels'],
      defaultManagePositions: ['it_manager', 'quartermaster', 'president', 'fire_chief'],
    },
  },
  {
    id: 'scheduling',
    name: 'Scheduling & Shifts',
    description:
      'Create shift schedules, manage duty rosters, and handle shift trades. Simplify workforce planning.',
    icon: Clock,
    priority: 'recommended',
    category: 'Operations',
    configRoute: '/onboarding/modules/scheduling/config',
    permissions: {
      viewDescription: 'View shift schedules, request swaps, see coverage',
      manageDescription: 'Create schedules, approve swaps, manage coverage',
      view: ['View shift schedules', 'See personal assignments', 'Request shift swaps'],
      manage: ['Create schedules', 'Assign shifts', 'Approve swap requests', 'Override assignments'],
      defaultManagePositions: ['it_manager', 'president', 'secretary', 'vice_president', 'training_officer', 'scheduling_officer', 'fire_chief'],
    },
  },

  {
    id: 'apparatus',
    name: 'Apparatus & Fleet',
    description:
      'Track vehicles and apparatus, schedule maintenance, log fuel usage, manage operator certifications, and monitor NFPA compliance.',
    icon: Truck,
    priority: 'recommended',
    category: 'Operations',
    configRoute: '/onboarding/modules/apparatus/config',
    permissions: {
      viewDescription: 'View fleet roster, apparatus details, and maintenance schedules',
      manageDescription: 'Add/edit apparatus, log maintenance, manage operators and equipment',
      view: ['View fleet roster', 'See apparatus details', 'Check maintenance schedules', 'View fuel logs'],
      manage: ['Add/edit apparatus', 'Log maintenance and fuel', 'Manage operators', 'Change apparatus status'],
      defaultManagePositions: ['it_manager', 'apparatus_officer'],
    },
  },

  {
    id: 'facilities',
    name: 'Facilities Management',
    description:
      'Manage buildings, schedule maintenance, log inspections, and track facility systems. Keep your stations mission-ready.',
    icon: Building2,
    priority: 'recommended',
    category: 'Operations',
    configRoute: '/onboarding/modules/facilities/config',
    permissions: {
      viewDescription: 'View facilities, buildings, and maintenance schedules',
      manageDescription: 'Add facilities, log maintenance, manage inspections and systems',
      view: ['View facility list', 'See building details', 'Check maintenance schedules'],
      manage: ['Add/edit facilities', 'Log maintenance', 'Manage inspections', 'Track facility systems'],
      defaultManagePositions: ['it_manager', 'facilities_manager'],
    },
  },

  // ============================================
  // RECOMMENDED MODULES (Governance)
  // ============================================
  {
    id: 'elections',
    name: 'Elections & Voting',
    description:
      'Run officer elections with secure voting, multiple voting methods, and automatic result tabulation.',
    icon: Vote,
    priority: 'recommended',
    category: 'Governance',
    configRoute: '/onboarding/modules/elections/config',
    permissions: {
      viewDescription: 'View elections, cast votes, see results when published',
      manageDescription: 'Create elections, manage candidates, certify results',
      view: ['View active elections', 'Cast votes (if eligible)', 'See published results'],
      manage: ['Create elections', 'Manage candidates', 'Configure voting rules', 'Certify results'],
      defaultManagePositions: ['it_manager', 'secretary', 'president'],
    },
  },
  {
    id: 'minutes',
    name: 'Meeting Minutes',
    description:
      'Record meeting minutes, track action items, and maintain organizational history. Stay compliant and organized.',
    icon: ClipboardList,
    priority: 'optional',
    category: 'Governance',
    configRoute: '/onboarding/modules/minutes/config',
    permissions: {
      viewDescription: 'Read meeting minutes and organizational history',
      manageDescription: 'Record minutes, publish drafts, manage archives',
      view: ['Read published minutes', 'Search meeting history', 'View action items'],
      manage: ['Record minutes', 'Edit drafts', 'Publish minutes', 'Manage archives'],
      defaultManagePositions: ['it_manager', 'secretary', 'assistant_secretary'],
    },
  },
  {
    id: 'reports',
    name: 'Reports & Analytics',
    description:
      'Generate custom reports, view analytics dashboards, and export data. Make data-driven decisions.',
    icon: BarChart3,
    priority: 'optional',
    category: 'Governance',
    configRoute: '/onboarding/modules/reports/config',
    permissions: {
      viewDescription: 'View dashboards and personal reports',
      manageDescription: 'Create custom reports, export data, configure analytics',
      view: ['View dashboards', 'See personal statistics', 'Access standard reports'],
      manage: ['Create custom reports', 'Export data', 'Configure analytics', 'Share reports'],
      defaultManagePositions: ['it_manager', 'safety_officer', 'training_officer', 'president', 'fire_chief'],
    },
  },

  // ============================================
  // OPTIONAL MODULES (Communication)
  // ============================================
  {
    id: 'notifications',
    name: 'Email Notifications',
    description:
      'Automated email notifications for events, reminders, and important updates. Keep everyone informed.',
    icon: Bell,
    priority: 'optional',
    category: 'Communication',
    configRoute: '/onboarding/modules/notifications/config',
    permissions: {
      viewDescription: 'Receive notifications and manage personal preferences',
      manageDescription: 'Configure notification templates and triggers',
      view: ['Receive notifications', 'Set personal preferences', 'View notification history'],
      manage: ['Configure templates', 'Set notification triggers', 'Manage global settings'],
      defaultManagePositions: ['it_manager', 'communications_officer'],
    },
  },
  {
    id: 'mobile',
    name: 'Mobile App Access',
    description:
      'Progressive web app for mobile access. Members can check in, view schedules, and stay connected on-the-go.',
    icon: Smartphone,
    priority: 'optional',
    category: 'Communication',
    configRoute: '/onboarding/modules/mobile/config',
    permissions: {
      viewDescription: 'Access the platform from mobile devices',
      manageDescription: 'Configure mobile-specific features and settings',
      view: ['Use mobile app', 'Receive push notifications', 'Access mobile features'],
      manage: ['Configure mobile settings', 'Manage push notifications', 'Set mobile policies'],
      defaultManagePositions: ['it_manager', 'communications_officer'],
    },
  },

  // ============================================
  // OPTIONAL MODULES (Advanced)
  // ============================================
  {
    id: 'integrations',
    name: 'External Integrations',
    description:
      'Connect with external tools like Google Calendar, Slack, and more. Extend platform capabilities.',
    icon: Plug,
    priority: 'optional',
    category: 'Advanced',
    configRoute: '/onboarding/modules/integrations/config',
    permissions: {
      viewDescription: 'Use integrated features (calendar sync, etc.)',
      manageDescription: 'Configure and manage external service connections',
      view: ['Use integrated features', 'Connect personal accounts'],
      manage: ['Configure integrations', 'Manage API connections', 'Set sync settings'],
      defaultManagePositions: ['it_manager'],
    },
  },

  // ============================================
  // OPTIONAL MODULES (Membership)
  // ============================================
  {
    id: 'prospective_members',
    name: 'Prospective Members Pipeline',
    description:
      'Manage the applicant-to-member pipeline with configurable stages, kanban/table views, and integration with forms, elections, and notifications.',
    icon: UserPlus,
    priority: 'optional',
    category: 'Core',
    configRoute: '/onboarding/modules/prospective-members/config',
    permissions: {
      viewDescription: 'View prospective member pipeline and applicant progress',
      manageDescription: 'Manage applicants, configure pipeline stages, and convert members',
      view: ['View applicant pipeline', 'See applicant progress', 'View pipeline statistics'],
      manage: ['Add/edit applicants', 'Advance or reject applicants', 'Configure pipeline stages', 'Convert applicants to members'],
      defaultManagePositions: ['it_manager', 'president', 'fire_chief', 'membership_committee_chair'],
    },
  },

  // ============================================
  // SYSTEM MODULES (Always available, System Owner config only)
  // ============================================
  {
    id: 'positions',
    name: 'Position Management',
    description: 'Create and manage positions, assign permissions, and control access across the organization.',
    icon: Shield,
    priority: 'essential',
    category: 'System',
    permissions: {
      viewDescription: 'View positions and position assignments',
      manageDescription: 'Create/edit positions, assign positions, set permissions',
      view: ['View positions', 'See position assignments'],
      manage: ['Create/edit positions', 'Assign positions', 'Set permissions'],
      defaultManagePositions: ['it_manager'],
    },
  },
  {
    id: 'settings',
    name: 'Organization Settings',
    description: 'Configure organization-wide settings, branding, and system preferences.',
    icon: UserCog,
    priority: 'essential',
    category: 'System',
    permissions: {
      viewDescription: 'View organization settings',
      manageDescription: 'Edit settings, manage integrations, configure modules',
      view: ['View settings'],
      manage: ['Edit settings', 'Manage integrations', 'Configure modules'],
      defaultManagePositions: ['it_manager'],
    },
  },
];

// ============================================
// Helper functions for working with modules
// ============================================

/**
 * Get all modules as a map by ID for quick lookup
 */
export const getModuleById = (id: string): ModuleDefinition | undefined => {
  return MODULE_REGISTRY.find((m) => m.id === id);
};

/**
 * Get modules grouped by priority
 */
export const getModulesByPriority = () => ({
  essential: MODULE_REGISTRY.filter((m) => m.priority === 'essential'),
  recommended: MODULE_REGISTRY.filter((m) => m.priority === 'recommended'),
  optional: MODULE_REGISTRY.filter((m) => m.priority === 'optional'),
});

/**
 * Get modules grouped by category
 */
export const getModulesByCategory = () => {
  const categories: Record<string, ModuleDefinition[]> = {};
  MODULE_REGISTRY.forEach((module) => {
    if (!categories[module.category]) {
      categories[module.category] = [];
    }
    categories[module.category]!.push(module);
  });
  return categories;
};

/**
 * Get only user-facing modules (excludes system modules)
 * Use this for the ModuleOverview page where users select modules
 */
export const getUserFacingModules = (): ModuleDefinition[] => {
  return MODULE_REGISTRY.filter((m) => m.category !== 'System');
};

/**
 * Get modules that have configurable permissions
 * Use this for PositionSetup and ModuleConfigTemplate pages
 */
export const getConfigurableModules = (): ModuleDefinition[] => {
  return MODULE_REGISTRY;
};

/**
 * Get a map of module IDs to their permission config
 * Useful for initializing position permissions
 */
export const getModulePermissionMap = (): Record<string, { view: boolean; manage: boolean }> => {
  const map: Record<string, { view: boolean; manage: boolean }> = {};
  MODULE_REGISTRY.forEach((module) => {
    map[module.id] = { view: true, manage: false };
  });
  return map;
};

/**
 * Get all unique module IDs
 */
export const getAllModuleIds = (): string[] => {
  return MODULE_REGISTRY.map((m) => m.id);
};
