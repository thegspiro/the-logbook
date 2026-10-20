# Google Workspace Integration

_(Added 2026-10-15)_

The Google Workspace integration gives each applicant the department converts
to a member a Google Workspace account at their department email address —
the address The Logbook already generates from **Organization Settings →
Department Email**. The account is created after the conversion commits, so a
Google failure never undoes a conversion; it is shown on the member's profile
with a **Retry**.

Departments on Microsoft 365 use the
[Microsoft 365 integration](Integration-Microsoft-365) instead; only one of
the two can be connected.

---

## Key Features

- **Account at conversion** — both the manual **Convert** button and automatic conversion on pipeline approval create the account
- **Org unit and groups** — new accounts go into a configured organizational unit and can be added to up to 20 groups
- **Password to the personal address** — the temporary Google password rides in the welcome email (as its own card, so customized welcome templates need no edits) or, when no welcome email is sent, in an email of its own; both go to the member's personal address, since the new mailbox cannot receive the password that opens it. It is never stored
- **Existing accounts are linked, not changed** — if the address already belongs to an account, alias or group, The Logbook records the link and changes nothing except suspending it when the member leaves
- **Suspended on departure** — dropping or deleting a member suspends the account; undoing the drop, a rejoin or a reactivation lifts a suspension The Logbook applied
- **Members from before the integration** — **Link existing members** links current members to the accounts already at their addresses, so those are suspended when they leave too
- **Administrator only** — connecting, changing or disconnecting needs `admin.access` in addition to `integrations.manage`

---

## Setting It Up

1. In **Organization Settings → Department Email**, turn on department email addresses for your Workspace domain. Connecting is refused until this matches the integration's domain.
2. In Google Cloud, create a project, enable the **Admin SDK API**, create a service account and download a **JSON key**.
3. In the Google Admin console, open **Security → API controls → Domain-wide delegation**, add the service account's **client ID**, and authorize these scopes:
   ```
   https://www.googleapis.com/auth/admin.directory.user
   https://www.googleapis.com/auth/admin.directory.group.member
   https://www.googleapis.com/auth/admin.directory.orgunit.readonly
   ```
   The third is read-only and used only by **Test**, to confirm the organizational unit exists. Account creation and suspension never request it, so an installation connected before it was added keeps working. Without it, **Test** still passes and adds a note naming the scope to add; the org unit is simply not checked.
4. In The Logbook, open **Integrations → Google Workspace → Connect**, choose the key file, and enter the admin to act as (a Workspace admin allowed to create users and manage groups), the domain, the organizational unit (for example `/Members`) and any groups.
5. Click **Test**. It lists one user, confirms the organizational unit exists, and reads each group — nothing is created or changed. Each failure names what to fix: delegation, an org unit that does not exist, or an unreadable group. A missing read-only scope is a note, not a failure.

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

Every account The Logbook creates carries the member's Logbook id in Google's
standard **External IDs** field (type _custom_, `the-logbook-member`). It is
how a retry recognises an account an earlier attempt created whose answer from
Google never arrived: an account at the address carrying this member's id is
The Logbook's own, and is finished; anything else at the address is linked as
an existing account and never changed. Remove the entry in the Admin console
and The Logbook treats that account as someone else's.

---

## Members Added Outside the Pipeline

**Add Member** offers **Create a Google Workspace account** while the
integration is connected. It starts unticked, because each account uses a
license and not every member added there needs one. Ticked, it works as a
conversion does:

- The member's department address is generated from their name, by the
  **Organization Settings → Department Email** format, and becomes their
  Logbook sign-in email and their Google account.
- The email typed on the form is kept as their **personal** address, which
  is where the temporary passwords go: in the welcome email, or on their own
  when an initial password is set instead. The form's label changes to
  **Personal email** while the box is ticked.
- The account is created right after the member is saved. If Google refuses,
  the member is still added, the reason is shown, and **Retry** on their
  profile finishes it.

Add Member refuses, before saving anything, when no directory is connected,
when department addresses are off, or when the typed email is on the
department domain (it would become the personal address the password is sent
to, a mailbox that may not exist yet).

Every other member added — Add Member with the box unticked, and **every row
of a roster import** — is linked automatically when their email is exactly an
account's primary address in the domain, under the same rules as **Link
existing members** below. The import never creates accounts. A lookup that
fails is logged and changes nothing; **Link existing members** picks those
members up later.

---

## Members Who Joined Before the Integration

Accounts only get a record — and so only get suspended — when The Logbook
creates or links them, at conversion or when a member is added. For members
who were already on the roster, an administrator clicks **Integrations → Google Workspace → Link
existing members**. The Logbook lists the domain's users (read only), shows
how many members it would link and why it would skip the rest, and links them
when confirmed.

A member is linked when their **Logbook email** is exactly an account's
**primary** address in the integration's domain (an alias does not count).
Skipped: members already linked, members whose account is still being set up
or failed (finish those with **Retry** on their profile), members with no
account at their address, members whose email is outside the domain, members
who have already left — linking a departed member would suspend an account
somebody may still be using, so that stays a decision for the Google Admin
console — and accounts still recorded for another member, such as a former
member whose address was reused after anonymization (one account is only ever
governed by one member). If the roster changes between the preview and the
confirmation, nothing is linked and the administrator is asked to review it
again. Linking changes
nothing in Google; it only means the account is suspended when the member
leaves. It is safe to run again, and is recorded in the audit log.

---

## API Endpoints

```
GET    /api/v1/integrations/google-workspace/attention                 # Accounts needing a person to act
GET    /api/v1/integrations/google-workspace/members/{user_id}         # The member's account record, or account: null
POST   /api/v1/integrations/google-workspace/members/{user_id}/retry   # Finish whatever is incomplete
POST   /api/v1/integrations/google-workspace/link-existing?apply=false  # Preview; apply=true&expected=N links exactly N
```

The two member routes require `members.manage`; `attention` requires
`integrations.manage`; `link-existing` requires `integrations.manage` and
`admin.access`. All are scoped to the caller's
organization. The
integration itself uses the standard `/api/v1/integrations/{id}/…` routes.

---

## When a Member Leaves or Returns

| What happens in The Logbook                                      | Google account                                 |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| Status changed to dropped (voluntary or involuntary)             | Suspended                                      |
| Member deleted (soft or permanent)                               | Suspended                                      |
| Drop undone, rejoin from dropped, or archived member reactivated | Unsuspended — only if The Logbook suspended it |
| Retired, on leave, inactive, suspended in The Logbook            | Unchanged                                      |

Both accounts The Logbook created and existing accounts it linked to are
suspended. If an account was already suspended in Google when the member left,
The Logbook records that and never lifts it. Suspending keeps the mailbox and
its license; deleting the account is left to an administrator.

Every way a member leaves or returns is covered, including ones added later:
the trigger is the member's status or deletion changing, not the screen that
changed it. The intent is recorded in the same database transaction; Google is
called just after it commits, so a Google failure never blocks the departure
and a cancelled one never reaches Google. Anything left unfinished — a worker
restart, Google being down — is picked up by the
`google_workspace_suspension_sync` scheduled task every 15 minutes (a failed
account is retried at most every 15 minutes), and the member's profile shows
"not suspended yet" with a **Retry** meanwhile. A permanent delete removes the
account record with the member, so its outcome is written to the audit log
instead. No account is ever created for a member who has left.

---

## Accounts Needing Attention

When something The Logbook could not finish on its own is waiting, the Google
Workspace card on **Integrations** shows **N need attention**. It opens a list
of those members, each linked to their profile (where the reason and **Retry**
are), most urgent first:

| Listed as                                    | Means                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Left, but the account is not suspended       | A departure's suspension Google has not taken yet                                      |
| Returned, but the account is still suspended | A return's unsuspension Google has not taken yet                                       |
| Account not created                          | Creation failed, or has been "being created" for over an hour with no answer           |
| Account setup unfinished                     | The account exists but a group was not added, or its password never reached the member |

A member who has left is listed only for their suspension: creating or
finishing their account is not wanted. One case is listed for a person to
check rather than for a retry: a member who left while their account was being
created and Google never answered. The account may exist, and with no record
of it The Logbook cannot suspend it, so it is listed as not suspended with a
note to check the Admin console.

Waiting is measured from when the record was created (or, for a suspension,
when the departure asked for it), never from the latest retry, so retrying
something that keeps failing does not keep it out of the email.

Anything waiting over a day is also emailed to every active member holding
`admin.access`, once each morning while it lasts
(`google_workspace_attention_digest`, 7:35). The email leads with departed
members whose account still works. It is filed under **Membership and store
administration** in each member's email preferences, so an administrator can
turn it off for themselves.

---

## Verifying Against a Real Workspace

Every Google call in the test suite is mocked. Before relying on the
integration, run it once against your own domain with a throwaway
organizational unit (for example `/Logbook Test`) and a test applicant:

1. **Test** the connection with the throwaway org unit configured. It should
   report the domain, the org unit and each group. Change the org unit to a
   path that does not exist and **Test** again: it should say so.
2. **Convert** a test applicant whose department address does not exist yet.
   The account should appear in the org unit and groups, and the temporary
   password should reach the applicant's personal address. Sign in once to
   confirm Google asks for a new password.
3. In the Admin console, open the account's **User information → Employee
   details**: the **External ID** of type `the-logbook-member` should be the
   member's id.
4. **Retry** on the member's profile should report nothing left to do.
5. **Drop** the member. Within a minute the account should be suspended in
   Google, and the profile should say so. **Undo** the drop: the suspension
   should be lifted.
6. Suspend the account by hand in Google, then drop and undo-drop the member:
   the account must **stay** suspended — The Logbook lifts only suspensions it
   applied.
7. Create a user by hand at another member's Logbook email, then run **Link
   existing members**: the preview should count one, and applying should link
   it without changing anything in Google.
8. Delete the test accounts and the org unit in Google, and the test member in
   The Logbook.

---

## Not Covered

- Deleting the Google account, or freeing its license, when a member leaves — suspension keeps both.
- Renaming the account when a member's name changes.
