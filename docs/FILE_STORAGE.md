# File Storage

How The Logbook stores uploaded files, how they are protected, and how access
to them is decided. The implementation is
`backend/app/services/file_storage_service.py` (layout, confinement) and
`backend/app/core/file_encryption.py` (encryption at rest).

## Layout

Every uploaded file is written by one service, under one root:

```
{UPLOAD_DIR}/{organization_id}/{area}/{entity_id}/{random}.enc
```

| Segment           | Meaning                                                                   |
| ----------------- | ------------------------------------------------------------------------- |
| `UPLOAD_DIR`      | The setting; `./uploads`, i.e. the `/app/uploads` volume in the container |
| `organization_id` | The department that owns the file — one subtree per organization          |
| `area`            | The module the file belongs to (table below)                              |
| `entity_id`       | The record the file belongs to, so a record's files sit together          |
| `{random}.enc`    | 32 random hex characters. Never the uploaded name, never its extension    |

The database stores only the **key** — the path relative to `UPLOAD_DIR` —
never an absolute path. The name the file was uploaded under is kept in the
row next to the key and is what a download is offered as.

| Area                   | Module                       | Entity                | Confined to the entity on read? |
| ---------------------- | ---------------------------- | --------------------- | ------------------------------- |
| `documents`            | Documents                    | the document          | Yes                             |
| `events`               | Event attachments            | the event             | No — see below                  |
| `training`             | Training-record attachments  | the training record   | Yes (see below)                 |
| `training-submissions` | Self-reported certificates   | the submitting member | Yes                             |
| `prospects`            | Prospective-member documents | the applicant         | Yes                             |
| `suggestions`          | Suggestion-box screenshots   | the suggestion        | Yes                             |
| `email-templates`      | Email template attachments   | the template          | Yes                             |

Two deliberate exceptions to "confined to the entity":

- **Event attachments** are confined to the organization's `events` area, not
  to one event. Recurring-occurrence generation and event duplication copy an
  attachment's metadata between events on purpose, so one file is legitimately
  referenced by several events.
- **Training records** read their own uploads and, in addition, the record
  owner's `training-submissions` files: approving a self-report copies the
  certificate onto the record. Another member's certificates are refused.

Self-reported certificates are a separate area from record uploads because the
retention sweep (`SelfReportConfig.attachment_retention_days`) deletes these
and only these.

## Encryption at rest

Every file is encrypted before it touches the disk: AES-256-GCM, in 64 KiB
chunks so a large file streams back without being held in memory. Each chunk's
nonce binds its position and whether it is the last one, and the file header is
authenticated with every chunk — so a byte changed, a chunk dropped or
reordered, or a file cut short fails to read rather than being served.

The key is an HKDF sub-key of the same key that encrypts database fields
(`ENCRYPTION_KEY` + `ENCRYPTION_SALT`). There is no separate secret to manage,
and `ENCRYPTION_KEYS_LEGACY` covers files during a rotation exactly as it covers
rows. Two consequences an operator must know:

- **Losing the key loses the files.** A backup of the uploads volume is
  ciphertext; see [BACKUP.md](./BACKUP.md).
- **A retired key stays in the ring.** `scripts/rotate_encryption_key.py`
  re-encrypts database rows, not files; see [KEY_ROTATION.md](./KEY_ROTATION.md).

Downloads are decrypted as they stream, with `Cache-Control: private,
no-store` so neither a shared cache nor the browser keeps the plaintext.

## Access

A download endpoint first decides, with the module's own rules, whether the
caller may see the **record** (the document's folder ACL, the event, the
training record's owner or `training.manage`, …). Only then does it ask the
storage service for the file, naming the organization, area and — where the
table says so — the record it expects. The service refuses any key outside
that scope before the disk is read.

That second check is what keeps access from leaking sideways. A file
reference lives in a database column, and several of those columns can be
written by a client (event and training-submission payloads carry attachment
dictionaries). Without confinement, a row that names someone else's key would
serve someone else's file behind a perfectly correct record check. With it,
holding access to one record, one module or one organization never opens a
file belonging to another. Deletes are confined the same way, so a corrupted
reference can never unlink a file it does not own.

Folder access in the Documents module is unchanged: every ancestor folder's
rules must admit the caller, so access to a parent folder grants nothing inside
a child folder that restricts itself further.

## Files stored before this layout

Files uploaded before 2026-10-11 are plaintext and recorded as absolute paths
in each module's old directory (`/app/uploads/documents/<org>/…`,
`/app/uploads/event-attachments/<org>/…`, and so on). They stay readable: each
module passes its old per-organization directory as a legacy location, and a
legacy path is accepted only inside it. Moving and encrypting those files is a
separate, operator-run step.

Email template attachments were, until this change, written to
`storage/email_attachments/` relative to the backend's working directory —
inside the container, outside the uploads volume. Ones uploaded before the
change are read from there for as long as they still exist.

## Configuration

| Setting                                                       | Effect                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `UPLOAD_DIR`                                                  | Root of all stored files. Relative values resolve against the backend's working directory (`/app` in the container). |
| `STORAGE_TYPE`                                                | Only `local` is implemented. Any other value logs a warning and files stay on local disk.                            |
| `ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `ENCRYPTION_KEYS_LEGACY` | The file key is derived from these.                                                                                  |

Adding a module that stores files means adding a `StorageArea` member and
calling `get_file_storage().save(...)` / `.open(...)` / `.delete(...)` — never
`open(path, "wb")`.
