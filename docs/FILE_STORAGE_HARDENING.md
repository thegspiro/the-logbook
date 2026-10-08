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

## Phases

| Phase | Scope                                                                                                                                           | Status      |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1     | Close the access leaks                                                                                                                          | this change |
| 2     | One storage service: org-first layout, descriptive names, size caps and malware scan everywhere (on by default)                                 | planned     |
| 3     | A folder per module with module-specific rights; narrow `documents.view`; admin-only see-all; apparatus files and finance receipts as documents | planned     |
| 4     | Encryption at rest, with the onboarding key-custody confirmation                                                                                | planned     |

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

### Found in passing, not in this change

- `GET /events?include_drafts=true` returns draft events to any member. The
  flag is honoured without a permission check. Belongs with the events
  module, not file storage.
- Email attachments reach recipients named by their stored UUID
  (`email_service` sends `basename(storage_path)`), not the uploaded name.
  Phase 2 (descriptive names).
- Apparatus photo and document records hold a client-supplied URL rather than
  an upload; finance receipts are URL fields with no upload at all. Phase 3.

## Open questions for later phases

None outstanding; items 9–13 above settled the last ones on 2026-10-08.
