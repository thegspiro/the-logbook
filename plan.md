# Membership Module Improvements — Implementation Plan

## Summary
Seven improvements to the membership pipeline module based on comprehensive review.

---

## 1. Auto-create prospect from form submission
**Goal:** When a membership interest form is submitted publicly, automatically create a ProspectiveMember record at step 1 of the default pipeline. Notify the admin.

### Backend
- **`backend/app/services/forms_service.py`** — `_process_membership_interest()`:
  - After recording mapped data, call `MembershipPipelineService.create_prospect()` with the mapped fields
  - Set `form_submission_id` on the new prospect to link them
  - Map common field names: `first_name`, `last_name`, `email`, `phone`, `date_of_birth`, `interest_reason`, `address_*`
  - Look up the org's default pipeline; if none exists, skip auto-creation and log a warning
  - Return `prospect_id` in the integration result
- **No schema changes needed** — `create_prospect` already accepts all these fields

### Frontend
- No changes needed (admin will see prospects appear in pipeline automatically)

---

## 2. Prospect status check via token link
**Goal:** After form submission / prospect creation, generate a unique token. Prospect receives email with a link to check their status (read-only).

### Backend — Model
- **`backend/app/models/membership_pipeline.py`** — `ProspectiveMember`:
  - Add `status_token` column (String(64), unique, indexed, nullable)
  - Add `status_token_created_at` column (DateTime)
  - Generate token via `secrets.token_urlsafe(32)` on prospect creation

### Backend — Public endpoint
- **`backend/app/api/public/portal.py`** — new route:
  - `GET /api/public/v1/application-status/{token}` — no auth required
  - Returns: prospect name, current stage name, stage type, status (active/on_hold/etc.), pipeline stage count, created_at
  - Does NOT return: email, phone, address, notes, internal IDs, activity log
  - Rate limited: 30 requests/min per IP

### Backend — Migration
- New Alembic migration adding `status_token` and `status_token_created_at` columns

### Backend — Service
- **`membership_pipeline_service.py`** — `create_prospect()`:
  - Generate and store `status_token` on creation
- **`membership_pipeline_service.py`** — new `get_prospect_by_token()`:
  - Look up prospect by token, return limited public-safe fields

### Frontend
- **New page:** `frontend/src/pages/ApplicationStatusPage.tsx`
  - Simple public page (no auth) at `/application-status/:token`
  - Shows: applicant name, current stage, status badge, timeline of completed stages (names only)
  - Clean, minimal design. No edit capabilities.

---

## 3. Two-step conversion wizard
**Goal:** Replace the simple ConversionModal with a two-step wizard. Step 1: review prospect data. Step 2: fill in member-specific fields (rank, station, hire_date, middle_name, emergency contact).

### Backend
- **`backend/app/schemas/membership_pipeline.py`** — `TransferProspectRequest`:
  - Add optional fields: `middle_name`, `hire_date`, `emergency_contacts` (list of dicts)
- **`backend/app/services/membership_pipeline_service.py`** — `_do_transfer()`:
  - Pass through `middle_name`, `hire_date`, `emergency_contacts` to the new User constructor
  - `rank` and `station` already supported

### Frontend
- **`frontend/src/modules/prospective-members/components/ConversionModal.tsx`** — rewrite:
  - Step 1: "Review Applicant" — show all prospect data (name, contact, address, stage history summary, documents count, election result if applicable). Confirm button.
  - Step 2: "Set Up Member Account" — form with: membership type (radio), rank (dropdown from org operational ranks), station (dropdown/text), hire date (date picker), middle name (text), emergency contact (name, phone, relationship), send welcome email (checkbox), notes (textarea).
  - Submit calls transfer endpoint with all fields.
  - Success screen shows member ID, username, and link to member profile.

---

## 4. Inactivity warning emails
**Goal:** Detect stalled applications and email the coordinator (and optionally the prospect) when inactivity thresholds are reached.

### Backend — Service
- **`backend/app/services/membership_pipeline_service.py`** — new `check_inactivity()`:
  - Query all active prospects where `updated_at` exceeds the pipeline's warning threshold
  - For each, calculate days since last activity vs. pipeline/step inactivity config
  - Return list of prospects needing warnings, with alert level (warning vs critical/inactive)
- **`backend/app/services/membership_pipeline_service.py`** — new `process_inactivity_warnings()`:
  - For warning-level: send coordinator email, log activity
  - For critical/inactive-level: update status to `inactive`, send coordinator email, optionally send prospect email
  - Idempotent — track last warning sent in activity log to avoid duplicates

### Backend — Email
- **`backend/app/services/email_service.py`** — new `send_inactivity_warning()`:
  - To coordinator: "Prospect {name} has been inactive for {days} days at stage {stage}. Action needed."
  - To prospect (if configured): "Your application has been inactive. Please contact us if you wish to continue."

### Backend — Endpoint (for manual/scheduled trigger)
- **`backend/app/api/v1/endpoints/membership_pipeline.py`** — new route:
  - `POST /api/v1/prospective-members/process-inactivity` — requires `prospective_members.manage`
  - Calls `process_inactivity_warnings()` and returns count of warnings sent
  - Can be called by a cron job or manually by admin

---

## 5. Sortable table columns
**Goal:** Add click-to-sort on all table columns in PipelineTable.

### Frontend
- **`frontend/src/modules/prospective-members/components/PipelineTable.tsx`**:
  - Add sort state: `sortField` and `sortDirection` (asc/desc)
  - Make column headers clickable with sort indicator icons
  - Sort client-side for the current page data (no backend change needed since pagination is already handled)
  - Sortable columns: Name, Email, Current Stage, Status, Days in Stage, Target Type, Applied Date

---

## 6. Editable prospect details in drawer
**Goal:** Allow admins to edit prospect contact info (name, email, phone, DOB, address) directly from the ApplicantDetailDrawer.

### Frontend
- **`frontend/src/modules/prospective-members/components/ApplicantDetailDrawer.tsx`**:
  - Add "Edit" button next to contact info section
  - Toggle between view mode (current) and edit mode (inline form fields)
  - On save, call `applicantService.updateApplicant()` with changed fields
  - Show success toast and refresh applicant data
  - Editable fields: first_name, last_name, email, phone, date_of_birth, address (street, city, state, zip)

---

## 7. Preserve referral data on transfer
**Goal:** Don't lose `interest_reason`, `referral_source`, and `referred_by` when transferring a prospect to membership.

### Backend — Model
- **`backend/app/models/user.py`** — `User`:
  - Add `referral_source` column (String(255), nullable)
  - Add `interest_reason` column (Text, nullable)
  - Add `referred_by_user_id` column (String(36), ForeignKey to users.id, nullable)

### Backend — Migration
- New Alembic migration adding the three columns

### Backend — Service
- **`backend/app/services/membership_pipeline_service.py`** — `_do_transfer()`:
  - Map `prospect.interest_reason` → `new_user.interest_reason`
  - Map `prospect.referral_source` → `new_user.referral_source`
  - Map `prospect.referred_by` → `new_user.referred_by_user_id`

### Backend — Schema
- **`backend/app/schemas/user.py`** — add fields to `UserResponse` (read-only)

---

## Implementation Order
1. Preserve referral data (small, schema + migration)
2. Sortable table columns (frontend only)
3. Editable prospect details in drawer (frontend only)
4. Auto-create prospect from form submission (backend service change)
5. Two-step conversion wizard (frontend rewrite + backend schema update)
6. Prospect status check via token link (new model fields, migration, public endpoint, new page)
7. Inactivity warning emails (new service methods, email template, endpoint)
