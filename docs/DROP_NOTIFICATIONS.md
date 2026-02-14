# Drop Notifications & Email Template Configuration

**Version**: 1.0
**Last Updated**: 2026-02-14
**Module**: Member Management / Email Templates

---

## Overview

When a member's status changes to `dropped_voluntary` or `dropped_involuntary`, the system can send a formal property return notification. This document covers how to configure:

- **Who receives the notification** (the member, CC'd leadership, personal email)
- **What the message says** (editable email template with variable substitution)
- **How recipients are determined** (role-based CC, static CC list, personal email toggle)

All configuration is stored in **Organization Settings** and can be changed at any time without code changes.

---

## Quick Start

1. Go to **Settings > Organization Settings** and configure the `member_drop_notifications` section
2. Go to **Settings > Email Templates** and customize the **Member Dropped** template
3. When dropping a member via `PATCH /api/v1/users/{user_id}/status`, check **Send property return email**

---

## Organization Settings

Drop notification behavior is controlled by the `member_drop_notifications` key in your organization settings JSON. Update it via:

```
PATCH /api/v1/organization/settings
```

### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cc_roles` | `string[]` | `["admin", "quartermaster", "chief"]` | Role names whose holders are automatically CC'd on every drop notification |
| `cc_emails` | `string[]` | `[]` | Additional static email addresses always CC'd (e.g., a shared HR mailbox) |
| `include_personal_email` | `boolean` | `true` | Also send the notification to the member's `personal_email` if one is on file |
| `use_custom_template` | `boolean` | `false` | Use the organization's customized MEMBER_DROPPED email template instead of the default property return letter |

### Example: Update Drop Notification Settings

```json
PATCH /api/v1/organization/settings
{
  "member_drop_notifications": {
    "cc_roles": ["admin", "quartermaster", "chief", "secretary"],
    "cc_emails": ["hr@example.com", "records@example.com"],
    "include_personal_email": true,
    "use_custom_template": true
  }
}
```

### How CC Recipients Are Resolved

When a drop notification is sent, the system:

1. Loads `cc_roles` from organization settings (default: `["admin", "quartermaster", "chief"]`)
2. Queries all **active** users in the organization who hold any of those roles
3. Collects their email addresses (excluding the dropped member themselves)
4. Merges in any addresses from the `cc_emails` static list
5. Passes the combined list as the `Cc` header on the outbound email

CC recipients can see each other in the email headers. If you need invisible recipients, the system also supports BCC at the API level.

### Permissions Required

| Action | Required Permission |
|--------|-------------------|
| Read organization settings | Any authenticated user |
| Update organization settings | `settings.manage_contact_visibility` or `organization.update_settings` |
| Manage email templates | `settings.manage_email_templates` or `organization.edit_settings` |

---

## Personal Email

### What It Is

Each user profile now has an optional `personal_email` field, separate from the primary `email` (which is typically the department/organization email). This allows the department to reach a separated member at their personal address after their department email is deactivated.

### Setting a Member's Personal Email

Update the member's profile before or during the drop process:

```json
PATCH /api/v1/users/{user_id}
{
  "personal_email": "jane.doe.personal@gmail.com"
}
```

### Behavior During Drop

When `include_personal_email` is `true` (the default) and the member has a `personal_email` on file:

- The notification is sent to **both** the primary `email` and the `personal_email`
- Both addresses appear in the `To` field
- CC recipients are the same for both

When `include_personal_email` is `false` or no personal email is on file:

- The notification is sent only to the primary `email`

### Database

| Column | Table | Type | Nullable | Migration |
|--------|-------|------|----------|-----------|
| `personal_email` | `users` | `VARCHAR(255)` | Yes | `20260214_0800` |

---

## Email Template Management

### Default Template

A default **Member Dropped** email template is automatically created for every organization. It includes:

- A formal property return notice with department header
- Item count, total value, and return deadline
- Reason for separation and effective date
- Officer name and title

### Editing the Template

Use the Email Templates settings page or the API:

```
GET  /api/v1/email-templates              — List all templates
GET  /api/v1/email-templates/{id}         — Get a specific template
PUT  /api/v1/email-templates/{id}         — Update template content
POST /api/v1/email-templates/{id}/preview — Preview with sample data
```

### Template Variables

The `MEMBER_DROPPED` template type supports 10 variables, all using `{{variable_name}}` syntax:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `{{member_name}}` | Full name of the dropped member | Jane Doe |
| `{{organization_name}}` | Organization/department name | Springfield Fire Department |
| `{{drop_type_display}}` | Type of separation | Dropped - Voluntary |
| `{{reason}}` | Reason provided by leadership | Relocated out of district |
| `{{effective_date}}` | Date the drop takes effect | February 14, 2026 |
| `{{return_deadline}}` | Deadline to return all property | March 16, 2026 |
| `{{item_count}}` | Number of outstanding items | 5 |
| `{{total_value}}` | Total dollar value of outstanding items | 2,340.00 |
| `{{performed_by_name}}` | Name of the officer who performed the drop | Chief John Smith |
| `{{performed_by_title}}` | Title/rank of the officer | Fire Chief |

### Attachments

Templates with `allow_attachments: true` (the default for MEMBER_DROPPED) can have file attachments:

```
POST   /api/v1/email-templates/{id}/attachments          — Upload attachment
DELETE /api/v1/email-templates/{id}/attachments/{att_id}  — Remove attachment
```

**Allowed file types**: .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .txt, .csv, .png, .jpg, .jpeg, .gif, .bmp, .svg, .zip, .ics
**Max file size**: 10 MB

---

## CC/BCC Support (EmailService)

The `EmailService.send_email()` method now supports CC and BCC for all outbound emails, not just drop notifications:

| Parameter | Type | Description |
|-----------|------|-------------|
| `to_emails` | `List[str]` | Primary recipients |
| `cc_emails` | `Optional[List[str]]` | CC recipients (visible in headers) |
| `bcc_emails` | `Optional[List[str]]` | BCC recipients (invisible to other recipients) |

CC addresses are included in the `Cc` header of the email. BCC addresses receive the email but do not appear in any header.

---

## Notification Flow

When `PATCH /api/v1/users/{user_id}/status` is called with `send_property_return_email: true`:

```
1. Member status updated to dropped_voluntary / dropped_involuntary
2. Property return report generated (HTML + PDF)
3. Report saved to Documents module
4. Organization settings loaded:
   a. cc_roles → query active users with matching roles → collect emails
   b. cc_emails → merge static addresses
   c. include_personal_email → add member's personal_email to To list
5. Email sent via EmailService:
   - To: [member.email, member.personal_email (if configured)]
   - Cc: [role-based emails + static emails]
   - Subject: "Notice of Department Property Return — {org_name}"
   - Body: Property return HTML report
6. Background task completes; response.email_sent = true
```

---

## Troubleshooting

### CC Recipients Not Receiving Email

| Check | How |
|-------|-----|
| CC roles configured? | `GET /api/v1/organization/settings` — check `member_drop_notifications.cc_roles` |
| Users have those roles? | Verify role assignments in the Members section |
| Users have email addresses? | Check member profiles for populated email field |
| Email service enabled? | `organization.settings.email_service.enabled` must be `true` |

### Personal Email Not Included

| Check | How |
|-------|-----|
| Personal email on file? | Check member profile for `personal_email` field |
| Setting enabled? | `member_drop_notifications.include_personal_email` must be `true` |

### Template Not Rendering Variables

| Check | How |
|-------|-----|
| Correct syntax? | Variables must use double curly braces: `{{variable_name}}` |
| Valid variable name? | Only the 10 variables listed above are supported |
| Template active? | Check `is_active` field on the template |

### Email Not Sending At All

| Check | How |
|-------|-----|
| Email enabled globally? | Check `EMAIL_ENABLED` environment variable |
| Org email enabled? | `organization.settings.email_service.enabled` |
| SMTP configured? | Verify `smtp_host`, `smtp_port`, `smtp_user`, `smtp_password` in org settings |
| Check logs | `docker logs the-logbook-backend-1 --tail 100` for SMTP errors |

---

## Related Documentation

- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Drop notification troubleshooting entries
- [CHANGELOG.md](../CHANGELOG.md) — Feature changelog
- [TRAINING_PROGRAMS.md](./TRAINING_PROGRAMS.md) — Training module (separate notification system)

---

**Maintained by**: Development Team
**Migration**: `20260214_0800` (adds `personal_email` column to users table)
