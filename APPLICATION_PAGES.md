# The Logbook - Application Pages & URLs

Complete reference of all pages in the application, organized by module.

---

## Public Pages (No Authentication Required)

| URL | Page | Description |
|-----|------|-------------|
| `/` | Welcome | Landing / onboarding entry point |
| `/login` | Login | User authentication |
| `/forgot-password` | Forgot Password | Password reset request |
| `/reset-password` | Reset Password | Password reset form |
| `/f/:slug` | Public Form | Public form submission (token-based) |
| `/ballot` | Ballot Voting | Public ballot voting (token-based) |

---

## Onboarding

| URL | Page | Description |
|-----|------|-------------|
| `/onboarding` | Onboarding Check | Entry point / status check |
| `/onboarding/start` | Organization Setup | Step 1 - create organization |
| `/onboarding/navigation-choice` | Navigation Choice | Choose navigation layout |
| `/onboarding/email-platform` | Email Platform | Select email provider |
| `/onboarding/email-config` | Email Configuration | Configure email settings |
| `/onboarding/file-storage` | File Storage | Choose file storage provider |
| `/onboarding/file-storage-config` | File Storage Config | Configure file storage |
| `/onboarding/authentication` | Authentication | Choose auth method |
| `/onboarding/it-team` | IT Team & Backup | IT team & backup access setup |
| `/onboarding/roles` | Role Setup | Configure roles |
| `/onboarding/modules` | Module Selection | Choose which modules to enable |
| `/onboarding/modules/:moduleId/config` | Module Config | Configure individual module |
| `/onboarding/admin-user` | Admin User Creation | Create initial admin account |
| `/onboarding/security-check` | Security Check | Security verification |

---

## Dashboard

| URL | Page | Permission |
|-----|------|------------|
| `/dashboard` | Main Dashboard | Authenticated |

---

## Members

| URL | Page | Permission |
|-----|------|------------|
| `/members` | Members List | Authenticated |
| `/members/add` | Add Member | `members.create` |
| `/members/import` | Import Members | `members.create` |
| `/members/:userId` | Member Profile | Authenticated |
| `/members/:userId/training` | Member Training History | Authenticated |
| `/members/:userId/permissions` | User Permissions | `roles.manage` |
| `/members/lifecycle` | Member Lifecycle | `members.manage` |
| `/admin/members` | Member Management | `members.manage` |

---

## Prospective Members

| URL | Page | Permission |
|-----|------|------------|
| `/prospective-members` | Prospective Members Pipeline | `prospective_members.manage` |
| `/prospective-members/settings` | Pipeline Settings | `prospective_members.manage` |

---

## Apparatus

| URL | Page | Permission |
|-----|------|------------|
| `/apparatus` | Apparatus List | Authenticated |
| `/apparatus/new` | Add Apparatus | Authenticated |
| `/apparatus/:id` | Apparatus Detail | Authenticated |
| `/apparatus/:id/edit` | Edit Apparatus | Authenticated |

---

## Events

| URL | Page | Permission |
|-----|------|------------|
| `/events` | Events List | Authenticated |
| `/events/new` | Create Event | `events.manage` |
| `/events/:id` | Event Detail | Authenticated |
| `/events/:id/edit` | Edit Event | `events.manage` |
| `/events/:id/qr-code` | Event QR Code | Authenticated |
| `/events/:id/check-in` | Self Check-In | Authenticated |
| `/events/:id/monitoring` | Check-In Monitoring | `events.manage` |
| `/events/:id/analytics` | Event Analytics | `analytics.view` |
| `/events/settings` | Events Module Settings | `events.manage` |

---

## Training

| URL | Page | Permission |
|-----|------|------------|
| `/training` | Training Dashboard | Authenticated |
| `/training/officer` | Training Officer Dashboard | `training.manage` |
| `/training/requirements` | Training Requirements | `training.manage` |
| `/training/programs` | Training Programs | Authenticated |
| `/training/programs/new` | Create Training Program | `training.manage` |
| `/training/programs/:programId` | Program Detail | Authenticated |
| `/training/courses` | Course Library | Authenticated |
| `/training/sessions/new` | Create Training Session | `training.manage` |
| `/training/submit` | Submit Training | Authenticated |
| `/training/submissions` | Review Submissions | `training.manage` |
| `/training/shift-reports` | Shift Reports | Authenticated |
| `/training/integrations` | External Integrations | `training.manage` |
| `/training/my-training` | My Training | Authenticated |
| `/training/approval/:token` | Training Approval | Public (token-based) |

---

## Documents

| URL | Page | Permission |
|-----|------|------------|
| `/documents` | Documents | Authenticated |

---

## Inventory

| URL | Page | Permission |
|-----|------|------------|
| `/inventory` | Inventory Management | Authenticated |

---

## Scheduling

| URL | Page | Permission |
|-----|------|------------|
| `/scheduling` | Scheduling Calendar | Authenticated |
| `/scheduling/assignments` | Shift Assignments | `scheduling.manage` |
| `/scheduling/attendance` | Shift Attendance | `scheduling.manage` |
| `/scheduling/templates` | Shift Templates & Patterns | `scheduling.manage` |
| `/scheduling/reports` | Scheduling Reports | `scheduling.view` |

---

## Elections

| URL | Page | Permission |
|-----|------|------------|
| `/elections` | Elections List | Authenticated |
| `/elections/:id` | Election Detail | Authenticated |

---

## Minutes

| URL | Page | Permission |
|-----|------|------------|
| `/minutes` | Minutes List | Authenticated |
| `/minutes/:minutesId` | Minutes Detail | Authenticated |

---

## Forms

| URL | Page | Permission |
|-----|------|------------|
| `/forms` | Forms Management | Authenticated |

---

## Notifications

| URL | Page | Permission |
|-----|------|------------|
| `/notifications` | Notifications | Authenticated |

---

## Reports

| URL | Page | Permission |
|-----|------|------------|
| `/reports` | Reports | Authenticated |

---

## Integrations

| URL | Page | Permission |
|-----|------|------------|
| `/integrations` | Integrations | Authenticated |

---

## Settings & Administration

| URL | Page | Permission |
|-----|------|------------|
| `/settings` | Settings | Authenticated |
| `/settings/account` | User Account Settings | Authenticated |
| `/settings/roles` | Role Management | `roles.manage` |
| `/admin/errors` | Error Monitoring | `settings.manage` |
| `/admin/analytics` | Analytics Dashboard | `analytics.view` |
| `/admin/public-portal` | Public Portal Admin | `settings.manage` |
| `/admin/scheduled-tasks` | Scheduled Tasks | `settings.manage` |

---

**Total: 85+ pages across 15 modules**
