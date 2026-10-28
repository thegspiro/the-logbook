# Microsoft 365 Integration

_(Added 2026-10-17)_

The Microsoft 365 integration gives each applicant the department converts to
a member a Microsoft 365 account at their department email address — the
address The Logbook already generates from **Organization Settings →
Department Email** — licenses it, and adds it to the groups you choose. It is
the Microsoft counterpart of the
[Google Workspace integration](Integration-Google-Workspace), and works the
same way: the account is created after the conversion commits, so a Microsoft
failure never undoes a conversion, and it is shown on the member's profile
with a **Retry**.

A department connects **one** of Google Workspace and Microsoft 365. Connecting
either is refused while the other is connected.

> **Tested against Microsoft's documented API only.** The Microsoft Graph calls
> are covered by automated tests against recorded Graph responses, not yet
> against a live tenant. Before relying on it, work through
> [Verifying Against a Real Tenant](#verifying-against-a-real-tenant). See
> [Known Limitations](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md).

---

## Key Features

- **Account at conversion** — both the manual **Convert** button and automatic conversion on pipeline approval create the account
- **License and groups** — a configured license is assigned to each new account (an account has no mailbox until it is licensed), and the account joins up to 20 security or Microsoft 365 groups
- **Password to the personal address** — the temporary password rides in the welcome email or an email of its own, to the member's personal address, and Microsoft asks for a new one at first sign-in. It is never stored
- **Existing accounts are linked, not changed** — if the address already belongs to an account, The Logbook records the link and changes nothing except blocking sign-in when the member leaves
- **Blocked on departure** — dropping or deleting a member blocks sign-in and ends the account's active sessions; undoing the drop, a rejoin or a reactivation lifts a block The Logbook applied. The mailbox and license are kept
- **On-premises accounts are left to Active Directory** — an account synced from on-premises Active Directory cannot be changed from Microsoft 365, so The Logbook says so rather than retrying
- **Administrator only** — connecting, changing or disconnecting needs `admin.access` in addition to `integrations.manage`

---

## Setting It Up

1. In **Organization Settings → Department Email**, turn on department email addresses for a domain that is **verified** in your Microsoft 365 tenant. Connecting is refused until this matches the integration's domain.
2. In the **Microsoft Entra admin center**, open **App registrations → New registration**. Single tenant is right. Note the **Application (client) ID** and **Directory (tenant) ID** on its Overview page.
3. Under **Certificates & secrets**, add a **client secret** and copy its **Value** (not its ID). Note its **Expires** date: provisioning stops on that day until a new secret is entered. Enter it as **Client secret expires on** in step 6, and The Logbook warns before it (see [Client secret expiry](#client-secret-expiry)).
4. Under **API permissions → Add a permission → Microsoft Graph → Application permissions**, add the following, then click **Grant admin consent**:

   | Permission                           | Why                                                                                 |
   | ------------------------------------ | ----------------------------------------------------------------------------------- |
   | `User.ReadWrite.All`                 | Create accounts, read them, block and unblock sign-in                               |
   | `User-PasswordProfile.ReadWrite.All` | Set the temporary password on a retry                                               |
   | `User.RevokeSessions.All`            | End a departed member's active sessions                                             |
   | `GroupMember.ReadWrite.All`          | Add new accounts to groups, and let **Test** read the groups                        |
   | `LicenseAssignment.ReadWrite.All`    | Only with a license configured: assign it, and let **Test** read your subscriptions |

5. Under **Roles and administrators → User Administrator → Add assignments**, assign the role to the application. Microsoft's documentation does not settle whether resetting a password with application permissions also needs this role; granting it avoids a retry failing for that reason.
6. In The Logbook, open **Integrations → Microsoft 365 → Connect** and enter the tenant ID, client ID, client secret, the domain, the **usage location** (the two-letter country every new account gets; Microsoft will not license an account without one — `US` by default), an optional **license SKU ID**, and any groups.
7. Click **Test**. It checks the credentials, reports the license and how many are left, and reads each group — nothing is created.

### Licensing

Either name a license, or license by group:

- **A license SKU ID.** Find it in the Microsoft 365 admin center under **Billing → Licenses**, or with Graph's `subscribedSkus`. The Logbook assigns it to each account it creates. If it cannot (none left, or a country the license is not sold in), the account is kept, the profile says it has no license yet, and **Retry** assigns it later.
- **Group-based licensing.** Leave the SKU empty and add a group that has a license assigned in Entra ID. Microsoft licenses the account when The Logbook adds it to the group. Group-based licensing needs Entra ID P1, which some plans (such as Business Premium) include.

### Groups

Each group is a **security group** or a **Microsoft 365 group**, named by its object ID — a security group has no address — or a Microsoft 365 group's address. **Test** rejects:

- **Distribution lists and mail-enabled security groups** — Exchange owns their membership, and Microsoft Graph cannot change it.
- **Dynamic groups** — a rule decides their members.

---

## Account States

| State            | Meaning                                                                         | Retry does                                                                          |
| ---------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Being created    | Recorded with the conversion; Microsoft not yet called (or it crashed)          | Creates the account and emails its password                                         |
| Created          | The account exists                                                              | Assigns a missing license, re-adds failed groups, resends a password never received |
| Existing account | The address already belonged to an account (its sign-in name or primary email)  | Nothing — manage it in the Microsoft 365 admin center                               |
| Not created      | Microsoft refused (permissions, password policy, domain…) — the reason is shown | Creates the account and emails its password                                         |

Every account The Logbook creates carries `the-logbook-member:<id>` in
**Exchange custom attribute 15** (`extensionAttribute15`), written in the same
request that creates the account. It is how a retry recognises an account an
earlier attempt created whose answer from Microsoft never arrived; anything
else at the address is linked as an existing account and never changed. If
your tenant already uses custom attribute 15 for something else, accounts The
Logbook creates will carry its value there instead.

---

## When a Member Leaves or Returns

The same events as Google Workspace: a drop or delete blocks sign-in (and ends
active sessions); undoing the drop, a rejoin or a reactivation unblocks an
account The Logbook blocked. On-leave, inactive and Logbook-suspended members
keep their account, and so do retired members unless **Block sign-in when a
member retires** is turned on in the integration's settings (it works as the
Google Workspace setting does). A member's name change renames an account The Logbook
created (display name included; never the sign-in name or address), as on
Google Workspace; one synced from Active Directory is renamed there. A
departure also takes an account The Logbook created out of the configured groups and a return puts it back, as on Google
Workspace, except that **a group that assigns licenses is never touched**:
removing the member would take the license, and Microsoft deletes an
unlicensed mailbox after its grace period. A group whose licenses Graph does
not report is left alone the same way. An account that was already
blocked when the member left stays blocked when they return.

**Accounts synced from on-premises Active Directory** cannot be blocked from
Microsoft 365. The Logbook marks the account, shows "disable the account in
Active Directory" on the member's profile and in **N need attention**, and stops
retrying — that message is in the daily email to administrators too. Once the
account has been disabled in Active Directory, or moved to the cloud, **Retry**
looks again.

**An account unblocked in the admin center after the member left** is blocked
again by the same daily check as Google Workspace
(`directory_account_departure_check`, 7:28), logged as
`microsoft_365.account_active_after_departure`, and named in that morning's
email to administrators. Accounts flagged as synced from Active Directory are
not checked; see the Google Workspace page for the details.

---

## Members Added Outside the Pipeline

**Add Member** offers **Create a Microsoft 365 account**, and every member it
or a roster import adds is linked to an account already at their address, as
for Google Workspace — see
[Members Added Outside the Pipeline](Integration-Google-Workspace#members-added-outside-the-pipeline).
Linking matches the sign-in name or the primary email address, under the
rules below.

---

## Members Who Joined Before the Integration

**Integrations → Microsoft 365 → Link existing members** links current members
to the accounts already at their addresses, as for Google Workspace. A member
is linked when their **Logbook email** is an account's **sign-in name**
(user principal name) or its **primary email address**. If one account matches
two members — one by sign-in name, the other by email — neither is linked, and
both are counted as an account still recorded for another member: one account
is only ever governed by one member. Nothing changes in Microsoft 365.

---

## Client Secret Expiry

An Entra ID client secret lasts at most 24 months, and when it lapses every account change fails until a new one is entered. Record its **Expires** date as **Client secret expires on** in the integration's settings. From 30 days before it:

- the Microsoft 365 card on **Integrations** says how many days are left (or that it has expired);
- the administrators' morning email (`google_workspace_attention_digest`, 7:35) warns once at 30 days, once at 7 and once on the day, and repeats the line in any other email it sends while the date is that close.

When you create the replacement secret, enter its value **and** its new expiry date together; a new date starts the warnings over. The Logbook does not read the date from Microsoft, because that needs the Application.Read.All permission, which can read every app registration in the tenant.

---

## API Endpoints

The member, attention and link endpoints are shared with Google Workspace and
keep their original paths; each answers for whichever directory the member's
record, or the connected integration, belongs to.

```
GET    /api/v1/integrations/google-workspace/members/{user_id}          # The account record (provider, provider_name), or account: null
POST   /api/v1/integrations/google-workspace/members/{user_id}/retry    # Finish whatever is incomplete
GET    /api/v1/integrations/google-workspace/attention                  # Accounts needing a person to act
POST   /api/v1/integrations/google-workspace/link-existing?apply=false   # Preview; apply=true&expected=N links exactly N
```

---

## Verifying Against a Real Tenant

Every Graph call in the test suite answers from recorded responses built from
Microsoft's documentation. Run the integration once against your own tenant
before relying on it, ideally with a spare license and two test groups: one
ordinary Microsoft 365 group, and one that assigns a license (group-based
licensing). Each step names what it proves; if one fails, stop and report the
message the member's profile or **Test** shows.

1. **Connect and Test.** Enter the tenant, client ID, secret, domain, license
   SKU (or none, for group-based licensing), both groups, and the secret's
   **Expires** date. **Test** should report the license with the number left,
   and each group. Change one group to an address that does not exist and
   **Test** again: it should say so. _Proves the permissions, the license and
   the group checks._
2. **Convert** a test applicant whose department address does not exist yet.
   The account should appear with the license (or from the licensing group),
   in both groups, and the temporary password should reach the applicant's
   personal address. Sign in once: Microsoft should ask for a new password.
   _Proves creation, licensing, groups and password delivery._
3. In the Exchange admin center, open the account's **Custom attributes**:
   attribute 15 should be `the-logbook-member:<member id>`. _Proves the
   creation tag can be set in the request that creates the account, which
   rests on documentation alone._
4. On the member's profile, **Retry** should report nothing left to do. Then
   change the member's last name in The Logbook: within a minute the account's
   display name and surname should change, and its sign-in name should not.
   _Proves renaming._
5. **Drop** the member. Within a minute sign-in should be blocked and the
   profile should say so. The account should have left the ordinary group and
   **still be in the licensing group**, with its license. _Proves blocking,
   group removal, and that Graph reports a group's licenses to this
   application (if it does not, both groups are left alone, and the profile
   shows nothing wrong: check the membership by hand)._
6. **Undo** the drop: sign-in should be unblocked and the account back in the
   ordinary group. Then block sign-in by hand in the admin center, and drop
   and undo-drop the member: the account must **stay** blocked. _Proves only
   The Logbook's own blocks are lifted._
7. Drop the member again, then unblock the account by hand in the admin
   center. The next morning (or sooner, by having a member with
   `system.run_tasks` call
   `POST /api/v1/scheduled/run-task?task=directory_account_departure_check`),
   sign-in should be blocked again, and the administrators' email should say
   the account was turned back on. _Proves the departure check._
8. Create a user by hand at another member's Logbook email, then run **Link
   existing members**: the preview should count one, and applying should link
   it without changing anything in Microsoft 365. _Proves linking, and Graph's
   "already exists" answer if you then convert an applicant at that address._
9. If any accounts are synced from on-premises Active Directory, drop a test
   member whose account is one: the profile should say to disable it in
   Active Directory, and the sweep should stop retrying. _Proves the
   on-premises error shape, which rests on documentation alone._
10. Remove the **User Administrator** role from the application, convert a
    second test applicant who never receives their password, and **Retry** on
    their profile. If the reset works, the role can stay off (see Known
    Limitations). Put it back otherwise.
11. Delete the test accounts and groups in Microsoft 365, and the test members
    in The Logbook. Note the date the run passed wherever your department
    keeps its IT records, so the next administrator knows it has been
    checked.

---

## Not Covered

- Deleting the account, or removing its license, when a member leaves — blocking sign-in keeps both. Accounts still blocked 90 days on are listed under **N need attention** instead.
- A certificate instead of a client secret.
- Switching a department from Google Workspace to Microsoft 365 moves nothing: accounts recorded for Google stay Google's, and their suspension waits until Google Workspace is connected again.
