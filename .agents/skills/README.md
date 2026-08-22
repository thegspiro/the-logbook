# Application security review skills

This directory vendors the Markdown security-review playbooks from
[Deep Eye](https://github.com/zakirkun/deep-eye) at commit
`69e0c698bfcd3a0f67b97e8a60138d94f6083338`. The imported material is a
review reference: Deep Eye itself and its Python dependencies are not included.

## Using the skills in The Logbook

The application-review workflow uses these playbooks for source inspection:

1. Start with `security-ops/SKILL.md`, then select the defensive
   `blue-team/SKILL.md` workflow.
2. Load only references relevant to the feature's attack surfaces. For example,
   use `vulnerabilities/idor.md` for object-level authorization,
   `vulnerabilities/sql_injection.md` for query construction, and
   `protocols/graphql.md` only when reviewing GraphQL code.
3. Treat payloads and offensive commands as review heuristics. Do not execute
   active scans, exploit payloads, or commands against any target unless the
   target owner has provided explicit written authorization and scope.
4. Prefer repository tests and source analysis for the normal application
   review. Record evidence and dispositions using `docs/app-review/_TEMPLATE.md`.

Several upstream pages mention `python deep_eye.py`. That CLI is not vendored
here, so those examples are informational and are not part of The Logbook's
completion gate.

## Imported layout

| Path                                                                          | Purpose                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------ |
| `pentest/`, `bug-bounty/`, `red-team/`, `blue-team/`, `ctf/`, `security-ops/` | Workflow skills                                  |
| `vulnerabilities/`                                                            | Vulnerability-class playbooks                    |
| `reconnaissance/`                                                             | Reconnaissance review heuristics                 |
| `protocols/`                                                                  | Protocol-specific checks                         |
| `payloads/`                                                                   | Payload examples for recognizing unsafe handling |
| `tools/`                                                                      | Upstream Deep Eye and browser notes              |
| `technologies/`, `frameworks/`                                                | Platform-specific checks                         |

## Provenance and license

The imported files are provided under Deep Eye's MIT license. See
`THIRD_PARTY_NOTICES.md`. When refreshing the import, review the upstream diff,
update the pinned commit above and in the notice, and rerun the repository's
Markdown and secret checks before committing.
