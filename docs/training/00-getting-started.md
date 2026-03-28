# Getting Started with The Logbook

Welcome to The Logbook, a comprehensive department management platform built for fire departments and emergency services organizations. This guide will walk you through your first login, navigating the interface, and understanding how the system is organized.

---

## Table of Contents

1. [First Login](#first-login)
2. [Changing Your Password](#changing-your-password)
3. [Understanding the Interface](#understanding-the-interface)
4. [Navigation Sidebar](#navigation-sidebar)
5. [Your Dashboard](#your-dashboard)
6. [Account Settings](#account-settings)
7. [Getting Help](#getting-help)

---

## First Login

When your department administrator creates your account, you will receive a welcome email with your login credentials. Your initial password is temporary and must be changed on first login.

1. Open your browser and navigate to your department's Logbook URL.
2. Enter the **username** and **password** provided to you.
3. Click **Sign In**.

> **Screenshot placeholder:**
> _[Screenshot of the login page showing the username and password fields, the Sign In button, and the "Forgot Password?" link at the bottom]_

> **Hint:** If you did not receive a welcome email, contact your department's IT Manager or the person who set up the system. They can resend your credentials or reset your password from the admin panel.

---

## Changing Your Password

After your first login, you will be prompted to change your temporary password. Your new password must meet the department's security policy.

1. Enter your **current (temporary) password**.
2. Enter your **new password** twice to confirm.
3. Click **Change Password**.

> **Screenshot placeholder:**
> _[Screenshot of the change password form showing the current password field, new password field, confirm password field, and any password requirements displayed (length, complexity)]_

**Password Requirements:**
- Minimum 8 characters (your department may require more)
- Cannot reuse recent passwords
- Session will time out after a period of inactivity (configured by your department)

> **Troubleshooting:** If your password change fails, ensure it meets all displayed requirements. If you are locked out after too many failed attempts, wait for the lockout period to expire or contact your administrator.

---

## Understanding the Interface

The Logbook uses a sidebar navigation layout. The main areas of the screen are:

1. **Sidebar (Left)** - Navigation menu for all modules
2. **Main Content Area (Center)** - The active page you are working on
3. **Header/Breadcrumb (Top)** - Shows your current location and provides context actions

> **Screenshot placeholder:**
> _[Full-screen screenshot of the dashboard showing the sidebar navigation on the left, the main dashboard content in the center, and the header area at the top. Annotate the three areas with numbered callouts]_

---

## Navigation Sidebar

The sidebar is organized into sections based on your role. Not all sections are visible to every member -- what you see depends on your assigned positions and permissions.

### Member-Facing Section

These links are available to all active members:

| Menu Item | Description |
|-----------|-------------|
| **Dashboard** | Your home page with quick stats and upcoming items |
| **Members** | Department roster and member profiles |
| **Events** | Upcoming and past department events |
| **Documents** | Shared files, SOPs, and policies |
| **Training** | Your training records, courses, and programs |
| **Shift Scheduling** | Duty roster, your shifts, and open shifts |
| **Inventory** | Equipment and supplies |
| **Apparatus** | Vehicles and apparatus |
| **Facilities** | Stations and buildings |
| **Elections** | Active and past elections |
| **Admin Hours** | Log administrative work hours (if module enabled) |
| **Minutes** | Meeting minutes and records |
| **Action Items** | Tasks assigned to you from meetings |
| **Notifications** | Notification preferences and history |

> **Screenshot placeholder:**
> _[Screenshot of the sidebar navigation expanded, showing the member-facing section with all menu items visible. Highlight the expandable sub-menus under Training and Operations]_

### Administration Section

If you have administrative permissions (officers, IT Manager, etc.), you will see an additional **Administration** section below the member links:

| Menu Item | Description |
|-----------|-------------|
| **Department Setup** | Guided checklist for initial configuration |
| **Members Admin** | Prospective members, pipeline, member management |
| **Events Admin** | Create events, view analytics |
| **Training Admin** | Review submissions, manage requirements, compliance |
| **Inventory Admin** | Manage items, view member equipment |
| **Forms** | Build and manage custom forms |
| **Integrations** | Connect to external services |
| **Reports** | Generate department reports |
| **Organization Settings** | Organization settings, roles, public portal |

> **Screenshot placeholder:**
> _[Screenshot of the sidebar with the Administration section expanded, showing all admin-only menu items]_

### Personal Section

Below the member-facing pages and above the Administration section, you will find:

- **My Account** (`/account`) - Your personal profile, password, appearance, and notification settings
- **Theme** - Switch between light and dark mode (also available in My Account > Appearance)
- **Sign Out** - Log out of the system

> **Note:** My Account is accessible to all users and is separate from the Organization Settings, which are only visible to administrators.

---

## Your Dashboard

The dashboard is your landing page after login. It provides an at-a-glance view of what matters most:

- **Quick Stats** - Total members, active members, upcoming events, training completion rates
- **Upcoming Events** - The next few scheduled events
- **Upcoming Shifts** - Your next assigned shifts
- **Recent Activity** - Latest actions across the department
- **Notifications** - Unread alerts and reminders with **Clear All** and individual dismiss (X) buttons. Persistent department messages (set by administrators) cannot be dismissed by regular members and show a "Persistent" badge
- **Department Messages** - Organization-wide announcements from administrators. Persistent messages remain visible until an admin clears them

> **Screenshot needed:**
> _[Screenshot of the dashboard showing the stats cards at the top, the notification section with "Clear All" button, a persistent department message with "Persistent" badge, individual notification cards with dismiss (X) buttons, the upcoming events panel, and upcoming shifts panel]_

> **Hint:** The dashboard is personalized. Officers and administrators see additional summary cards with department-wide metrics. Regular members see their own upcoming items and assignments.

### Notification Cards (2026-03-26)

Dashboard notifications now use expandable cards:

- Click to expand and see full notification details
- Pinned notifications appear first
- Notifications are marked as read when you collapse the card (not when you expand it)
- Each notification shows context-aware action buttons:
  - Shift notifications → "View Shift" button
  - Equipment check reminders → "Start Checklist" button
  - Other notifications → "View Details" or link to relevant page

Clicking a shift notification takes you directly to the scheduling page with the correct tab and shift selected.

> **Screenshot needed:**
> _[Screenshot of the dashboard notifications section showing 2-3 expandable notification cards: one pinned (with pin icon) and expanded showing shift assignment details with a "View Shift" button, and one collapsed showing just the summary text]_

> **Edge case:** If you expand a notification card to read it but navigate away before collapsing, the notification remains unread.

---

## Account Settings

To update your personal settings, click **My Account** in the sidebar. This takes you to `/account`, which is separate from the organization settings.

From here you can:

- Update your **email** and **phone number**
- Set your **notification preferences** (email, event reminders, training alerts)
- Change your **password**
- View your **assigned roles and permissions**

> **Screenshot placeholder:**
> _[Screenshot of the Account Settings page showing the profile section, notification preferences toggles, and the change password section]_

---

## Login & Session Edge Cases

| Scenario | What Happens |
|----------|-------------|
| Too many failed login attempts | After 5 failed attempts within 60 seconds, you are locked out for 30 minutes. The lock screen shows a countdown. |
| Forgot password, requested reset twice | Only the first request sends an email. Subsequent requests within 30 minutes return a success message but no email is sent — this is an anti-enumeration security measure. Wait 30 minutes or use the first email link. |
| Session expires while working | Your access token expires after 30 minutes of inactivity. The system automatically refreshes it in the background. If the refresh fails, you are redirected to the login page. |
| Multiple tabs open | Keep the number of open tabs reasonable. If your session refreshes simultaneously in multiple tabs, a race condition can log you out of all tabs. Refreshing the page resolves this. |
| Admin changed your role while logged in | The server enforces the new permissions immediately. However, menu items and buttons may not update until you refresh the page. |
| "Too many requests" error | Rate limiting is active. Wait for the duration shown in the error message before trying again. |

---

## Getting Help

- **Forgot your password?** Use the "Forgot Password?" link on the login page. You will receive a reset link by email. If no email arrives, wait 30 minutes and try again (a cooldown prevents duplicate emails).
- **Locked out?** Wait for the lockout period to expire (30 minutes), or ask your IT Manager to unlock your account.
- **Missing a module?** Some modules may be disabled by your department. Contact your administrator to enable them.
- **Permission denied?** If you see a "Not Authorized" message, the action requires a role you have not been assigned. Contact your officer or IT Manager.
- **Something looks wrong?** Your department may have an error monitoring dashboard (Settings > Error Monitor) where administrators can review issues.

---

**Next:** [Membership Management](./01-membership.md)
