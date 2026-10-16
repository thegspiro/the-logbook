# Incident Response and Breach Notification Policy — Skeleton

Maps to ISO/IEC 27001 Annex A.5.24–5.28 and, where the department is a HIPAA
covered entity or business associate, 45 CFR 164.308(a)(6) (security incident
procedures) and 164.400–414 (breach notification).

**Does HIPAA apply?** Records an employer holds _as an employer_ — for
example a member's occupational screening — are excluded from the definition
of PHI. The breach clocks below are mandatory only if the department (or a
service it runs, such as EMS billing) is a covered entity or business
associate handling PHI. [DEPARTMENT: counsel's written determination.] The
procedure is written to the stricter standard so it is safe either way, and
state breach-notification laws can apply to member personal data regardless.

## Roles

| Role                         | Held by                          |
| ---------------------------- | -------------------------------- |
| Incident lead                | [DEPARTMENT: name/role]          |
| Deputy                       | [DEPARTMENT: name/role]          |
| System administrator         | [DEPARTMENT: name/role]          |
| Privacy/Security Officer     | [DEPARTMENT: name/role]          |
| Legal counsel                | [DEPARTMENT: name/contact]       |
| Communications               | [DEPARTMENT: name/contact]       |
| Cyber-insurance carrier      | [DEPARTMENT: policy no./contact] |
| Law enforcement (non-emerg.) | [DEPARTMENT: contact]            |
| Hosting/Sentry/email vendors | [DEPARTMENT: BAA status/contact] |

Anyone who suspects an incident reports it to the incident lead immediately,
by phone if email may be compromised. Reporting in good faith is never
penalised.

## 1. Detect and record

Start an incident log the moment something is suspected: date and time
(UTC), who reported it, what was seen, every action taken and by whom. The
**discovery date** is the first day the incident was known, or would have
been known by exercising reasonable diligence — not the day the
investigation concluded. Every statutory clock below starts there.

Sources the platform provides:

- Security alerts (failed-login bursts, lockouts, geo-blocks, anomalies) in
  the admin Security Alerts screen.
- The audit log, including read events for screening records, leave
  records, service history, and reads of the audit log itself.
- Audit-chain verification: `GET /security/audit-log/integrity`. A break or
  gap in the chain is itself an incident.
- Sentry error reports [DEPARTMENT: enabled? recipients?].

## 2. Contain

Do these before investigating further, and record each one:

1. Reset the affected member's password. A password reset revokes all of
   that member's sessions.
2. Deactivate the account if it cannot be trusted.
3. Block the source address using the IP security settings.
4. If keys may be exposed, follow `docs/KEY_ROTATION.md`.
5. **Preserve evidence**: export the relevant audit-log range and take a
   backup before changing anything else. Do not delete logs.

## 3. Assess

Classify severity (Critical / High / Medium / Low) per `SECURITY.md`.

For anything that may involve PHI or member personal data, document the
four-factor risk assessment of 45 CFR 164.402. An impermissible use or
disclosure is presumed to be a breach unless the assessment shows a low
probability that the data was compromised:

1. The nature and extent of the data involved, including how identifiable it
   is and the likelihood of re-identification.
2. Who used or received it.
3. Whether it was actually acquired or viewed. The audit log's read events
   are the evidence for this factor.
4. How far the risk has been mitigated.

Data that was encrypted to the platform's standard and whose key was not
exposed is not "unsecured PHI" and is outside the notification rule. Say so
in the assessment, and record which key and which fields.

## 4. Notify

All periods run from the **discovery date**, are outer limits ("without
unreasonable delay" comes first), and state law may be shorter.
[DEPARTMENT: counsel to list the state deadlines.]

| Who                                                              | When                                                                                    | Rule       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------- |
| Affected individuals (first-class mail, or email if they agreed) | Without unreasonable delay, no later than 60 calendar days                              | 164.404    |
| HHS, 500 or more individuals                                     | At the same time as individual notice                                                   | 164.408(b) |
| HHS, fewer than 500 individuals                                  | Log it; report no later than 60 days after the end of the calendar year                 | 164.408(c) |
| Media, more than 500 residents of one state                      | Without unreasonable delay, no later than 60 calendar days                              | 164.406    |
| Covered entity, if the department is a business associate        | Without unreasonable delay, no later than 60 calendar days                              | 164.410    |
| Law enforcement hold                                             | Notice may be delayed only on a law-enforcement request, in writing or recorded if oral | 164.412    |

Notices state what happened and when, what data was involved, what the
individual should do, what the department is doing, and a contact point
(164.404(c)). Drafts are reviewed by [DEPARTMENT: counsel] before sending.

## 5. Eradicate and recover

Remove the cause, patch the vulnerability, rotate any credential that may
have been seen, restore from a clean backup if needed, then **verify audit
chain integrity after every restore**. Monitor closely for re-entry.

## 6. After the incident

Within [DEPARTMENT: 30] days of closing, hold a review: root cause, what
detected it and how late, what to change. Update the risk register and this
policy. Retain the incident log, risk assessment, and notices for **six
years** (164.414(b), 164.530(j)).

## Routine audit-log review (164.308(a)(1)(ii)(D))

[DEPARTMENT: reviewer] reviews, at least [DEPARTMENT: weekly]:

- Security alerts raised since the last review.
- Failed-login and lockout trends, and new blocked addresses.
- Reads of screening records, leave records, and service history by users
  who do not normally handle them.
- Reads of the audit log itself.
- Audit-chain integrity status.

Record the date, reviewer, and outcome. An unrecorded review did not happen
as far as an auditor is concerned.

## Exercise

Run a tabletop exercise [DEPARTMENT: annually] using a realistic scenario
(a lost officer laptop with an active session; a leaked backup), and file the
result with this policy.

[DEPARTMENT: adopted on / signature / next review]
