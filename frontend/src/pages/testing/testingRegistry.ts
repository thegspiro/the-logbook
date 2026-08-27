/**
 * Testing checklist registry
 *
 * Every route the application declares, grouped the way a tester walks the
 * app, together with the gate the route actually enforces. It backs
 * `/testing`, the in-app companion to TESTING_CHECKLIST.md: the document says
 * what to try on a screen, this says which screens exist and who is supposed
 * to be able to open them.
 *
 * The gates here are copied from the `<ProtectedRoute>` wrappers in each
 * module's `routes.tsx`, so they can drift from the routes they describe —
 * and a checklist that reports the wrong gate is worse than none, because a
 * tester will conclude the gate is broken rather than the list. That is what
 * `testingRegistry.test.ts` is for: it walks the same sources and fails when
 * a route is added, removed, or re-gated without this file following.
 *
 * Shared gate constants are imported rather than copied for the same reason.
 */

import { FACILITY_ENTRY_PERMISSIONS } from '../../modules/facilities/routes';
import { MEDICAL_VIEW_PERMISSIONS } from '../../modules/medical-supplies/routes';
import { LEGAL_DOCUMENTS_PERMISSIONS } from '../../modules/governance/routes';

export interface TestPageEntry {
  /** Route pattern exactly as declared in App.tsx or a module's routes.tsx. */
  path: string;
  label: string;
  /** What this screen is for, when the label alone does not say it. */
  note?: string;
  /** `requiredPermission` on the route. */
  permission?: string;
  /** `requiredAnyPermission` on the route — any one of these opens it. */
  anyPermission?: readonly string[];
  /** `requiredRole` on the route. */
  role?: string;
  /** `requiredModule` — the organization must have this module switched on. */
  module?: string;
  /** Set when the route only redirects; there is no screen of its own. */
  redirectsTo?: string;
  /** Renders outside AppLayout and needs no session. */
  isPublic?: true;
}

export interface TestGroupEntry {
  id: string;
  label: string;
  description: string;
  /** The matching section of TESTING_CHECKLIST.md, for the manual steps. */
  checklistSection?: string;
  pages: readonly TestPageEntry[];
}

export const TESTING_GROUPS: readonly TestGroupEntry[] = [
  {
    id: 'core',
    label: 'Core',
    description: 'The screens every signed-in member lands on, whatever their department has enabled.',
    checklistSection: '15. Dashboard & Reports',
    pages: [
      { path: '/dashboard', label: 'Dashboard', note: 'Landing page after sign-in — widgets, quick actions, alerts' },
      { path: '/testing', label: 'Testing home', note: 'This page — listed so the list is complete' },
      { path: '/learning', label: 'Learning Center' },
      { path: '/learning/:pathId', label: 'Learning Path' },
      { path: '/account', label: 'My Account', note: 'Profile, password change, MFA, notification preferences' },
      { path: '/settings/account', label: 'Account settings (legacy URL)', redirectsTo: '/account' },
      { path: '/governance/org-chart', label: 'Org Chart' },
      { path: '/governance/legal', label: 'Legal Documents', anyPermission: LEGAL_DOCUMENTS_PERMISSIONS },
      { path: '/action-items', label: 'Action Items' },
      { path: '/documents', label: 'Documents', note: 'Folder tree, upload, permissions on a folder' },
    ],
  },
  {
    id: 'auth',
    label: 'Sign-in & account recovery',
    description:
      'Sign out first — these render without a session and are where lockout, MFA and reset links are proved.',
    checklistSection: '1. Authentication & Session Management',
    pages: [
      { path: '/login', label: 'Login', isPublic: true },
      {
        path: '/auth/callback',
        label: 'OAuth callback',
        note: 'Landing page for the Google/Microsoft redirect',
        isPublic: true,
      },
      { path: '/forgot-password', label: 'Forgot Password', isPublic: true },
      { path: '/reset-password', label: 'Reset Password', note: 'Needs a ?token= from a reset email', isPublic: true },
    ],
  },
  {
    id: 'public',
    label: 'Public pages (no sign-in)',
    description:
      'Open these in a private window. They render outside the app shell, so a session must not be needed — and they must not paint white-on-white (see APPLICATION_PAGES.md).',
    checklistSection: '18. Public/Unauthenticated Routes',
    pages: [
      { path: '/', label: 'Welcome / landing', isPublic: true },
      { path: '/privacy', label: 'Privacy Policy', isPublic: true },
      { path: '/terms', label: 'Terms of Service', isPublic: true },
      { path: '/f/:slug', label: 'Public form submission', isPublic: true },
      { path: '/ballot', label: 'Ballot voting', note: 'Token-based; reached from a ballot email', isPublic: true },
      { path: '/application-status/:token', label: 'Application status', isPublic: true },
      { path: '/event-request/status/:token', label: 'Event request status', isPublic: true },
      {
        path: '/display/:code',
        label: 'Location kiosk display',
        note: 'Room QR display for a wall tablet',
        isPublic: true,
      },
      {
        path: '/display/:code/events/:eventId/guest',
        label: 'Guest check-in',
        note: 'Only works when the event allows guests and is held in that room',
        isPublic: true,
      },
      {
        path: '/finance/approvals/:token',
        label: 'External approver page',
        note: 'Token-authenticated, for a non-member approver',
        isPublic: true,
      },
    ],
  },
  {
    id: 'onboarding',
    label: 'Onboarding',
    description:
      'First-run setup. Completed setup cannot be replayed, so test this on a fresh database — an installed department will bounce you out.',
    checklistSection: '16. Organization & Settings',
    pages: [
      { path: '/onboarding', label: 'Onboarding entry / status check', isPublic: true },
      { path: '/onboarding/start', label: 'Organization setup', isPublic: true },
      {
        path: '/onboarding/department',
        label: 'Department setup (legacy URL)',
        redirectsTo: '/onboarding/start',
        isPublic: true,
      },
      { path: '/onboarding/navigation-choice', label: 'Navigation choice', isPublic: true },
      { path: '/onboarding/email-platform', label: 'Email platform', isPublic: true },
      { path: '/onboarding/email-config', label: 'Email configuration', isPublic: true },
      { path: '/onboarding/file-storage', label: 'File storage', isPublic: true },
      { path: '/onboarding/file-storage-config', label: 'File storage configuration', isPublic: true },
      { path: '/onboarding/authentication', label: 'Authentication choice', isPublic: true },
      { path: '/onboarding/it-team', label: 'IT team & backup access', isPublic: true },
      { path: '/onboarding/positions', label: 'Position setup', isPublic: true },
      {
        path: '/onboarding/roles',
        label: 'Role setup (legacy URL)',
        redirectsTo: '/onboarding/positions',
        isPublic: true,
      },
      { path: '/onboarding/stations', label: 'Station setup', isPublic: true },
      { path: '/onboarding/apparatus', label: 'Apparatus setup', isPublic: true },
      { path: '/onboarding/modules', label: 'Module selection', isPublic: true },
      {
        path: '/onboarding/module-selection',
        label: 'Module selection (alias URL)',
        note: 'Same page, URL stays as typed',
        isPublic: true,
      },
      { path: '/onboarding/modules/:moduleId/config', label: 'Module configuration', isPublic: true },
      { path: '/onboarding/system-owner', label: 'System owner creation', isPublic: true },
      {
        path: '/onboarding/admin-user',
        label: 'Admin user (legacy URL)',
        redirectsTo: '/onboarding/system-owner',
        isPublic: true,
      },
      { path: '/onboarding/security-check', label: 'Security check', isPublic: true },
      { path: '/onboarding/complete', label: 'Setup complete', isPublic: true },
    ],
  },
  {
    id: 'members',
    label: 'Members',
    description: 'The roster, member profiles and the administration hub behind them.',
    checklistSection: '2. Member Management',
    pages: [
      { path: '/members', label: 'Member directory' },
      { path: '/members/:userId', label: 'Member profile' },
      { path: '/members/:userId/training', label: 'Member training history', module: 'training' },
      { path: '/members/:userId/id-card', label: 'Member ID card' },
      { path: '/members/print-labels', label: 'Print member labels', permission: 'members.view' },
      { path: '/members/scan', label: 'Scan a member ID', anyPermission: ['users.view', 'members.manage'] },
      { path: '/members/check-in-station', label: 'Check-in station', permission: 'members.check_in' },
      { path: '/members/admin', label: 'Members administration hub', permission: 'members.manage' },
      { path: '/members/admin/edit/:userId', label: 'Edit member (admin)', permission: 'members.manage' },
      { path: '/members/admin/history/:userId', label: 'Member audit history', permission: 'members.manage' },
      { path: '/members/admin/waivers', label: 'Waiver management', permission: 'members.manage' },
      { path: '/admin/members', label: 'Members admin (legacy URL)', redirectsTo: '/members/admin' },
      { path: '/members/add', label: 'Add member (legacy URL)', redirectsTo: '/members/admin?tab=add' },
      { path: '/members/import', label: 'Import members (legacy URL)', redirectsTo: '/members/admin?tab=import' },
    ],
  },
  {
    id: 'prospective-members',
    label: 'Membership pipeline',
    description: 'Applicants from enquiry through interview to member.',
    checklistSection: '17. Membership Pipeline (Prospective Members)',
    pages: [
      {
        path: '/prospective-members',
        label: 'Prospective members',
        permission: 'prospective_members.manage',
        module: 'prospective_members',
      },
      {
        path: '/prospective-members/settings',
        label: 'Pipeline settings',
        permission: 'prospective_members.manage',
        module: 'prospective_members',
      },
      {
        path: '/prospective-members/:applicantId/interview',
        label: 'Interview',
        permission: 'prospective_members.manage',
        module: 'prospective_members',
      },
      {
        path: '/prospective-members/print-labels',
        label: 'Print prospect labels',
        permission: 'prospective_members.view',
        module: 'prospective_members',
      },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    description: 'Event listing, RSVPs, QR check-in and the events admin hub.',
    checklistSection: '4. Events Module',
    pages: [
      { path: '/events', label: 'Events' },
      { path: '/events/:id', label: 'Event detail', note: 'RSVP, attendance, roster' },
      { path: '/events/:id/qr-code', label: 'Event QR code' },
      { path: '/events/:id/check-in', label: 'Event self check-in' },
      { path: '/events/admin', label: 'Events administration hub', permission: 'events.manage' },
      { path: '/events/templates', label: 'Event templates', permission: 'events.manage' },
      { path: '/events/:id/edit', label: 'Edit event', permission: 'events.manage' },
      { path: '/events/:id/monitoring', label: 'Check-in monitoring', permission: 'events.manage' },
      { path: '/events/analytics', label: 'Attendance trends', permission: 'analytics.view' },
      { path: '/events/:id/analytics', label: 'Event analytics', permission: 'analytics.view' },
      { path: '/events/new', label: 'New event (legacy URL)', redirectsTo: '/events/admin?tab=create' },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    description: 'Member training, programs, cohorts, skills testing and the printable records.',
    checklistSection: '5. Training Module',
    pages: [
      { path: '/training', label: 'Training home', module: 'training' },
      { path: '/training/my-training', label: 'My training', module: 'training' },
      { path: '/training/submit', label: 'Submit training', module: 'training' },
      { path: '/training/courses', label: 'Course library', module: 'training' },
      { path: '/training/programs', label: 'Training programs', module: 'training' },
      { path: '/training/programs/:programId', label: 'Program detail', module: 'training' },
      { path: '/training/my-progress/:enrollmentId', label: 'My program progress', module: 'training' },
      { path: '/training/my-skill-tests/:testId', label: 'My skill test result', module: 'training' },
      { path: '/training/admin', label: 'Training administration', permission: 'training.manage', module: 'training' },
      { path: '/training/cohorts', label: 'Cohorts', permission: 'training.manage', module: 'training' },
      {
        path: '/training/cohorts/:cohortId',
        label: 'Cohort detail',
        permission: 'training.manage',
        module: 'training',
      },
      { path: '/training/log-shift', label: 'Manual shift report', permission: 'training.manage', module: 'training' },
      {
        path: '/training/compliance-config',
        label: 'Compliance requirements',
        anyPermission: ['settings.manage', 'compliance.manage'],
        module: 'training',
      },
      { path: '/training/skills-testing', label: 'Skills testing', module: 'training' },
      { path: '/training/skills-testing/test/new', label: 'Start a skill test', module: 'training' },
      { path: '/training/skills-testing/test/:testId', label: 'Skill test', module: 'training' },
      { path: '/training/skills-testing/test/:testId/active', label: 'Active skill test', module: 'training' },
      {
        path: '/training/skills-testing/templates/new',
        label: 'New skill template',
        permission: 'training.manage',
        module: 'training',
      },
      {
        path: '/training/skills-testing/templates/:id',
        label: 'Skill template',
        permission: 'training.manage',
        module: 'training',
      },
      {
        path: '/training/skills-testing/templates/:id/edit',
        label: 'Edit skill template',
        permission: 'training.manage',
        module: 'training',
      },
      { path: '/training/print/member', label: 'Print member training', module: 'training' },
      { path: '/training/print/program', label: 'Print program', module: 'training' },
      {
        path: '/training/print/compliance',
        label: 'Print compliance',
        permission: 'training.manage',
        module: 'training',
      },
      { path: '/training/skills-testing/print/template', label: 'Print skill sheet', module: 'training' },
      { path: '/training/skills-testing/print/scorecard', label: 'Print skill scorecard', module: 'training' },
      {
        path: '/training/officer',
        label: 'Officer dashboard (legacy URL)',
        redirectsTo: '/training/admin?page=dashboard&tab=overview',
      },
      {
        path: '/training/submissions',
        label: 'Submissions (legacy URL)',
        redirectsTo: '/training/admin?page=records&tab=submissions',
      },
      {
        path: '/training/requirements',
        label: 'Requirements (legacy URL)',
        redirectsTo: '/training/admin?page=setup&tab=requirements',
      },
      {
        path: '/training/sessions/new',
        label: 'New session (legacy URL)',
        redirectsTo: '/training/admin?page=records&tab=sessions',
      },
      {
        path: '/training/programs/new',
        label: 'New program (legacy URL)',
        redirectsTo: '/training/admin?page=setup&tab=pipelines',
      },
      {
        path: '/training/shift-reports',
        label: 'Shift reports (legacy URL)',
        redirectsTo: '/training/admin?page=records&tab=shift-reports',
      },
      {
        path: '/training/integrations',
        label: 'Integrations (legacy URL)',
        redirectsTo: '/training/admin?page=setup&tab=integrations',
      },
    ],
  },
  {
    id: 'scheduling',
    label: 'Scheduling & equipment checks',
    description: 'Shifts, platoons, seat qualifications and the apparatus check workflow.',
    checklistSection: '7. Scheduling Module',
    pages: [
      { path: '/scheduling', label: 'Schedule', module: 'scheduling' },
      { path: '/scheduling/checkin', label: 'Shift check-in', module: 'scheduling' },
      { path: '/scheduling/checkin/print', label: 'Print shift check-in', module: 'scheduling' },
      { path: '/scheduling/shift-reports/print', label: 'Print shift report', module: 'scheduling' },
      {
        path: '/scheduling/templates',
        label: 'Shift templates',
        permission: 'scheduling.manage',
        module: 'scheduling',
      },
      { path: '/scheduling/patterns', label: 'Shift patterns', permission: 'scheduling.manage', module: 'scheduling' },
      { path: '/scheduling/platoons', label: 'Platoons', permission: 'scheduling.manage', module: 'scheduling' },
      {
        path: '/scheduling/reports',
        label: 'Scheduling reports',
        permission: 'scheduling.manage',
        module: 'scheduling',
      },
      {
        path: '/scheduling/settings',
        label: 'Scheduling settings',
        permission: 'scheduling.manage',
        module: 'scheduling',
      },
      {
        path: '/scheduling/qualifications',
        label: 'Position roster / qualifications',
        anyPermission: ['scheduling.manage', 'training.view_all', 'training.manage'],
        module: 'scheduling',
      },
      {
        path: '/scheduling/equipment',
        label: 'Fleet board',
        anyPermission: ['equipment_check.view', 'scheduling.manage'],
        module: 'scheduling',
      },
      {
        path: '/scheduling/equipment/:apparatusId',
        label: 'Apparatus check detail',
        anyPermission: ['equipment_check.view', 'scheduling.manage'],
        module: 'scheduling',
      },
      {
        path: '/scheduling/equipment/checks',
        label: 'Check log',
        anyPermission: ['equipment_check.submit', 'equipment_check.view', 'scheduling.manage'],
        module: 'scheduling',
      },
      {
        path: '/scheduling/apparatus-inventory',
        label: 'Apparatus inventory',
        anyPermission: ['equipment_check.submit', 'equipment_check.view', 'inventory.view'],
        module: 'scheduling',
      },
      {
        path: '/scheduling/supply/expiring',
        label: 'Expiring supplies',
        anyPermission: ['scheduling.manage', 'equipment_check.view', 'inventory.manage'],
        module: 'scheduling',
      },
      {
        path: '/scheduling/equipment-check-templates/new',
        label: 'New equipment check template',
        permission: 'scheduling.manage',
        module: 'scheduling',
      },
      {
        path: '/scheduling/equipment-check-templates/:templateId',
        label: 'Equipment check template',
        permission: 'scheduling.manage',
        module: 'scheduling',
      },
      {
        path: '/scheduling/equipment-check-reports',
        label: 'Equipment check reports',
        permission: 'scheduling.manage',
        module: 'scheduling',
      },
    ],
  },
  {
    id: 'inventory',
    label: 'Gear & inventory',
    description: 'Member-issued gear, the catalogue and every administration screen behind it.',
    checklistSection: '6. Inventory Module',
    pages: [
      { path: '/inventory/my-equipment', label: 'My equipment', module: 'inventory' },
      { path: '/inventory/items/:id', label: 'Item detail', module: 'inventory' },
      { path: '/inventory', label: 'Gear catalogue', permission: 'inventory.manage', module: 'inventory' },
      { path: '/inventory/items', label: 'Items', permission: 'inventory.manage', module: 'inventory' },
      {
        path: '/inventory/admin',
        label: 'Inventory administration hub',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      { path: '/inventory/admin/setup', label: 'Inventory setup', permission: 'inventory.manage', module: 'inventory' },
      { path: '/inventory/admin/items', label: 'Admin — items', permission: 'inventory.manage', module: 'inventory' },
      {
        path: '/inventory/admin/pool',
        label: 'Admin — pool items',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/categories',
        label: 'Admin — categories',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/maintenance',
        label: 'Admin — maintenance',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/members',
        label: 'Admin — member issue',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/charges',
        label: 'Admin — charges',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/returns',
        label: 'Admin — return requests',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/requests',
        label: 'Admin — equipment requests',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/write-offs',
        label: 'Admin — write-offs',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/reorder',
        label: 'Admin — reorder requests',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/kits',
        label: 'Admin — equipment kits',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/variant-groups',
        label: 'Admin — variant groups',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/allowances',
        label: 'Admin — allowances',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/vendors',
        label: 'Admin — vendors',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      {
        path: '/inventory/admin/impact-planner',
        label: 'Admin — impact planner',
        permission: 'inventory.manage',
        module: 'inventory',
      },
      { path: '/inventory/checkouts', label: 'Checkouts', permission: 'inventory.manage', module: 'inventory' },
      { path: '/inventory/storage-areas', label: 'Storage areas', permission: 'inventory.manage', module: 'inventory' },
      { path: '/inventory/import', label: 'Import inventory', permission: 'inventory.manage', module: 'inventory' },
      {
        path: '/inventory/print-labels',
        label: 'Print barcode labels',
        permission: 'inventory.manage',
        module: 'inventory',
      },
    ],
  },
  {
    id: 'medical',
    label: 'Medical supplies & screening',
    description: 'The medical stock room and the HIPAA-sensitive screening records.',
    checklistSection: '6. Inventory Module',
    pages: [
      {
        path: '/medical-supplies',
        label: 'Medical supplies',
        anyPermission: MEDICAL_VIEW_PERMISSIONS,
        module: 'medical_supplies',
      },
      {
        path: '/medical-supplies/categories',
        label: 'Medical categories',
        anyPermission: MEDICAL_VIEW_PERMISSIONS,
        module: 'medical_supplies',
      },
      {
        path: '/medical-screening',
        label: 'Medical screening',
        permission: 'medical_screening.view',
        module: 'medical_screening',
      },
    ],
  },
  {
    id: 'apparatus',
    label: 'Apparatus & fleet',
    description: 'The apparatus record itself — the shift-side checks live under Scheduling.',
    checklistSection: '13. Apparatus / Fleet Module',
    pages: [
      {
        path: '/apparatus',
        label: 'Apparatus list',
        anyPermission: ['apparatus.view', 'apparatus.manage'],
        module: 'apparatus',
      },
      {
        path: '/apparatus/:id',
        label: 'Apparatus detail',
        anyPermission: ['apparatus.view', 'apparatus.manage'],
        module: 'apparatus',
      },
      {
        path: '/apparatus/new',
        label: 'New apparatus',
        anyPermission: ['apparatus.create', 'apparatus.manage'],
        module: 'apparatus',
      },
      {
        path: '/apparatus/:id/edit',
        label: 'Edit apparatus',
        anyPermission: ['apparatus.edit', 'apparatus.manage'],
        module: 'apparatus',
      },
      {
        path: '/apparatus/print-labels',
        label: 'Print apparatus labels',
        anyPermission: ['apparatus.view', 'apparatus.manage'],
        module: 'apparatus',
      },
      {
        path: '/apparatus-basic',
        label: 'Basic apparatus',
        note: 'Simple apparatus list for departments not running the full module',
      },
    ],
  },
  {
    id: 'facilities',
    label: 'Facilities & locations',
    description: 'Stations, rooms, inspections and the QR codes that address them.',
    checklistSection: '12. Facilities Module',
    pages: [
      {
        path: '/facilities',
        label: 'Facilities dashboard',
        anyPermission: FACILITY_ENTRY_PERMISSIONS,
        module: 'facilities',
      },
      {
        path: '/facilities/:id',
        label: 'Facility detail',
        anyPermission: FACILITY_ENTRY_PERMISSIONS,
        module: 'facilities',
      },
      {
        path: '/facilities/maintenance',
        label: 'Facility maintenance',
        anyPermission: FACILITY_ENTRY_PERMISSIONS,
        module: 'facilities',
      },
      {
        path: '/facilities/inspections',
        label: 'Facility inspections',
        anyPermission: FACILITY_ENTRY_PERMISSIONS,
        module: 'facilities',
      },
      {
        path: '/facilities/print-labels',
        label: 'Print facility labels',
        anyPermission: FACILITY_ENTRY_PERMISSIONS,
        module: 'facilities',
      },
      { path: '/locations', label: 'Locations' },
      {
        path: '/locations/qr-codes',
        label: 'Room QR codes',
        anyPermission: ['locations.manage', 'facilities.manage', 'apparatus.view'],
        module: 'facilities',
      },
    ],
  },
  {
    id: 'elections',
    label: 'Elections',
    description: 'Ballots, candidates and results. The voting page itself is public and listed above.',
    checklistSection: '8. Elections Module',
    pages: [
      { path: '/elections', label: 'Elections', module: 'elections' },
      { path: '/elections/:electionId', label: 'Election detail', module: 'elections' },
      { path: '/elections/settings', label: 'Election settings', permission: 'elections.manage', module: 'elections' },
    ],
  },
  {
    id: 'minutes',
    label: 'Meetings & minutes',
    description: 'Meeting minutes, motions and approval.',
    checklistSection: '9. Meetings & Minutes',
    pages: [
      { path: '/minutes', label: 'Minutes', module: 'minutes' },
      { path: '/minutes/:minutesId', label: 'Minutes detail', module: 'minutes' },
    ],
  },
  {
    id: 'forms',
    label: 'Custom forms',
    description: 'The form builder. The submission side is the public /f/:slug page listed above.',
    checklistSection: '11. Custom Forms Module',
    pages: [{ path: '/forms', label: 'Forms', permission: 'forms.manage', module: 'forms' }],
  },
  {
    id: 'communications',
    label: 'Communications & notifications',
    description: 'The bell, the inbox, and the admin screens that send. Every notice must also arrive by email.',
    checklistSection: '14. Notifications, Messages & Email',
    pages: [
      { path: '/notifications', label: 'Notifications', module: 'notifications' },
      { path: '/messages', label: 'Message inbox' },
      { path: '/messages/:messageId', label: 'Message detail' },
      { path: '/communications/messages', label: 'Messages administration', permission: 'notifications.manage' },
      { path: '/communications/email-templates', label: 'Email templates', permission: 'settings.manage' },
      {
        path: '/communications/photo-use-consent',
        label: 'Photo use consent',
        anyPermission: ['users.view_consents', 'notifications.manage', 'members.manage', 'users.edit'],
      },
    ],
  },
  {
    id: 'storefront',
    label: 'Department store',
    description: 'Browsing, checkout and the store console.',
    checklistSection: '16. Organization & Settings',
    pages: [
      { path: '/store', label: 'Store', permission: 'storefront.view', module: 'storefront' },
      { path: '/store/checkout', label: 'Checkout', permission: 'storefront.view', module: 'storefront' },
      { path: '/store/orders', label: 'My orders', permission: 'storefront.view', module: 'storefront' },
      { path: '/store/admin', label: 'Store administration', permission: 'storefront.manage', module: 'storefront' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    description: 'Budgets, purchase requests, expenses, check requests and dues.',
    checklistSection: '31. Finance Module — Dues & Payments',
    pages: [
      { path: '/finance', label: 'Finance dashboard', permission: 'finance.view', module: 'finance' },
      { path: '/finance/budgets', label: 'Budgets', permission: 'finance.view', module: 'finance' },
      { path: '/finance/budgets/:id', label: 'Budget detail', permission: 'finance.view', module: 'finance' },
      { path: '/finance/purchase-requests', label: 'Purchase requests', permission: 'finance.view', module: 'finance' },
      {
        path: '/finance/purchase-requests/new',
        label: 'New purchase request',
        permission: 'finance.view',
        module: 'finance',
      },
      {
        path: '/finance/purchase-requests/:id',
        label: 'Purchase request detail',
        permission: 'finance.view',
        module: 'finance',
      },
      {
        path: '/finance/purchase-requests/:id/edit',
        label: 'Edit purchase request',
        permission: 'finance.view',
        module: 'finance',
      },
      { path: '/finance/expenses', label: 'Expense reports', permission: 'finance.view', module: 'finance' },
      { path: '/finance/expenses/new', label: 'New expense report', permission: 'finance.view', module: 'finance' },
      { path: '/finance/expenses/:id', label: 'Expense report detail', permission: 'finance.view', module: 'finance' },
      { path: '/finance/check-requests', label: 'Check requests', permission: 'finance.view', module: 'finance' },
      {
        path: '/finance/check-requests/new',
        label: 'New check request',
        permission: 'finance.view',
        module: 'finance',
      },
      {
        path: '/finance/check-requests/:id',
        label: 'Check request detail',
        permission: 'finance.view',
        module: 'finance',
      },
      { path: '/finance/dues', label: 'Dues management', permission: 'finance.view', module: 'finance' },
      { path: '/finance/settings', label: 'Fiscal year settings', permission: 'finance.manage', module: 'finance' },
      {
        path: '/finance/settings/approval-chains',
        label: 'Approval chains',
        permission: 'finance.configure_approvals',
        module: 'finance',
      },
    ],
  },
  {
    id: 'grants',
    label: 'Grants & fundraising',
    description: 'Grant applications, campaigns, donors and donations.',
    pages: [
      { path: '/grants', label: 'Grants dashboard', permission: 'fundraising.view', module: 'grants' },
      { path: '/grants/opportunities', label: 'Grant opportunities', permission: 'fundraising.view', module: 'grants' },
      { path: '/grants/applications', label: 'Grant applications', permission: 'fundraising.view', module: 'grants' },
      {
        path: '/grants/applications/new',
        label: 'New grant application',
        permission: 'fundraising.manage',
        module: 'grants',
      },
      { path: '/grants/applications/:id', label: 'Grant detail', permission: 'fundraising.view', module: 'grants' },
      {
        path: '/grants/applications/:id/edit',
        label: 'Edit grant application',
        permission: 'fundraising.manage',
        module: 'grants',
      },
      { path: '/grants/campaigns', label: 'Campaigns', permission: 'fundraising.view', module: 'grants' },
      { path: '/grants/donors', label: 'Donors', permission: 'fundraising.view', module: 'grants' },
      { path: '/grants/donations', label: 'Donations', permission: 'fundraising.view', module: 'grants' },
      { path: '/grants/reports', label: 'Fundraising reports', permission: 'fundraising.view', module: 'grants' },
    ],
  },
  {
    id: 'admin-hours',
    label: 'Administrative hours',
    description: 'Clocking administrative time and the category setup behind it.',
    checklistSection: '20. Admin Hours Module',
    pages: [
      { path: '/admin-hours', label: 'Admin hours' },
      { path: '/admin-hours/:categoryId/clock-in', label: 'Clock in' },
      { path: '/admin-hours/categories/:categoryId/qr-code', label: 'Category QR code' },
      { path: '/admin-hours/manage', label: 'Manage admin hours', permission: 'admin_hours.manage' },
    ],
  },
  {
    id: 'reports',
    label: 'Reports & analytics',
    description: 'Cross-module reporting and the analytics dashboards.',
    checklistSection: '15. Dashboard & Reports',
    pages: [
      { path: '/reports', label: 'Reports', permission: 'reports.view', module: 'reports' },
      { path: '/admin/analytics', label: 'Analytics dashboard', permission: 'analytics.view' },
      { path: '/admin/platform-analytics', label: 'Platform analytics', permission: 'settings.manage' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings & administration',
    description: 'Department configuration, positions and permissions, integrations and the security consoles.',
    checklistSection: '16. Organization & Settings',
    pages: [
      { path: '/settings', label: 'Organization settings', permission: 'settings.manage' },
      { path: '/setup', label: 'Department setup', permission: 'settings.manage' },
      {
        path: '/settings/roles',
        label: 'Positions & permissions',
        permission: 'positions.manage_permissions',
        note: 'Where the gates on every other row here are granted',
      },
      { path: '/integrations', label: 'Integrations', permission: 'settings.manage', module: 'integrations' },
      {
        path: '/admin/public-portal',
        label: 'Public portal administration',
        permission: 'settings.manage',
        module: 'public_info',
      },
      { path: '/admin/audit-log', label: 'Audit log', permission: 'audit.view' },
      { path: '/admin/errors', label: 'Error monitoring', permission: 'settings.manage' },
      { path: '/ip-security', label: 'IP security', permission: 'security.manage' },
      { path: '/ip-security/my-requests', label: 'My IP exception requests' },
    ],
  },
];

/** Every page in the registry, flattened, in the order the groups declare. */
export const ALL_TEST_PAGES: readonly (TestPageEntry & { groupId: string })[] = TESTING_GROUPS.flatMap((group) =>
  group.pages.map((page) => ({ ...page, groupId: group.id }))
);

/** The `:param` segments of a route pattern, in order. */
export const routeParams = (path: string): string[] =>
  [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] ?? '');

/**
 * Substitute recorded sample values into a route pattern.
 *
 * Returns null while any parameter is still blank: a URL with a literal
 * `:id` in it resolves to no route, and the catch-all would land the tester
 * on the dashboard with nothing to say why.
 */
export const buildTestUrl = (path: string, values: Record<string, string>): string | null => {
  const params = routeParams(path);
  if (params.some((param) => !values[param]?.trim())) return null;
  return params.reduce((url, param) => url.replace(`:${param}`, encodeURIComponent(values[param]?.trim() ?? '')), path);
};
