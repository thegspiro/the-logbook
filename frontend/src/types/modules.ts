/**
 * Module System Types
 *
 * Defines the module structure for The Logbook platform.
 * Modules can be core (always enabled), recommended (enabled by default),
 * or optional (disabled by default).
 */

export type ModuleCategory = 'core' | 'recommended' | 'optional';

export interface Module {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  category: ModuleCategory;
  enabled: boolean;
  canDisable: boolean;
  icon: string; // lucide-react icon name
  route: string;
  features: string[];
  requiresSetup?: boolean;
  setupDescription?: string;
}

export interface ModuleConfig {
  modules: Module[];
  lastUpdated: string;
}

export const AVAILABLE_MODULES: Module[] = [
  // ============================================
  // CORE MODULES (Always Enabled)
  // ============================================
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Overview of department activity and quick stats',
    longDescription:
      'Your central hub for department activity. See quick stats, recent incidents, upcoming shifts, and important announcements at a glance.',
    category: 'core',
    enabled: true,
    canDisable: false,
    icon: 'LayoutDashboard',
    route: '/dashboard',
    features: [
      'Real-time department statistics',
      'Recent activity feed',
      'Upcoming events and shifts',
      'Quick access to all modules',
      'Customizable widgets',
    ],
  },
  {
    id: 'membership',
    name: 'Membership Management',
    description: 'Member profiles, certifications, and contact information',
    longDescription:
      'Manage all aspects of your department membership. Track certifications, training records, contact information, and member status in one centralized location.',
    category: 'core',
    enabled: true,
    canDisable: false,
    icon: 'Users',
    route: '/members',
    features: [
      'Member profiles and contact info',
      'Certification tracking',
      'Training records',
      'Active/inactive status',
      'Role assignments',
      'Emergency contact information',
    ],
  },
  {
    id: 'scheduling',
    name: 'Scheduling',
    description: 'Duty rosters, shift scheduling, and calendar management',
    longDescription:
      'Create and manage duty rosters, track shift coverage, and maintain department calendars. Members can view their schedules and mark availability.',
    category: 'core',
    enabled: true,
    canDisable: false,
    icon: 'Calendar',
    route: '/scheduling',
    features: [
      'Shift scheduling and rosters',
      'Availability tracking',
      'Coverage requirements',
      'Calendar integration',
      'Automated notifications',
      'Swap shift requests',
    ],
  },
  {
    id: 'personal-settings',
    name: 'Personal Settings',
    description: 'Individual user preferences and profile management',
    longDescription:
      'Manage your personal profile, notification preferences, and account settings. Customize your experience and keep your information up to date.',
    category: 'core',
    enabled: true,
    canDisable: false,
    icon: 'UserCog',
    route: '/settings/personal',
    features: [
      'Profile management',
      'Notification preferences',
      'Password changes',
      'Email preferences',
      'Display settings',
    ],
  },
  {
    id: 'system-settings',
    name: 'System Settings',
    description: 'IT platform configuration and system administration',
    longDescription:
      'Administrative control panel for IT and system configuration. Manage users, configure integrations, and control system-wide settings. (Admin only)',
    category: 'core',
    enabled: true,
    canDisable: false,
    icon: 'Settings',
    route: '/settings/system',
    features: [
      'User and role management',
      'Email/storage/auth configuration',
      'Module management',
      'Backup and recovery settings',
      'Audit logs',
      'System health monitoring',
    ],
  },

  // ============================================
  // RECOMMENDED MODULES (Enabled by Default)
  // ============================================
  {
    id: 'apparatus',
    name: 'Apparatus Management',
    description: 'Vehicle tracking, maintenance schedules, and equipment inventory',
    longDescription:
      'Track all department vehicles and their equipment. Maintain service schedules, log inspections, and monitor vehicle status and availability.',
    category: 'recommended',
    enabled: true,
    canDisable: true,
    icon: 'Truck',
    route: '/apparatus',
    features: [
      'Vehicle inventory and tracking',
      'Maintenance schedules',
      'Equipment per vehicle',
      'Service history logs',
      'Inspection checklists',
      'Vehicle status and availability',
      'Fuel and mileage tracking',
    ],
  },
  {
    id: 'inventory',
    name: 'Inventory Management',
    description: 'Equipment tracking, supply levels, and procurement',
    longDescription:
      'Manage all department equipment and supplies. Track inventory levels, maintenance records, and procurement needs across all locations.',
    category: 'recommended',
    enabled: true,
    canDisable: true,
    icon: 'Package',
    route: '/inventory',
    features: [
      'Equipment and supply tracking',
      'Low stock alerts',
      'Maintenance records',
      'Purchase orders',
      'Location-based inventory',
      'Asset depreciation tracking',
    ],
  },
  {
    id: 'communications',
    name: 'Communications',
    description: 'Internal messaging, announcements, and notifications',
    longDescription:
      'Keep everyone informed with department-wide announcements, direct messaging, and customizable notifications for important events.',
    category: 'recommended',
    enabled: true,
    canDisable: true,
    icon: 'MessageSquare',
    route: '/communications',
    features: [
      'Department announcements',
      'Direct messaging',
      'Group discussions',
      'Emergency notifications',
      'Email integration',
      'Mobile push notifications',
    ],
  },

  // ============================================
  // OPTIONAL MODULES (Disabled by Default)
  // ============================================
  {
    id: 'training',
    name: 'Training & Certification',
    description: 'Course management, certification tracking, and compliance monitoring',
    longDescription:
      'Comprehensive training management system. Schedule courses, track certifications, monitor compliance, and maintain training records for all members.',
    category: 'optional',
    enabled: false,
    canDisable: true,
    icon: 'GraduationCap',
    route: '/training',
    features: [
      'Course scheduling and management',
      'Certification tracking and expiration alerts',
      'Training attendance records',
      'Compliance monitoring',
      'Instructor assignments',
      'Training materials library',
    ],
  },
  {
    id: 'incidents',
    name: 'Incidents & Reports',
    description: 'Incident logging, run reports, and analytics',
    longDescription:
      'Document all department incidents and generate comprehensive reports. Track response times, incident types, and analyze department performance.',
    category: 'optional',
    enabled: false,
    canDisable: true,
    icon: 'FileText',
    route: '/incidents',
    features: [
      'Incident logging and documentation',
      'Run reports and fire reports',
      'Response time tracking',
      'Incident statistics and analytics',
      'NFIRS reporting',
      'Mutual aid tracking',
    ],
  },
  {
    id: 'documents',
    name: 'Documents & SOPs',
    description: 'Standard Operating Procedures, policies, and forms library',
    longDescription:
      'Centralized document management for all department policies, procedures, and forms. Version control ensures everyone has access to the latest documents.',
    category: 'optional',
    enabled: false,
    canDisable: true,
    icon: 'FolderOpen',
    route: '/documents',
    features: [
      'Standard Operating Procedures',
      'Department policies',
      'Forms and templates library',
      'Document version control',
      'Access permissions',
      'Document approval workflows',
    ],
  },
  {
    id: 'hr-payroll',
    name: 'HR & Payroll',
    description: 'Time tracking, compensation, and benefits management',
    longDescription:
      'Manage HR functions for departments with paid staff. Track time, process payroll, manage benefits, and maintain personnel records.',
    category: 'optional',
    enabled: false,
    canDisable: true,
    icon: 'Briefcase',
    route: '/hr',
    features: [
      'Time and attendance tracking',
      'Payroll processing',
      'Benefits administration',
      'Leave management',
      'Performance reviews',
      'Personnel file management',
    ],
    requiresSetup: true,
    setupDescription: 'Requires payroll provider integration',
  },
  {
    id: 'grants',
    name: 'Grants & Fundraising',
    description: 'Grant tracking, fundraising campaigns, and budget management',
    longDescription:
      'Manage grant applications, track fundraising campaigns, and maintain department budgets. Monitor funding sources and spending.',
    category: 'optional',
    enabled: false,
    canDisable: true,
    icon: 'DollarSign',
    route: '/grants',
    features: [
      'Grant application tracking',
      'Fundraising campaign management',
      'Budget planning and tracking',
      'Donor management',
      'Financial reporting',
      'Grant deadline reminders',
    ],
  },
  {
    id: 'public-info',
    name: 'Public Information',
    description: 'Public-facing pages, community outreach, and fire safety education',
    longDescription:
      'Create a public-facing presence for your department. Share community information, safety tips, and department news with the public.',
    category: 'optional',
    enabled: false,
    canDisable: true,
    icon: 'Globe',
    route: '/public',
    features: [
      'Public website pages',
      'Fire safety education resources',
      'Community event calendar',
      'News and press releases',
      'Contact forms',
      'Social media integration',
    ],
    requiresSetup: true,
    setupDescription: 'Requires domain configuration',
  },
];
