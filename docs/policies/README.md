# Policy Skeletons (ISO/IEC 27001 documentation backbone)

An ISO 27001 audit starts from documents, not code: an information-security
policy, topic policies, a risk register, and a Statement of Applicability.
The Logbook can't write your department's policies for you — but most policy
*content* for this system is already determined by how the software works.
These skeletons pre-fill everything the platform enforces and mark every
department-owned decision with `[DEPARTMENT: ...]`.

How to use them:

1. Copy this directory into your department's document store (or keep them
   here if this repo is your source of truth).
2. Replace every `[DEPARTMENT: ...]` placeholder with your actual decision.
3. Have leadership formally adopt them (minutes + signature), and revisit
   annually — auditors check the review cadence, not just the content.
4. Evidence for each claim lives in [../COMPLIANCE.md](../COMPLIANCE.md)'s
   control inventory: policy says *what*, that table says *where in code*.

Files:

- [statement-of-applicability.md](./statement-of-applicability.md) — Annex A
  starting point
- [information-security-policy.md](./information-security-policy.md) — the
  top-level policy leadership signs
- [access-control-policy.md](./access-control-policy.md)
- [cryptography-and-key-management-policy.md](./cryptography-and-key-management-policy.md)
- [logging-and-monitoring-policy.md](./logging-and-monitoring-policy.md)
- [backup-and-continuity-policy.md](./backup-and-continuity-policy.md)

Not included (department-only, no software component): physical security,
HR/screening, supplier management, and the risk assessment itself.
