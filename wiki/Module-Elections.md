# Elections Module

The Elections module provides a complete election management system with ranked-choice voting, audit logging, and ballot forensics.

---

## Key Features

- **Ranked-Choice Voting** — Members rank candidates by preference; automatic runoff rounds
- **Multiple Election Types** — Officer elections, bylaw votes, membership approvals
- **Ballot Forensics** — Tamper-proof audit trail for every ballot cast
- **Election Packages** — Auto-generated from prospective member pipeline stages
- **Voting Eligibility** — Based on meeting attendance percentage and membership tier
- **Secret Ballots** — Encrypted ballots with anonymous vote verification
- **Real-Time Results** — Live tallying with round-by-round breakdowns
- **Audit Logging** — Complete trail of election creation, voting, and result certification
- **Meeting Link** — Elections can be linked to formal meeting records for procedural compliance
- **Voter Overrides** — Secretary can grant voting eligibility overrides for individual members
- **Proxy Voting** — Proxy voting authorization management for absent members
- **Ballot-Item Elections** — Support for elections with only ballot items (approval votes, resolutions) and no candidates

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/elections` | Elections List | Authenticated |
| `/elections/:id` | Election Detail | Authenticated |
| `/ballot` | Ballot Voting | Public (token-based) |

---

## Workflow

1. **Create Election** — Set title, type, candidates, voting period, eligibility rules, and optionally link to a meeting record
2. **Open Voting** — Members receive ballot access via in-app notification or email link (ballot-item-only elections supported)
3. **Cast Ballots** — Members rank candidates (ranked-choice) or vote yes/no
4. **Close Voting** — Automatically at the scheduled end time or manually by admin
5. **Certify Results** — Admin reviews results, round-by-round tallies, and certifies the outcome
6. **Archive** — Election and all ballots are preserved for audit

---

## API Endpoints

```
GET    /api/v1/elections                     # List elections
POST   /api/v1/elections                     # Create election
GET    /api/v1/elections/{id}                # Get election details
PATCH  /api/v1/elections/{id}                # Update election
POST   /api/v1/elections/{id}/vote           # Cast ballot
GET    /api/v1/elections/{id}/results        # Get results
POST   /api/v1/elections/{id}/certify        # Certify results
POST   /api/v1/election-packages             # Create election package
GET    /api/v1/elections/{id}/voter-overrides  # Get voter overrides
POST   /api/v1/elections/{id}/voter-overrides  # Grant voter override
GET    /api/v1/elections/{id}/proxy-votes      # Get proxy authorizations
POST   /api/v1/elections/{id}/proxy-votes      # Authorize proxy vote
```

---

## Recent Fixes (2026-02-27)

- **Election detail page fix**: Route param mismatch (`:id` vs `electionId`) caused the detail page to hang on loading; now correctly loads
- **Ballot-item elections**: `open_election` no longer requires candidates, allowing approval votes and resolutions to proceed
- **Close election errors**: Returns descriptive messages instead of misleading "Election not found" for wrong-status elections
- **Voter overrides API**: Frontend correctly handles `{ overrides: [...] }` response shape

---

**See also:** [Prospective Members](Module-Prospective-Members) | [Role System](Role-System)
