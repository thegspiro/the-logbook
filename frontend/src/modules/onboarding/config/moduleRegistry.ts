/**
 * Central Module Registry
 *
 * This is the single source of truth for all application modules.
 * When adding a new module, add it here and it will automatically
 * appear in ModuleOverview, ModuleConfigTemplate, and RoleSetup pages.
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
    defaultManageRoles: string[];
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
      'Manage your department roster, roles, contact information, and member profiles. Core functionality for any organization.',
    icon: Users,
    priority: 'essential',
    category: 'Core',
    configRoute: '/onboarding/modules/members/config',
    permissions: {
      viewDescription: 'View member directory, contact information, and profiles',
      manageDescription: 'Add/edit members, assign roles, update member status',
      view: ['View member directory', 'See contact information', 'View member profiles'],
      manage: ['Add new members', 'Edit member information', 'Assign roles', 'Manage member status'],
      defaultManageRoles: ['admin', 'officers'],
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
      defaultManageRoles: ['admin', 'officers', 'secretary'],
    },
  },
  {
    id: 'documents',
    name: 'Documents & Files',
    description:
      'Centralized document storage for SOPs, policies, forms, and department files. Keep everything organized and accessible.',
    icon: FileText,
    priority: 'essential',
    category: 'Core',
    configRoute: '/onboarding/modules/documents/config',
    permissions: {
      viewDescription: 'Browse and download department documents and files',
      manageDescription: 'Upload documents, manage folders, set visibility',
      view: ['Browse documents', 'Download files', 'View document history'],
      manage: ['Upload documents', 'Create folders', 'Edit/delete files', 'Set document visibility'],
      defaultManageRoles: ['admin', 'officers'],
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
      defaultManageRoles: ['admin', 'training_officer'],
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
      defaultManageRoles: ['admin', 'quartermaster', 'officers'],
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
      defaultManageRoles: ['admin', 'officers', 'scheduling_officer'],
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
      defaultManageRoles: ['admin', 'secretary', 'president'],
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
      defaultManageRoles: ['admin', 'secretary'],
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
      defaultManageRoles: ['admin', 'officers'],
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
      defaultManageRoles: ['admin'],
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
      defaultManageRoles: ['admin'],
    },
  },

  // ============================================
  // OPTIONAL MODULES (Advanced)
  // ============================================
  {
    id: 'forms',
    name: 'Custom Forms',
    description:
      'Create custom forms for incident reports, surveys, feedback, and more. Collect structured data easily.',
    icon: FormInput,
    priority: 'optional',
    category: 'Advanced',
    configRoute: '/onboarding/modules/forms/config',
    permissions: {
      viewDescription: 'Fill out and submit forms',
      manageDescription: 'Create forms, view submissions, export data',
      view: ['View available forms', 'Submit forms', 'See personal submissions'],
      manage: ['Create form templates', 'View all submissions', 'Export responses', 'Manage form settings'],
      defaultManageRoles: ['admin', 'officers'],
    },
  },
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
      defaultManageRoles: ['admin'],
    },
  },

  // ============================================
  // SYSTEM MODULES (Always available, admin-only config)
  // ============================================
  {
    id: 'roles',
    name: 'Role Management',
    description: 'Create and manage roles, assign permissions, and control access across the organization.',
    icon: Shield,
    priority: 'essential',
    category: 'System',
    permissions: {
      viewDescription: 'View roles and role assignments',
      manageDescription: 'Create/edit roles, assign roles, set permissions',
      view: ['View roles', 'See role assignments'],
      manage: ['Create/edit roles', 'Assign roles', 'Set permissions'],
      defaultManageRoles: ['admin'],
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
      defaultManageRoles: ['admin'],
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
    categories[module.category].push(module);
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
 * Use this for RoleSetup and ModuleConfigTemplate pages
 */
export const getConfigurableModules = (): ModuleDefinition[] => {
  return MODULE_REGISTRY;
};

/**
 * Get a map of module IDs to their permission config
 * Useful for initializing role permissions
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
