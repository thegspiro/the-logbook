# File Storage Hardening

How uploaded files are stored, named and protected, and the phased plan for
making that consistent across modules. Opened 2026-10-08.

## Where things stood

A survey on 2026-10-08 found every upload path written independently:

| Module                      | Stored under (`/app/uploads/…`)                               | Download confined to |
| --------------------------- | ------------------------------------------------------------- | -------------------- |
| Documents                   | `documents/<org>/<uuid><ext>`                                 | the org (DOC-24)     |
| Event attachments           | `event-attachments/<org>/<event>/<uuid><ext>`                 | the org (EV-17)      |
| Suggestion screenshots      | `suggestions/<org>/<uuid>.webp`                               | the org              |
| Training-record attachments | `training_attachments/<org>/<uuid><ext>`                      | shared root only     |
| Self-reported certificates  | `training_attachments/self_reported_submissions/<org>/<uuid>` | shared root only     |
| Applicant (prospect) files  | `prospect-documents/<org>/<prospect>/<uuid><ext>`             | shared root only     |
| Email-template attachments  | `storage/email_attachments/<org>/` — **off the volume**       | no check             |

Images (member photos, logos, storefront products, equipment-check photos)
are re-encoded and stored in the database, not on disk.

The `STORAGE_TYPE`, `UPLOAD_DIR` and cloud-storage settings, and the
per-department storage choice made in onboarding, have no reader: files go
to local disk regardless (`docs/KNOWN_LIMITATIONS.md`, CI3-33-4).

## Decisions (owner, 2026-10-08)

1. **Fix the access leaks first**, as their own change.
2. **Local disk for now.** Storage is chosen per department in onboarding;
   other backends come later.
3. **Organization first** in the layout. Most installations hold one
   department, and the extra directory level costs them nothing.
4. **UUID names on disk; descriptive names for people.** What a user sees or
   downloads is named from the record (`2026-10-08_Engine-1_Pump-Test.pdf`),
   never the UUID.
5. **Each module gets its own folder, with rights specific to that area.**
6. **`documents.view` is narrowed and folder rights are tailored.** A training
   officer does not see finance receipts; a quartermaster does not see
   training certificates.
7. **Encrypt files at rest**, with onboarding requiring the department to
   confirm the encryption key is stored somewhere separate from the data and
   its backups — losing the key loses every file.
8. **Malware-scan every file that enters the platform.**
9. **Remote storage platforms are built later.** Onboarding's Google Drive,
   OneDrive / SharePoint and S3 choices have no reader yet; recorded in
   `docs/KNOWN_LIMITATIONS.md` ("File Storage — The Onboarding Platform
   Choice Has No Reader").
10. **Only full administrators (`*`) see every folder.** The
    `documents.manage` / `members.manage` override goes; everyone else
    reaches a folder only through the rights attached to it.
11. **Malware scanning is on by default.** Turning it off is possible, but
    the setting carries a strong warning and admins see a standing notice
    while it is off.
12. **Apparatus photos and documents become real documents**, filed in the
    Apparatus folder like facility files, replacing the free-text URL.
13. **Finance receipt upload is part of Phase 3**, filed in the Finance
    folder under finance rights.
14. **Phase 2 is its own pull request**, opened after Phase 1 merged.
15. **No scanner, no upload.** With scanning on, an unreachable scanner
    refuses uploads (retryable 503) rather than storing them unscanned —
    including on an install that upgrades without a running ClamAV.
16. **Existing files move by an operator-run command**, not inside a database
    migration: dry run first, checksum-verified copies, a manifest, rollback
    until finalized.
17. **Downloaded files name their member** where they belong to one
    (`2026-10-08_Smith-John_EMT-Recert.pdf`).
18. **Small hosts run ClamAV too.** Every profile requires it; an operator who
    cannot spare the memory turns it off afterwards, behind the warning.
19. **A module's folder opens to that module's rights** (2026-10-09): Training
    to `training.*`, Events to `events.*`, Apparatus to `apparatus.*`,
    Facilities unchanged, a new Finance folder to `finance.view` /
    `finance.manage` / `finance.approve`, Member Separations to
    `members.manage`; the shared library stays on `documents.view` /
    `documents.manage`.
20. **A personal folder admits its member and full administrators only.**
21. **"Leadership only" means the library managers** (`documents.manage`), and
    only for the library's own folders.
22. **A folder-access editor comes later**, in its own change; custom folders
    keep the visibility levels they have.
23. **The file key comes from `ENCRYPTION_KEY` and `ENCRYPTION_SALT`**
    (2026-10-09), the secrets already protecting encrypted fields, so there is
    no second secret to lose. Rotation reuses `ENCRYPTION_KEYS_LEGACY`, plus a
    rewrap command for files.
24. **Files stored before encryption are encrypted by an operator command**:
    dry run, a verified round trip per file, a manifest, rollback until
    finalized. Until it runs they stay readable, and administrators see a
    notice.
25. **Confirming the key is kept safe is required.** A new installation cannot
    finish setup without it; an existing one shows `settings.manage` holders a
    notice that only a confirmation clears. Who confirmed, and when, is
    recorded and audited.
26. **Encryption at rest is always on.** There is no switch.

## Phases

| Phase | Scope                                                                                                                                           | Status       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1     | Close the access leaks                                                                                                                          | done (#3009) |
| 2     | One storage service: org-first layout, descriptive names, size caps and malware scan everywhere (on by default)                                 | done (#3011) |
| 3     | A folder per module with module-specific rights; narrow `documents.view`; admin-only see-all; apparatus files and finance receipts as documents | done (#3031) |
| 4     | Encryption at rest, with the onboarding key-custody confirmation                                                                                | this change  |

### Phase 1 — what changed

| Finding                                                                                                | Fix                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Event attachment list/download needed only a session — no `events.view`, drafts readable               | Requires `events.view`/`events.manage`; a draft's files are organizers-only (404)        |
| Training-record download confined to the shared root, so another org's path under it was served        | Confined to the record's org, in the record tree or the org's self-report tree           |
| Self-report download/delete confined to the shared root                                                | Confined to the submission's org                                                         |
| Applicant download confined to the shared root; the write check accepted anywhere under `/app/uploads` | Read, write, delete and purge confined to `prospect-documents/<org>/`                    |
| Anonymization and document/folder deletes unlinked stored paths with no check                          | Unlink only inside the org's own subtree; the row is still removed                       |
| Email-template attachments written off the persisted volume (lost on rebuild, absent from backups)     | Written to `email-attachments/<org>/`; migration `2be075025403` moves existing files     |
| Email attachment reads at send time and deletes had no containment                                     | Confined to the org, accepting the legacy root for files the migration could not move    |
| Equipment-check photos could be added by any signed-in member to any check in the org                  | Requires `inventory.check_submit`/`check_manage`; only the checker unless `check_manage` |
| Event and email uploads took the extension from the filename and stored the browser's Content-Type     | Extension must match the detected content family; the detected type is stored            |
| Event downloads served the stored `file_type`, which generic event updates can write                   | Served only if it is an allowlisted type, otherwise `application/octet-stream`           |
| The uploader's original filename went to `Content-Disposition` unchecked                               | `safe_download_filename` drops directories and control characters and caps the length    |

`app/utils/upload_paths.py` holds the shared org-containment check. Phase 2
folds it into the storage service.

### Phase 2 — what changed

- **`app/services/file_storage_service.py`** is the one write path for files
  on disk: bounded read, magic-byte detection, the upload path's allowlist,
  extension/content agreement, malware scan, then a write-and-rename into
  `/app/uploads/<org_id>/<area>/<record_id>/<uuid><ext>` (directories `0750`,
  files `0640`). `resolve()` confines every read and delete to the owning
  organization's area, in the new layout or the area's legacy one.
- **Every upload is scanned** (`app/services/upload_scanning.py`): the disk
  paths through the service, and member photos, logos, storefront and
  equipment-check photos, suggestion screenshots and all six CSV imports
  directly. `tests/test_upload_scan_sweep.py` fails on a new upload endpoint
  that does not reach a scan.
- **ClamAV is required.** Every compose file starts it
  (`clamav/clamav-debian`, multi-arch, `StreamMaxLength` raised to 60M) and
  `CLAMAV_ENABLED` defaults to true. Turning it off warns in the startup log,
  in preflight and as a red notice for every administrator
  (`GET /system-notices`, `SystemNoticesBanner`).
- **Descriptive download names** (`app/utils/download_names.py`) for
  documents, event attachments, training-record and self-reported
  certificates, applicant files and suggestion screenshots; emailed template
  attachments keep their uploaded name.
- **`scripts/relocate_uploads.py`** moves existing files
  (`app/services/upload_relocation.py`).

Found and fixed while there: a training-history CSV that was not UTF-8 was
reported as "exceeds the 10MB limit" (an `except ValueError` caught the
`UnicodeDecodeError` subclass before its own handler).

Still not done, by design or for later phases: files stored before scanning
was on are not rescanned; `UPLOADS_ROOT` is the fixed `/app/uploads` mount and
the unread `UPLOAD_DIR` setting stays unread (`docs/KNOWN_LIMITATIONS.md`,
CI3-33-4).

### Phase 3 — what changed

**The access rule** (`DocumentsService._folder_admits_user`): a full
administrator (`*`) passes every folder and nothing else is an override. Each
module root carries its rights in `required_permissions` (the lists live in
`app/models/document.py`); children inherit through the ancestor walk. A
write needs a non-view right from the list, as before. Every root is built
from one definition, `system_folder_fields`, so a root a module creates lazily
matches one the reconciler creates. Migration `b38df38d849b` stamps existing
roots. `docs/UPGRADING.md` lists who gains and loses what.

**Apparatus files** are uploaded at `POST /apparatus/{id}/photos/upload` and
`/documents/upload`, scanned and filed in the vehicle's sub-folder (Photos;
Registration & Insurance for a title, registration or insurance; Maintenance
Records; Inspection & Compliance; Manuals & References). The apparatus row
links the document (`document_id`, cascading). Downloads go through the
apparatus endpoint and also check the document's current folder, so a file
moved out of reach is not served through the module's door. Typed URLs are
refused on the way in, and `fileUrl` passes an old one on only if it is
HTTP(S).

**Finance receipts** are uploaded at `POST /finance/purchase-requests/{id}/receipt`
and `/expense-reports/{id}/items/{item}/receipt`, filed in Finance > Receipts,
and linked by `receipt_document_id`. Here the record's read rule is the
authority, not the folder's: a member opens the receipt on their own request
without holding the rights that open the Finance folder. Replacing a receipt
keeps the earlier file, since it may be what an approver saw.

`app/services/module_documents.py` is the shared path for both: store as a
document, serve back with a descriptive name, delete with the file.

Not done here: a screen for setting a custom folder's rights (decision 22);
facility files still upload through `/documents/upload`, which needs
`documents.manage` on top of the facility grant.

### Phase 4 — what changed

**Every file written to disk is encrypted** (`app/core/file_encryption.py`).
`FileStorageService.write_atomically` encrypts before it writes, so every
upload path from Phase 2 is covered. The format:

- a 94-byte header: magic `LBENC\x01`, the key id, and a per-file data key
  wrapped with AES-256-GCM under the installation's file key;
- the body in 64 KiB chunks, each sealed with AES-256-GCM. Each chunk's
  associated data binds the header, the chunk's index and whether it is the
  last, so reordering, truncation and trailing bytes are all refused.

The file key is HKDF-SHA256 over the same PBKDF2 output the field cipher
uses, with its own label, so it is never the field key itself. The key id
is an HMAC of the file key, which identifies the key without revealing it.

**Reads decrypt.** Every download goes through `stored_file_response`. It
streams the plaintext with the right length and download name, and it
unwraps the key before the response starts, so a wrong key is an error
rather than a truncated download. A file written before this change is
recognised by its missing magic bytes and served as it is. Email
attachments are read the same way. `test_file_encryption.py` fails on any
`FileResponse` outside the storage service.

**`scripts/encrypt_uploads.py`** encrypts what is already on disk
(`app/services/upload_encryption.py`):

1. `--apply` writes the ciphertext beside each file and decrypts it back to
   compare. Only then does it swap the ciphertext in, keep the original as
   `.<name>.plaintext` and record both in a manifest under
   `/app/uploads/.encryption/`.
2. `--rollback` puts the originals back.
3. `--finalize` re-verifies each file against its recorded checksum before
   deleting its original.

Modification times are kept, because anonymous suggestion screenshots rely
on a coarse one. `--rewrap` moves files written under a key now only in
`ENCRYPTION_KEYS_LEGACY` onto the current key without re-encrypting the
body. Until no plaintext copy is left, administrators see a "not yet
encrypted" notice.

**Key custody.** Setup has a new required step after the system owner
account, Encryption Key (`/onboarding/encryption-key`).
`complete_onboarding` refuses to finish without it. On an installation that
is already set up, `settings.manage` holders see a red notice with a confirm
button.

A confirmation is stored in `encryption_key_custody`, one row per key
fingerprint, with who confirmed it and when. It is audited as
`encryption_key.custody_confirmed`. A rotated key has a new fingerprint and
is asked about again. The request carries the fingerprint the administrator
was shown, so a key changed in the meantime is refused (409) rather than
confirmed unseen.

The installers now `chmod 600` the `.env` they write and tell the operator
to copy the key somewhere else before setup.

Not done here:

- Images stored in the database (member photos, logos, storefront and
  equipment-check photos) are not files on disk and are not covered.
- Encrypted downloads do not support HTTP Range requests.
- Backups taken before the encrypt run still hold plaintext copies.

These are in `docs/KNOWN_LIMITATIONS.md`.

### Found in passing, not in this change

- `GET /events?include_drafts=true` returns draft events to any member. The
  flag is honoured without a permission check. Belongs with the events
  module, not file storage.

## Open questions for later phases

None outstanding; items 9–13 above settled the last ones on 2026-10-08.
