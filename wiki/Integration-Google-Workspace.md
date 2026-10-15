# Google Workspace Integration

_(Added 2026-10-15)_

The Google Workspace integration gives each applicant the department converts
to a member a Google Workspace account at their department email address —
the address The Logbook already generates from **Organization Settings →
Department Email**. The account is created after the conversion commits, so a
Google failure never undoes a conversion; it is shown on the member's profile
with a **Retry**.

---

## Key Features

- **Account at conversion** — both the manual **Convert** button and automatic conversion on pipeline approval create the account
- **Org unit and groups** — new accounts go into a configured organizational unit and can be added to up to 20 groups
- **Password to the personal address** — the temporary Google password rides in the welcome email (as its own card, so customized welcome templates need no edits) or, when no welcome email is sent, in an email of its own; both go to the member's personal address, since the new mailbox cannot receive the password that opens it. It is never stored
- **Existing accounts are left alone** — if the address already belongs to an account, alias or group, The Logbook records the link and changes nothing
- **Administrator only** — connecting, changing or disconnecting needs `admin.access` in addition to `integrations.manage`

---

## Setting It Up

1. In **Organization Settings → Department Email**, turn on department email addresses for your Workspace domain. Connecting is refused until this matches the integration's domain.
2. In Google Cloud, create a project, enable the **Admin SDK API**, create a service account and download a **JSON key**.
3. In the Google Admin console, open **Security → API controls → Domain-wide delegation**, add the service account's **client ID**, and authorize these scopes:
   ```
   https://www.googleapis.com/auth/admin.directory.user
   https://www.googleapis.com/auth/admin.directory.group.member
   ```
4. In The Logbook, open **Integrations → Google Workspace → Connect**, choose the key file, and enter the admin to act as (a Workspace admin allowed to create users and manage groups), the domain, the organizational unit (for example `/Members`) and any groups.
5. Click **Test**. It lists one user and reads each group — nothing is created.

Each account created uses a Workspace license. Workspace for Nonprofits is free for eligible departments.

---

## Account States

| State            | Meaning                                                                | Retry does                                                                     |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Being created    | Recorded with the conversion; Google not yet called (or it crashed)    | Creates the account and emails its password                                    |
| Created          | The account exists                                                     | Re-adds failed groups; resets and resends a password the member never received |
| Existing account | The address already belonged to an account, alias or group             | Nothing — manage it in the Google Admin console                                |
| Not created      | Google refused (licenses, delegation, org unit…) — the reason is shown | Creates the account and emails its password                                    |

A retry runs at most once a minute per member.

---

## API Endpoints

```
GET    /api/v1/integrations/google-workspace/members/{user_id}         # The member's account record, or account: null
POST   /api/v1/integrations/google-workspace/members/{user_id}/retry   # Finish whatever is incomplete
```

Both require `members.manage` and are scoped to the caller's organization. The
integration itself uses the standard `/api/v1/integrations/{id}/…` routes.

---

## Not Covered

- Suspending or deleting the account when a member leaves — manage that in the Google Admin console.
- Renaming the account when a member's name changes.
