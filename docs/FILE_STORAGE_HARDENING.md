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
27. **The folder-access editor** (2026-10-12, settling decision 22):
    - A custom folder can be restricted by position, by permission, or both.
      Any one chosen permission admits.
    - A built-in folder keeps its module rights. It can only be narrowed, with
      leadership-only or specific positions.
    - Access is set in the Create Folder dialog too.
    - A save that would shut its editor out of the folder is refused, unless
      the editor is a full administrator.
28. **Folders name positions by id** (2026-10-13), not by slug, so a position
    created later can never inherit a deleted one's folders.
    - Deleting a position removes it from every folder that names it.
    - Deletion is refused while it is the only position opening a folder,
      naming those folders, so nothing opens to the whole department by
      accident.
29. **A folder only full administrators could open is confirmed, not
    refused** (2026-10-14). When a create, an access change or a move would
    leave the folder open to no active member except full administrators,
    the server answers `LB-DOC-001` and the dialog asks before saving. The
    count asks the access check itself, parent folders included. A department
    whose only active members are full administrators, such as a fresh
    install, is not asked.
30. **A folder that loses everyone but full administrators later is listed,
    not asked about** (2026-10-15). Members lose access through positions,
    position permissions, status, archiving, deletion and rank, from many
    screens and from unattended jobs (auto-archive, tier advancement). So
    the change goes through, and full administrators see each such folder
    on the Documents page, where they can change its access or keep it for
    administrators.
    - Keeping a folder records `admin_only_confirmed_at`/`_by`, and the
      folder is no longer listed. Confirming at save time records the same
      thing.
    - The record is cleared whenever an access save leaves someone else
      able to open the folder. It is also cleared when the list is read and
      someone else can open the folder again, for example a new holder of
      its position. A later loss then lists the folder again.
    - Only the topmost shut folder is listed: a folder shut because its
      parent is shut is settled with the parent.
    - Personal folders are never listed, since they open to their owner
      alone by design.
    - Probationary members count, as sign-in counts them.
    - Full administrators are also emailed the list, at most once a week per
      department, while any folder is on it (2026-10-16). Each email repeats
      every folder still listed. It is the optional "Document folder access"
      email (`EmailKind.DOCUMENT_DUTIES`), which a department can make
      required.
31. **A department's own S3 bucket** (2026-10-21, owner decisions). The S3
    (and MinIO-compatible) choice in a department's File Storage settings
    will decide where that department's new files go. The bucket,
    credentials and endpoint are the department's, from onboarding, not an
    installation-wide setting.
    - Files already on local disk move with a migration command (verified
      copy, rollback, finalize, as relocation and encryption do). Until it
      runs, a file with a local reference keeps being served from disk, so
      switching never breaks a download.
    - Malware scanning, per-organization separation and encryption at rest
      apply exactly as on local disk. Files are encrypted before they leave
      the server.
    - Tests fake S3 with moto (test-only dependency).
    - Built in three steps:
      1. One storage interface (`exists`, `read_bytes`, `plaintext_size`,
         `delete`, `file_response` in `file_storage_service`) that every
         caller uses, with the local backend only. Behaviour is unchanged.
      2. The S3 backend and the per-department settings it reads.
      3. The migration command, the encryption and rewrap tooling on S3,
         backups, and docs.
    - Step 2 decisions (2026-10-22): a department's uploads move to its
      bucket only after **Test and switch to S3** passes with the saved
      settings, and go back to local disk if those settings are edited
      afterwards; an unreachable bucket **refuses** the upload (503,
      `LB-UPLD-006`) rather than writing to disk; the endpoint must be public
      HTTPS unless the operator sets `S3_ALLOW_PRIVATE_ENDPOINT`; and
      anonymous suggestion screenshots go to the bucket too, accepting that
      the bucket records their exact upload time.

32. **Google Drive next, through one interface for every remote platform**
    (2026-10-23, owner decisions).
    - Google Drive is built before OneDrive / SharePoint.
    - The server signs in with a **service account** and stores files in a
      **Shared Drive** the department adds that account to, the same
      service-account approach as the Google Workspace integration. Files
      belong to the department's drive, not to a person whose access can
      lapse. It needs Google Workspace. The never-read OAuth client ID and
      secret fields give way to a service-account key.
    - The S3 pattern applies unchanged: Test and switch before any upload
      goes there, an unreachable store refuses the upload, files are
      encrypted before upload, and existing files move with the migration
      command (apply, rollback, finalize).
    - Built in three steps: (1) the connection test, status, migration and
      rewrap made platform-neutral, S3 behaviour unchanged; (2) the Google
      Drive backend and its settings; (3) migration, rewrap and backup
      notice for Drive.

## Phases

| Phase | Scope                                                                                                                                           | Status       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1     | Close the access leaks                                                                                                                          | done (#3009) |
| 2     | One storage service: org-first layout, descriptive names, size caps and malware scan everywhere (on by default)                                 | done (#3011) |
| 3     | A folder per module with module-specific rights; narrow `documents.view`; admin-only see-all; apparatus files and finance receipts as documents | done (#3031) |
| 4     | Encryption at rest, with the onboarding key-custody confirmation                                                                                | done         |
| 5     | Every document lives in a folder: no more organization-wide "unfiled" documents                                                                 | done         |
| 6     | A department's own S3 / MinIO bucket (decision 31), step 1 of 3: one storage interface every caller uses                                        | done (#3537) |
| 7     | Decision 31, step 2 of 3: the S3 backend, each department's settings, the connection test that switches it                                      | done (#3561) |
| 8     | Decision 31, step 3 of 3: moving existing files into a bucket, rewrap on S3, backup notice                                                      | done (#3567) |
| 9     | Decision 32, step 1 of 3: the connection test, status, migration and rewrap made platform-neutral (S3 unchanged)                                | done (#3611) |
| 10    | Decision 32, step 2 of 3: the Google Drive backend (service account, Shared Drive) and its settings                                             | done (#3623) |
| 11    | Decision 32, step 3 of 3: the migration command renamed for every platform, and the Shared Drive backup documentation                           | this change  |

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

Not done here: a screen for setting a custom folder's rights (decision 22, since built: decision 27);
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

### Phase 5 — every document lives in a folder (2026-10-11)

A document with no folder was organization level: readable and downloadable
by every `documents.view` holder, outside every folder's rights. Upload let
the folder be left out, and a move could set it to null, so a document taken
_out_ of a gated folder (Finance, Member Separations, a personal folder)
became readable by the whole organization.

| Finding                                                                                                    | Fix                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /documents/upload` with no `folder_id` stored an unfiled document                                    | Files it into General Documents (created with the system roots if missing), behind the same write check as any folder                     |
| `PATCH /documents/{id}` with `folder_id: null` moved a document out of its folder's rights, unchecked      | `null` means General Documents and goes through the destination write check                                                               |
| Unfiled documents already stored                                                                           | Migration `dcb8a46ac50c` files them into their organization's General root; reversible, recorded in `document_unfiled_backfill`           |
| Linking an unfiled document to an apparatus moved it behind apparatus rights with only read access checked | Re-filing it takes `documents.manage`                                                                                                     |
| The facility Files tab relied on uploading unfiled and re-filing on link                                   | The link also files the caller's _own_ upload out of General into the facility folder; someone else's library document is never pulled in |

Who can read a moved document is unchanged — General Documents is the shared
library, open to `documents.view` — but its folder now decides it. The upload
form's "No folder" choice reads "General Documents (default)".

This revision also joins the two Alembic heads `3f3bd6f3c7e4` and
`990e288940bc`, published with the same parent.

### Phase 7 — a department's own bucket (2026-10-22)

| Piece                 | Where                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Talking to a bucket   | `app/services/s3_storage.py`, the only module that imports boto3 (`tests/test_storage_operations.py`)                                                           |
| A stored reference    | `s3://<bucket>/<org>/<area>/<record>/<uuid><ext>`; `resolve()` confines it by its leading key segments, as it confines a path by directory                      |
| Where a new file goes | `file_storage.write_file`: the bucket when the platform is S3 **and** the saved settings' keyed fingerprint matches the last passed test; otherwise the volume  |
| The connection test   | `POST /organization/settings/file-storage/s3/activate` (write, read back, delete a probe; re-checked under the row lock); `.../s3/deactivate` goes back to disk |
| What the screen shows | `GET /organization/settings/file-storage/status`, rendered by `StorageLocationPanel`                                                                            |
| Bucket down           | 503 `LB-UPLD-006` on upload, download and existence checks; a delete reports failure as on disk                                                                 |
| Endpoint check        | `assert_outbound_url_safe` each time a department's client is built; private or plain HTTP only with `S3_ALLOW_PRIVATE_ENDPOINT`                                |
| Settings cache        | Per worker, 30 s, 256 departments; cleared in the worker that saves. Another worker follows within 30 s                                                         |

Encrypted before upload with the same format and key as the volume, so the
bucket's operator never holds plaintext. Step 3 (phase 8, below) covers
moving existing files in, key rotation and backups.

### Phase 8 — moving existing files into a bucket (2026-10-22)

Owner decisions: the copies on disk are **kept until finalize**, as relocation
and encryption keep theirs; and backups **stay with the bucket's own tooling**
— `backup.sh` names the buckets it leaves out rather than downloading them.

| Piece        | Where                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The move     | `app/services/remote_migration.py`, driven by `scripts/migrate_uploads_to_s3.py`: apply (copy, read back, compare SHA-256, repoint), rollback, finalize  |
| Which rows   | `upload_relocation.collect_references`, now including minutes attachments; one file shared by several rows moves once                                    |
| Which files  | Only files in the org-first layout, for departments that passed the connection test; a legacy-layout file is reported for `relocate_uploads.py` first    |
| Manifest     | `/app/uploads/.s3-migration/`, written before any row changes                                                                                            |
| Key rotation | `encrypt_uploads.py --rewrap` also rewraps bucket objects, found through the rows that reference them                                                    |
| Backups      | `backup.sh` calls `migrate_uploads_to_s3.py --buckets` and warns which buckets hold files the archive does not; `docs/BACKUP.md` covers provider tooling |

A moved anonymous screenshot's bucket copy carries the migration's time, not
the submission's. Relocation now counts an `s3://` reference as already in the
new layout; before this it reported one as missing on disk.

### Phase 9 — one interface for every remote platform (2026-10-23)

`app/services/remote_storage.py` defines what a remote platform provides:
references by scheme carrying the org-first key, a configuration with a keyed
fingerprint, a check, and a backend that encrypts on `put` and decrypts on
every read. `remote_storage.platforms()` lists the platforms this
installation can connect to: S3 (`S3Platform` in `s3_storage`) and, since
phase 10, Google Drive (`GoogleDrivePlatform` in `google_drive_storage`).

| Was (S3 only)                                        | Now                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `OrgStorage.s3`, `.s3_problem`, `.writes_to_s3`      | `.backends`, `.problems` (by platform), `.writes_to` (the platform name, or None)     |
| `activate_s3` / `deactivate_s3`                      | `activate_remote` / `deactivate_remote`, for whichever platform is saved              |
| `POST …/file-storage/s3/activate`, `…/s3/deactivate` | `POST …/file-storage/activate`, `…/deactivate`; the S3 routes stay as aliases         |
| `app/services/s3_migration.py`                       | `app/services/remote_migration.py`, through the interface; manifests keep their names |
| The Storage panel's S3 wording                       | Names, nouns and the container come from the status response                          |

The status response gains `platform_label`, `platform_short_label`,
`container_noun`, `container`, `platform_connectable`, `location` and
`problem`; `bucket` and `s3_problem` stay for clients written against them.
The activation record also stores `container`; one written earlier is read
through its `bucket`. Existing activation records still match, because the S3
fingerprint did not change.

### Phase 10 — a department's Google Shared Drive (2026-10-23)

| Piece              | Where                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Talking to Drive   | `app/services/google_drive_storage.py`: Drive v3 REST through `google-auth`'s authorized session, 5 s / 30 s timeouts, three retries on 429 and 5xx    |
| Signing in         | The department's service-account key, scoped to the whole Drive API; what it reaches is bounded by the Shared Drives the account has been added to     |
| A stored reference | `gdrive://<shared_drive_id>/<file_id>/<org>/<area>/<record>/<name>`; `resolve()` confines it by the key after the id, as for a bucket                  |
| A new file's id    | Reserved at Drive (`files.generateIds`, 20 at a time) before the upload, so a retried upload replaces the file it made rather than making a second one |
| Settings           | `google_drive_service_account_key` (encrypted, never returned), `google_drive_shared_drive_id`, optional `google_drive_folder_id`                      |
| Connection test    | The shared Test and switch: write, read back and delete a probe in the chosen folder; the account needs the Content manager role so it can trash       |

`RemoteBackend.ref_for` may now ask the store, so it runs off the event loop
with the upload, and the migration assigns each file's reference when it
copies the file, not when it plans: a dry run reserves nothing. The
platform-neutral migration, rewrap and backup notice from phase 9 already
cover Drive. Step 3 renames the S3-named command and finishes the docs.

The old OAuth client ID and secret fields were read by nothing; the API still
accepts them, the screens no longer ask for them.

**Corrected 2026-10-25: a delete moves the file to the Shared Drive's trash.**
As shipped, a delete was `files.delete`, which Google allows on a Shared Drive
only to the Manager role. The Content manager role the setup asks for may only
trash, so the connection test could not remove its probe and failed every
time; the in-memory Drive in the tests accepted the delete, which is why
nothing caught it. The fake now refuses `files.delete` to a Content manager as
Drive does, and a delete is `files.update` with `trashed: true`, which Google
empties after 30 days.

### Phase 11 — one command for every platform, and backing up a Shared Drive (2026-10-25)

| Piece                | Where                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The move             | `scripts/migrate_uploads_to_remote.py`; `migrate_uploads_to_s3.py` stays as a one-line alias that runs it, for runbooks and old hosts |
| Inventory            | `--stores`, with `--buckets` still accepted; the JSON it prints is unchanged, `bucket` naming the bucket or the drive                 |
| Backups              | `backup.sh` asks for the new name and falls back to the old one, so an updated host works against an older backend image              |
| Shared Drive backups | `docs/BACKUP.md`: the drive's trash restores a file with its id; a copy kept elsewhere is a new file, so a reference cannot find it   |

The manifest directory and kind keep their S3-era names, so a manifest from an
earlier run still rolls back and finalizes. That a Drive copy cannot simply be
restored is recorded in `docs/KNOWN_LIMITATIONS.md`, not solved here.

### Found in passing, not in this change

- `GET /events?include_drafts=true` returns draft events to any member. The
  flag is honoured without a permission check. Belongs with the events
  module, not file storage.
- Two found by the 2026-10-11 audit for Phase 5, recorded in
  `docs/KNOWN_LIMITATIONS.md` ("File Storage — Folder Rights Phase 3 Left
  Open"): files in the `documents` area were stored flat under
  `<org>/documents/`, not per record (resolved the same day: new uploads go
  to `<org>/documents/<document_id>/`, and `scripts/relocate_uploads.py`
  moves the flat ones); and an event's attachment references are confined to
  the organization, not to that event.

## Open questions for later phases

None outstanding; items 9–13 above settled the last ones on 2026-10-08.
