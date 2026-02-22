# Documents, Forms & Communications

The Documents module provides centralized file storage for SOPs, policies, and shared documents. The Forms module is a visual form builder for collecting structured data. The Communications module covers notifications, department-wide messages, and external integrations.

---

## Table of Contents

### Documents
1. [Documents Overview](#documents-overview)
2. [Folders and Organization](#folders-and-organization)
3. [Uploading and Managing Documents](#uploading-and-managing-documents)

### Custom Forms
4. [Forms Overview](#forms-overview)
5. [Building a Form](#building-a-form)
6. [Publishing and Sharing Forms](#publishing-and-sharing-forms)
7. [Viewing Submissions](#viewing-submissions)

### Communications
8. [Notifications](#notifications)
9. [Department Messages](#department-messages)
10. [External Integrations](#external-integrations)
11. [Troubleshooting](#troubleshooting)

---

## Documents Overview

Navigate to **Documents** in the sidebar to access the department's document library.

The Documents page provides:
- **Folder tree** on the left for navigation
- **File list** on the right showing documents in the selected folder
- **Grid and List view** toggles
- **Search** across all documents

> **Screenshot placeholder:**
> _[Screenshot of the Documents page showing the folder tree on the left (with folders like "SOPs", "Policies", "Training Materials", "Meeting Minutes"), the file list on the right with document names, types, dates, and a search bar at the top]_

---

## Folders and Organization

Documents are organized into folders. The system provides default folders, and administrators can create additional ones.

**System Folders** (created automatically):
- SOPs
- Policies
- Training Materials
- Forms
- Templates

### Creating Folders

**Required Permission:** `documents.manage`

1. Click **New Folder** in the folder tree.
2. Enter the folder name.
3. Optionally set a parent folder for nesting.
4. Save.

> **Screenshot placeholder:**
> _[Screenshot of the New Folder dialog showing the folder name field and parent folder dropdown]_

---

## Uploading and Managing Documents

### Uploading Files

1. Navigate to the target folder.
2. Click **Upload** or drag and drop files into the file area.
3. The file is uploaded and added to the current folder.

### Document Actions

- **Download** - Download the file to your device
- **Move** - Move to a different folder
- **Rename** - Change the document name
- **Delete** - Remove the document (requires permission)

> **Screenshot placeholder:**
> _[Screenshot showing the upload interface with a drag-and-drop zone, and a document row with action buttons (download, move, rename, delete) visible on hover]_

> **Hint:** Events automatically create a document folder for attachments. Training sessions and meetings can also have linked documents.

---

## Forms Overview

Navigate to **Forms** in the sidebar (under Administration) to access the form builder.

Custom forms let you collect structured data for:
- Incident reports
- Equipment inspections
- Shift reports
- Member applications
- Surveys and feedback
- Any custom data collection need

> **Screenshot placeholder:**
> _[Screenshot of the Forms listing page showing created forms with name, status (Active/Draft), submission count, and action buttons (Edit, View Submissions, Share)]_

---

## Building a Form

**Required Permission:** `forms.manage`

### Creating a New Form

1. Click **Create Form**.
2. Enter the form **title** and **description**.
3. Select a **category** (or create a custom one).

### Adding Fields

The form builder supports these field types:

| Field Type | Description |
|-----------|-------------|
| **Text** | Single-line text input |
| **Textarea** | Multi-line text area |
| **Number** | Numeric input |
| **Email** | Email address with validation |
| **Phone** | Phone number input |
| **Date** | Date picker |
| **Time** | Time picker |
| **Select** | Dropdown selection |
| **Multi-Select** | Multiple choice selection |
| **Radio** | Single choice radio buttons |
| **Checkbox** | Boolean checkbox |
| **File Upload** | File attachment |
| **Signature** | Digital signature capture |
| **Section Header** | Visual divider with heading |
| **Hidden** | Hidden field for metadata |
| **Calculated** | Auto-calculated from other fields |

For each field, configure:
- Label and help text
- Required or optional
- Validation rules (min/max, pattern)
- Default value
- Conditional visibility (show/hide based on other field values)

> **Screenshot placeholder:**
> _[Screenshot of the form builder showing a form being designed with a drag-and-drop field list on the left, the form preview in the center with several fields already placed, and the field configuration panel on the right showing label, type, required toggle, and validation options]_

### Form Templates

The system includes pre-built templates:
- Incident Report
- Shift Report
- Equipment Inspection
- Vehicle Check

Select a template to start with a pre-configured form that you can customize.

---

## Publishing and Sharing Forms

### Internal Forms

Internal forms are accessible only to logged-in members:

1. Set the form status to **Active**.
2. Share the form link with members.
3. Members can fill out and submit the form from within The Logbook.

### Public Forms

Public forms can be accessed without a login:

1. Enable **Public Access** on the form.
2. The system generates a **public URL** and **QR code**.
3. Share the URL or QR code externally.
4. Submissions are collected and linked to the form.

> **Screenshot placeholder:**
> _[Screenshot showing the form sharing options with the internal link, the public access toggle, the public URL, and a QR code that can be printed or downloaded]_

> **Hint:** Public forms are great for community feedback, mutual aid incident reports, or application forms linked from your department's public portal.

---

## Viewing Submissions

1. Navigate to the form in the Forms list.
2. Click **View Submissions**.
3. Browse submissions in a table view with all field values.
4. Click any submission to view the full response.
5. **Export to CSV** for external analysis or reporting.

> **Screenshot placeholder:**
> _[Screenshot of the form submissions table showing rows of responses with timestamps, key field values as columns, and export/filter controls at the top]_

---

## Notifications

Navigate to **Notifications** in the sidebar to manage your notification preferences and view notification history.

### Notification Rules

Notification rules define when and how you are alerted. Rules can be set for:

| Trigger | Description |
|---------|-------------|
| **Event Reminders** | Alerts before upcoming events |
| **Training Expiry** | Warnings when certifications are expiring |
| **Schedule Changes** | Alerts for shift changes or new assignments |
| **New Members** | Notification when a new member is added |
| **Maintenance Due** | Alerts for upcoming equipment or facility maintenance |
| **Form Submissions** | Alerts when a form receives a new submission |

### Managing Your Preferences

1. Navigate to **Notifications > Rules**.
2. Toggle notifications on/off for each trigger type.
3. Choose delivery method: email, in-app, or both.

> **Screenshot placeholder:**
> _[Screenshot of the Notification Rules page showing a list of notification triggers with toggles for email and in-app delivery, and a "Notification Log" tab showing recent notifications]_

### Notification Log

The **Log** tab shows your notification history including:
- Date and time
- Notification type
- Message content
- Delivery status

---

## Department Messages

**Required Permission:** `notifications.manage`

Officers can broadcast messages to the entire department or targeted groups:

1. Navigate to **Notifications**.
2. Switch to the **Messages** tab.
3. Click **New Message**.
4. Set the **priority** (Normal, Important, Urgent).
5. Choose the **target**: All Members, specific roles, or individual members.
6. Write the message.
7. Send.

Members receive the message as an in-app notification and optionally by email.

> **Screenshot placeholder:**
> _[Screenshot of the department messages interface showing the compose form with priority selector, target audience dropdown, message body editor, and a list of previously sent messages below]_

---

## External Integrations

Navigate to **Integrations** in the sidebar to configure connections with external services.

### Available Integrations

| Integration | Description |
|------------|-------------|
| **Google Calendar** | Sync events to Google Calendar |
| **Outlook** | Sync events to Outlook Calendar |
| **Slack** | Post notifications to Slack channels |
| **Discord** | Post notifications to Discord channels |
| **CSV Export** | Scheduled data exports |
| **iCal Feed** | Subscribe to events in any calendar app |

### Setting Up an Integration

1. Navigate to **Integrations**.
2. Click on the integration you want to configure.
3. Follow the setup steps (typically involves authorizing access or entering a webhook URL).
4. Configure which events or triggers should use this integration.
5. Test the connection.

> **Screenshot placeholder:**
> _[Screenshot of the Integrations page showing available integrations as cards with logos, connection status (Connected in green, Not Connected in gray), and a Configure button]_

> **Hint:** Calendar integrations use iCal feeds. After connecting, events from The Logbook will appear in your personal calendar app automatically.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot upload a document | Check file size limits (configured by your department). Verify you have permission to upload to the selected folder. |
| Form not accepting submissions | Ensure the form status is **Active**. Draft forms cannot receive submissions. |
| Public form URL not working | Verify that Public Access is enabled on the form. The form must be in Active status. |
| Not receiving email notifications | Check your notification preferences in My Account > Notifications. Verify your email address is correct. Check your spam folder. |
| Slack integration not posting | Verify the webhook URL is correct and the Slack channel exists. Check the integration logs for errors. |
| Calendar events not syncing | Ensure the calendar integration is connected. Some calendar apps cache iCal feeds and may take up to 24 hours to refresh. |

---

**Previous:** [Apparatus & Facilities](./06-apparatus-facilities.md) | **Next:** [Administration & Reports](./08-admin-reports.md)
