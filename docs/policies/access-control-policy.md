# Access Control Policy — Skeleton

## Account lifecycle

- Accounts are created by administrators through the platform (no
  self-registration for members). Applicants use the separate pipeline with
  its own limited access.
- On departure: the account is deactivated as part of departure clearance;
  after [DEPARTMENT: period], personal data is anonymized via the
  platform's anonymization workflow while operational records are retained.
- Dormant accounts are reviewed [DEPARTMENT: cadence].

## Authorization

- Access is role-based. Roles map to duty positions, and permission
  changes are made only through the platform (they are audit-logged).
- The wildcard/administrator permissions are limited to
  [DEPARTMENT: named roles, e.g. Chief, IT Administrator] — no shared
  admin accounts.
- Sensitive categories (medical screening, member contact details) carry
  dedicated permissions; holding a general admin role does not imply
  medical access unless explicitly granted.

## Authentication

- Passwords: minimum 12 characters with complexity, history, and maximum
  age enforced by the platform (HIPAA-aligned settings).
- MFA (authenticator app): [DEPARTMENT: enforced org-wide via Settings →
  Authentication / required for roles X, Y]. Recovery codes are stored by
  the member, not the department.
- Sessions expire per the configured HIPAA timeout; sign-in anomalies
  (lockouts, geo-blocks) alert per the logging policy.

## Reviews

[DEPARTMENT: who] reviews role assignments and permission grants
[DEPARTMENT: cadence], using the platform's role listing and the audit
trail of permission changes as evidence.

[DEPARTMENT: adopted on / signature / next review]
