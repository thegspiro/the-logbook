# Full-code review — 2026-08-12

## Scope and method

This review covered the application source, tests, deployment/configuration
files, and the global stylesheet in several passes:

1. repository structure, manifests, and existing audit documentation;
2. frontend type checking and ESLint;
3. searches for unsafe DOM APIs, executable links, suppressed diagnostics,
   browser storage, debug output, and incomplete markers;
4. backend searches for command execution, unsafe deserialization, disabled TLS,
   weak hashes, broad exception handling, and incomplete implementations;
5. CSS review for hard-coded colors, viewport sizing, overflow, excessive
   specificity, print rules, responsive breakpoints, and `!important` use;
6. focused tests for the issue fixed during the review.

The repository is large and actively audited. This document records confirmed
results from this pass rather than duplicating historical findings in
`review-log.md`, `SECURITY_AUDIT.md`, and `docs/module-audit/`.

## Frontend and client security

### Fixed: untrusted external URL schemes

Several API-provided values were rendered directly as anchor `href` values.
React escapes HTML content but does not make arbitrary URL schemes safe. A
compromised or incorrectly validated API response could therefore present a
`javascript:` or `data:` link to a user.

A shared `isSafeExternalUrl` guard now parses external links and permits only
absolute HTTP and HTTPS URLs. It protects storefront payment links, grant
application and receipt links, training-registry sources, and the public
application-status action. Unit coverage includes executable, data, relative,
and malformed URL rejection.

### Reviewed without a new confirmed defect

- Authentication state stores only a non-secret session hint in local storage;
  tokens remain in HTTP-only cookies. Logout and idle-timeout paths purge
  member-local data.
- Plain-text linkification uses React text nodes and restricts matches to HTTP(S).
- New-tab links consistently use `noopener`/`noreferrer` (or `noreferrer`, which
  also prevents opener access).
- The label-print iframe copies application-generated DOM. It is not a general
  HTML-rendering boundary; user text remains escaped when React first creates
  the copied nodes.
- TypeScript and ESLint completed successfully before and after the fix.

## Backend, API, and data boundaries

### Reviewed without a new confirmed defect

- Searches found no application use of `shell=True`, unsafe YAML loading,
  disabled HTTP certificate validation, or runtime `eval`/`exec` in request
  paths. Text matches in security monitoring are detection signatures.
- Broad exception handlers remain common in service and scheduled-task code.
  Most are boundary handlers that log, roll back, isolate organizations, or
  deliberately make optional notification/integration work non-fatal. They
  should continue to receive module-level review, but bulk replacement would
  risk changing transaction and resilience behavior.
- Empty Python `__init__.py` files are package markers, not dead code.
- Numerous `None` returns are expected lookup/parser outcomes rather than
  unfinished implementations.
- Existing tests and audit records already exercise tenant scoping, error-detail
  redaction, CSRF/session behavior, cryptography, permissions, and upload/path
  validation. No contradictory implementation was confirmed in this pass.

## CSS and presentation

The global stylesheet uses centralized theme variables for light, dark, and
high-contrast modes. Hard-coded colors are concentrated in the variable
definitions, print output, and accessibility overrides. The remaining
`!important` declarations are intentional for high-contrast, reduced-motion,
print, SVG/barcode, and mobile utility overrides rather than competing normal
component rules.

Responsive breakpoints progress consistently from 640px through 1024px. Mobile
viewport rules document and handle dynamic viewport units, and print-only fixed
dimensions correspond to physical label/card sizes. No confirmed cascade,
overflow, contrast, or unreachable-selector defect was found in this pass.

## Configuration, tests, and dead-code pass

- Root and workspace scripts point at existing backend/frontend entry points.
- No zero-length implementation file was found; only expected Python package
  markers were empty.
- TODO/FIXME and diagnostic-suppression searches did not reveal a confirmed
  abandoned production path. Hook dependency suppressions remain candidates
  for focused component reviews, not safe mechanical edits.
- The Python security scanner (`bandit`) was unavailable in the environment;
  this is an explicit tooling gap, not a passing security result.

## Follow-up recommendations

1. Add Bandit (or an equivalent Python SAST job) to the pinned development/CI
   toolchain so security checks do not depend on workstation packages.
2. Apply `isSafeExternalUrl` to future API-controlled external anchors and
   validate these URL schemes server-side at write boundaries as defense in
   depth.
3. Continue the existing module-audit rotation for authorization and transaction
   semantics; static repository-wide searches cannot prove those properties.
4. Gradually replace hook-dependency suppressions with stable callbacks or
   explicit documented invariants when each affected component is changed.

## Continuation pass

The next pass traced browser-facing URL values back to their write boundaries.
Grant opportunity, program, and expenditure receipt URLs previously accepted
any string in the request schemas. Those schemas now reject non-HTTP(S),
relative, hostless, and executable URLs before persistence. The training
requirements citation view now uses the same client-side guard as the training
program registry view, closing an inconsistent second rendering path.

The subsequent schema-consistency pass extended write-boundary validation to
grant compliance submissions, campaign hero images, and fundraising event
registration links. An AST-assisted duplicate-field scan also found that the
equipment-check trend schema declared `not_applicable_count` twice and its CSV
export emitted that same bucket under both “Not Applicable” and “Not On Truck”.
The duplicate declaration and misleading duplicate CSV column were removed.

The WebSocket pass found that inventory sockets accepted browser handshakes
without checking `Origin`. HTTP CORS middleware does not process WebSocket
scopes, while the endpoint also supports query-string bearer tokens. Inventory
WebSockets now explicitly allow only configured origins, same-host browser
origins, or clients without a browser `Origin` header; cross-site and opaque
origins are rejected before authentication or upgrade.

The upload-validation pass found that event attachments silently fell back to
filename-extension checks when `python-magic` or its system library was absent.
That turned a deployment error into a content-validation bypass. Event uploads
now fail closed with a temporary-service error when magic-byte validation is
unavailable; they are never accepted based on a user-controlled extension
alone. The same fail-open pattern was present for email-template attachments;
both upload paths now share the fail-closed MIME detector.

The keyboard-focus CSS pass found five inputs that explicitly removed their
native outline without providing an equivalent visible focus indicator. The
inventory quick-add and picker wrappers now use `focus-within` rings, while the
budget selector and inline equipment-template editors use direct theme focus
rings. This keeps keyboard location visible in light, dark, and high-contrast
themes.

The in-memory import pass found that inventory CSV import and both historical
training CSV import paths read the entire request before applying any bound.
They now share a bounded upload reader, request only one byte beyond a 10MB
limit, and return HTTP 413 for oversized imports rather than buffering arbitrary
request sizes in a worker process.

The pagination pass found that event lists, event templates, RSVP/history
lists, and minutes list/search endpoints used plain integer parameters. Negative
offsets and arbitrarily large limits could reach service queries, while minutes
silently clamped values instead of documenting the actual API constraint. These
routes now use explicit `Query` bounds, and an AST regression test requires an
upper bound on every route parameter named `limit`, `page_size`, or `per_page`.

The frontend polling pass found that the analytics error-state Retry button
only changed local loading state; it never called the API again, leaving the
page permanently on its spinner. Loading is now a stable callback shared by
initial load, visibility-aware polling, and Retry, with a regression test for
failure followed by successful retry.

The backup/restore script pass found that operator-supplied archives were
extracted directly with `tar`, including a nested uploads archive restored into
the project directory. Restore and verification now use Python's `data` tar
filter, which rejects absolute paths, traversal, device nodes, and escaping
links. Regression tests cover valid extraction and a `../../` archive member.

The follow-up restore-consistency pass found that checksum files contain the
archive basename but `backup.sh` verified them from the operator's current
directory, so valid backups failed verification when invoked elsewhere. Restore
now verifies from the archive directory and rejects archives without exactly
one top-level backup directory instead of passing an ambiguous multi-line path
to later restore commands.

The backup credential-handling pass found that database passwords were passed
as `-pPASSWORD` command arguments, exposing them to process inspection, and the
`.env` loader reparsed values through `xargs`, breaking quoted or whitespace-
bearing configuration. Backup and restore now use `MYSQL_PWD`, load `.env` with
shell quoting intact, and enable strict `set -euo pipefail` behavior.

The error-monitoring pass found that every read, clear, and export API failure
was silently converted to empty data or success. Administrators could therefore
see a false “healthy” system, download an empty export, or believe logs were
cleared when the server rejected the operation. The service now propagates
failures; the page provides retry/error feedback, preserves data on failed
clear, and pauses polling in hidden tabs.

The compliance-dashboard pass found that annual-report export failures were
explicitly discarded, leaving the primary export action with no visible result
or explanation. Export now reports failures, disables itself while a request is
active, and displays progress so repeated clicks cannot start duplicate exports.
