# Ongoing Review Log

A recurring `/loop` reviews the codebase ~every 30 min for **security issues,
incomplete sections, feature improvements, and documentation gaps**. Each tick
covers one area, records findings here, fixes what's clearly correct and
low-risk (security hardening, doc fixes), and surfaces larger items (feature
work, ambiguous changes) for owner review rather than auto-implementing.

## Rotation (advances each tick)
1. Core auth & security — middleware, dependencies, security.py, CSRF, sessions
2. Documentation — README, CLAUDE.md, `.env` examples, API docs accuracy
3. Training module
4. Events module
5. Finance module
6. Inventory module
7. Elections module
8. Communications module
9. Membership / users module
10. Frontend cross-cutting security — apiCache exclusions, token handling, XSS

(After area 10, wrap back to 1.)

## Findings log

### Tick 1 — Area 1: Core auth & security
_(in progress)_
