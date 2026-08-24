# Security notes — onboarding module

What this module does with credentials and uploads, and the rules to keep
holding when changing it.

> **Rewritten 2026-08-24.** The previous version of this file declared, under a
> 🔴 CRITICAL heading, that "admin passwords are currently stored in browser
> sessionStorage in plain text", and carried an unticked checklist item reading
> "Remove passwords from sessionStorage". **Neither was true any more.** The
> code it described had been replaced by the exact pattern the same document
> recommended as the fix, and `utils/storage.ts` had already demoted those keys
> to a cleanup-only list.
>
> A security document asserting a live critical vulnerability that does not
> exist is not a harmless stale file. It sends a reader hunting for a hole that
> was closed, and it teaches them to discount the next warning this module
> raises. It is corrected here rather than deleted so that anyone who read the
> old claim can see what actually happened.

## Credentials never touch client storage

The admin password is posted straight to the backend and cleared from memory in
the same function. `services/api-client.ts` → `createSystemOwner`:

```typescript
const response = await this.request(..., '/onboarding/system-owner', data, true);

// SECURITY: Clear password from memory immediately
data.password = '';
data.password_confirm = '';
```

The final argument is `requiresCSRF`. Auth comes back as **httpOnly cookies set
by the backend**; the only thing the browser keeps is a `has_session` flag in
`localStorage`, which exists so a page reload knows whether to attempt session
validation. It is a boolean, not a credential.

That matches the app-wide rule in CLAUDE.md: **tokens live in httpOnly cookies,
never in `localStorage`, `sessionStorage`, or JS-reachable state, and no
request carries an `Authorization` header.**

### What browser storage actually holds

Two mechanisms write, and a security inventory has to name both — an earlier
version of this section listed only the first and called it complete.

**`sessionStorage`, written directly (tab-scoped, gone when the tab closes):**

| Key                                                                                              | Contents                                                        |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `departmentName`, `logoData`, `hasLogo`                                                          | Display data for the wizard's own header                        |
| `emailConfigMethod`                                                                              | The **method** — `oauth` or `apppassword`. Never the credential |
| `emailConfigured`, `fileStorageConfigured`, `authConfigured`, `itTeamConfigured`, `adminCreated` | Step-completion booleans                                        |
| `onboarding_session_id`, `onboarding_csrf_token`                                                 | Session handles                                                 |

**`localStorage`, written by the Zustand `persist` middleware — this one
outlives the tab:**

| Key                      | Contents                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `navigationLayout`       | A UI preference                                                                                                                                                                                                                                                                                                                                                                                        |
| **`onboarding-storage`** | The store's `partialize` set: department name, logo, navigation layout, email/file-storage/auth **platform names**, the "configured" booleans, **`systemOwnerFirstName` / `systemOwnerLastName` / `systemOwnerEmail`**, `stations`, `apparatus`, `positionsConfig`, `selectedModules`, `moduleStatuses`, `modulePermissionConfigs`, and wizard progress (`currentStep`, `completedSteps`, `lastSaved`) |

No passwords. No API keys. No OAuth secrets. Provider credentials —
`googleClientSecret`, `microsoftClientSecret`, `s3SecretAccessKey`,
`authentikClientSecret`, SMTP passwords — are posted to the backend and held
server-side; the wizard keeps only the platform name and a "configured" flag.
`partialize` also excludes `sessionId`, `csrfToken`, `itTeamMembers`,
`backupEmail`, `backupPhone` and `secondaryAdminEmail` by name.

**But `onboarding-storage` does persist the installation owner's first name,
last name and email in `localStorage`**, and it survives the tab. That is not a
credential, and it is the identity the wizard is in the middle of creating — but
it is PII sitting on a shared setup machine after the browser is closed, so it
belongs in this inventory rather than being discovered later. `ResetProgressButton`
clears it; nothing else does automatically.

`modulePermissionConfigs` is persisted here too — and is read by nothing. See
**ONBOARD-1** in [`docs/KNOWN_LIMITATIONS.md`](../../../../docs/KNOWN_LIMITATIONS.md).

`utils/storage.ts` keeps the old key names in a `DEPRECATED_SENSITIVE_KEYS`
list, purely so a returning browser gets them purged:

```typescript
const DEPRECATED_SENSITIVE_KEYS = [
  'emailConfig', // Contains SMTP passwords
  'fileStorageConfig', // Contains API keys
  'authenticationConfig', // Contains OAuth secrets
  'adminUser', // Contains password
  'itTeamInfo', // Contains contact PII
] as const;
```

**That list is a cleanup mechanism, not a description of current behaviour.**
Do not read it as an inventory of what the module stores — it is an inventory
of what it must erase. Do not remove it either: a browser that ran an old build
still has those keys, and nothing else clears them.

### The rule when adding a step

A new wizard step that collects a credential posts it to the backend and keeps
**nothing but a completion flag**. If a step needs to show what was configured,
show the platform name. If it needs to prove it worked, ask the backend.

If the step adds a field to the store, decide explicitly whether it belongs in
`partialize`. Anything left out of that list stays in memory for the tab;
anything added to it is written to `localStorage` and outlives the browser
session. That list is the actual boundary, so a field added without a decision
gets persisted by default.

## Uploads

`utils/validation.ts` → `isValidImageFile`:

- **SVG is rejected.** An SVG is a document that can carry script, so it is not
  in the allowlist and must not be added to it.
- **Allowlist:** `image/png`, `image/jpeg`, `image/jpg`, `image/webp`.
- **Both** the MIME type and the filename extension are checked, so a
  double extension cannot pass as an image.
- **5 MB ceiling** (`MAX_AVATAR_SIZE` in `constants/config.ts`), with 2 MB
  recommended.

## Input handling

`utils/validation.ts` and `utils/security.ts` cover email, username (3–32),
phone, host/IP and port, plus `sanitizeTextInput` for free text — which strips
`javascript:` URLs among other things.

Password rules, from `utils/validation.ts`: **12 characters minimum**, with
uppercase, lowercase, digit and special-character classes all required, and
live strength feedback.

**Client-side validation is a courtesy to the user, never a control.** Every
one of these is enforced again on the backend, and that is the copy that
matters.

## Clickjacking is a header, not a frame-buster

The previous version of this file showed a `window.top !== window.self`
redirect and described it as implemented. **There is no such code in this
module, and there should not be.** Framing is refused by
`frame-ancestors 'none'` in the CSP that `SecurityHeadersMiddleware`
(`backend/app/core/security_middleware.py`) sets on every response — a header a
browser enforces before any script runs, rather than a script that an attacker
gets to race.

## Deployment

Anything about TLS, HSTS, security headers, rate limiting, backups, retention
or HIPAA is **not module-specific** and is not repeated here. That guidance
lives in:

- [`SECURITY.md`](../../../../SECURITY.md) — security policy and HIPAA posture
- [`docs/DEPLOYMENT.md`](../../../../docs/DEPLOYMENT.md) — production deployment
- [`CLAUDE.md`](../../../../CLAUDE.md) — the auth, CSRF and caching rules this
  module has to keep

The earlier copy of that checklist here had drifted into asserting work as
outstanding that had been done, which is how this file came to claim a critical
vulnerability it did not have.
