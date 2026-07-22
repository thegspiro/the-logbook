# Module Audit — Medical Screening

**Files:** `app/api/v1/endpoints/medical_screening.py` (367 L),
`app/services/medical_screening_service.py` (355 L),
`app/models/medical_screening.py`, frontend `modules/medical-screening`.
**Audited:** iteration 1.

## Verified good ✅
- **Tenant isolation is solid (PHI-critical).** Every by-ID query filters
  `organization_id` (`get_requirement`, `get_record` use `and_(id==, org==)`),
  and `update_*`/`delete_*` route through those getters — no IDOR path.
  `list_*` and `get_expiring_soon` are org-scoped.
- **Access control:** all endpoints gated by `medical_screening.view` / `.manage`.
- **Audit logging:** record creation calls `log_audit_event` (HIPAA §164.312(b)).
- **Cache exclusion:** `/medical-screening/` is in `UNCACHEABLE_PREFIXES`
  (added in the red-team Batch A) — PHI not cached client-side.
- **No SQL injection:** `get_expiring_soon` computes the cutoff in Python with a
  bound date, not a raw INTERVAL fragment.
- **404 handling:** endpoints raise 404 on `None` service returns.

## Findings (all FLAGGED — no safe auto-fix; each needs care/migration/feature work)

### MS-1 — MEDIUM — PHI stored in plaintext columns (encryption at rest)
`ScreeningRecord.result_summary` (Text), `result_data` (JSON), `notes` (Text),
and `provider_name` (String) hold protected health information but are plain
columns — not the app's `EncryptedType` (`core/encrypted_types.py`), despite
CLAUDE.md documenting AES-256 encryption of sensitive fields. A DB compromise
exposes screening results in cleartext.
**Why flagged, not fixed:** switching to `EncryptedType` requires a data
migration to encrypt existing rows and changes storage/query semantics — a
risky change that must be designed + tested, not auto-applied. Recommend:
convert the four fields to `EncryptedType`, add an Alembic data migration, and
verify search/filter code doesn't rely on plaintext matching on them.

### MS-2 — LOW — Compliance/expiring responses never populate names
`get_compliance_status` always sets `subject_name = ""`; `get_expiring_soon`
always sets `user_name=None`, `prospect_name=None`, `requirement_name=None`.
The response schema carries these fields but the service never resolves them, so
the UI shows blank names (or must re-resolve per row). Incomplete feature.
**Recommend:** batch-resolve user/prospect/requirement names in the service.

### MS-3 — LOW — No cross-org validation of referenced IDs on create
`create_record` sets `organization_id` from the caller (good) but does not
verify `data.user_id` / `data.prospect_id` / `data.requirement_id` belong to
that org. Not a disclosure (the record is org-scoped), but a `manage` user could
attach a screening record to a foreign user_id (mis-attribution / dangling ref).
**Recommend:** validate the referenced user/prospect/requirement is in-org
before create (reject otherwise).

## Notes
- No dead code found in these files.
- Docstrings are accurate and present on all service methods.
