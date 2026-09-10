"""Enable public event requests where a request form is already published

``events.request_pipeline.accept_public_requests`` shipped read by exactly one
of the two intake paths. ``POST /api/v1/event-requests/public`` honoured it;
the Forms path — the one a department's own "Generate Event Request Form"
button produces, and the one the settings screen tells them to publish — never
looked at it. The same change that adds this migration makes the Forms path
honour it too.

The setting defaults to **false**, and no department has ever had a reason to
turn it on, because nothing on that path read it. Without this backfill the
change would silently stop community requests arriving at every installation
that has a published request form, with the toggle already showing off and no
error anywhere. That is CLAUDE.md pitfall #19's "absence must mean current
behaviour, never off", applied on the upgrade path rather than in the resolver.

So: every organization that has a **published, public** form which would
actually create a request today is, today, accepting public event requests.
This migration writes that fact down. It sets the flag unconditionally for
those organizations rather than only where the key is absent — a stored
``false`` on such an organization cannot have meant "do not take requests from
my published form", because the toggle never controlled that form.
Organizations with no such form are left untouched and keep the shipped
default.

"Would actually create a request" is checked, not assumed, and that is the
whole difficulty. Neither the form-level marker nor an **active** integration
row proves a form is feeding the pipeline:

- **The marker plus a deactivated row.** ``_process_integrations`` computes
  ``disabled = bool(same_type_rows) and integration is None`` and skips the
  integration outright, so that department is receiving nothing through the
  form.
- **An active row whose mappings no longer resolve.**
  ``_refresh_integration_mappings`` runs on every field add, rename and delete
  and rebuilds ``field_mappings`` wholesale from the current labels and field
  types, leaving ``is_active`` untouched. Deleting or renaming a form's contact
  fields therefore empties the mappings that matter while the row still reads
  as active, and ``_process_event_request`` answers "missing required
  mapping(s)" to every submission thereafter.

Both are excluded, for one reason: this backfill's entire justification is
"preserve current behaviour", and for a department whose form is not reaching
the pipeline there is no behaviour to preserve. What setting the flag would do
instead is open the separate anonymous ``POST /api/v1/event-requests/public``
for a department that has never taken an anonymous request — a widening of a
public surface, which a preservation backfill must not do. A department in
either state that later fixes its form must also turn the toggle on, which is
the coupling already recorded in ``docs/KNOWN_LIMITATIONS.md``.

``_form_can_produce_a_request`` mirrors the runtime resolution order —
``field_mappings`` first, then the label and field-type fallback
``_apply_label_fallback`` applies — against frozen copies of the service's own
label tables, and compares labels in Python so the columns' accent-insensitive
collation cannot equate a label the service would not have matched.

Idempotent: an organization already carrying ``true`` is skipped, so a re-run
writes nothing.

**Irreversible, and the downgrade is a deliberate no-op.** Nothing records
which of the selected organizations already carried ``true`` before this ran,
so "remove the key wherever it is true" is not the inverse of this migration —
it is a strictly larger deletion. The code being reverted to still reads this
flag on ``POST /api/v1/event-requests/public``, so that deletion would silently
close the anonymous JSON intake of any department that had deliberately turned
it on, which is information the upgrade never touched and must not destroy.

Leaving the flag set is the safe direction: every organization it was set on
has a published, public request form and is therefore already taking public
event requests through it, so the reverted code reading ``true`` describes what
that department is actually doing.

Guarded on the tables existing. Fresh installs come up through
``create_all`` + stamp-head rather than by replaying this chain (CLAUDE.md
pitfall #26), and CI runs ``alembic upgrade head`` against an empty database.
``organizations``, ``forms``, ``form_fields`` and ``form_integrations`` are all
migration-built today, so the guard is belt-and-braces — but a database with neither table has no rows to backfill
either, which makes skipping the correct outcome rather than merely a safe one.

The settings JSON is rebuilt with ``copy.deepcopy`` and written back as a whole
value (CLAUDE.md pitfall #12). It is read and written in Python rather than
with ``JSON_SET`` because the CI matrix spans MySQL 8.0 and MariaDB 10.11,
whose JSON support is not the same feature.

Revision ID: d19b2c2ae9b9
Revises: c7e2a4b9d180
Create Date: 2026-09-09 15:26:39.931866

"""

import copy
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d19b2c2ae9b9"
down_revision: Union[str, None] = "c7e2a4b9d180"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# A form only takes submissions from the public when it is published *and*
# flagged public; a draft or archived one is not accepting anything, so its
# organization is not currently relying on the behaviour this preserves.
#
# The two OR arms mirror `FormsService._process_integrations` exactly, because
# the question this migration asks is "does a submission to this form create an
# event request *today*", not "does this form look like a request form":
#
#   * an ACTIVE `event_request` row — the legacy path processes it, and it also
#     supplies the mappings the direct path prefers; or
#   * the form-level marker with NO `event_request` row at all — the direct
#     path runs on label-based mapping.
#
# The form must also be one an ANONYMOUS submitter can actually use. This
# mirrors `api/public/forms.py`'s own predicate,
# `(require_authentication or not allow_multiple_submissions) and not
# current_user` -> 401, including its NULL semantics: a NULL
# `require_authentication` is falsy in Python and so does not require auth,
# while a NULL `allow_multiple_submissions` is falsy and therefore *does*.
#
# This is what the flag governs after the same change makes `is_public` mean
# "anonymous". A department whose only request form requires a login has its
# submissions exempt from `accept_public_requests` outright, so turning the
# flag on preserves nothing for them — it does one thing only, which is to
# open the unauthenticated `POST /api/v1/event-requests/public` for a
# department that has never accepted an anonymous request. A backfill whose
# entire justification is "preserve current behaviour" must not widen a
# public surface.
#
# The case deliberately excluded is the marker plus rows an administrator has
# DEACTIVATED. `_process_integrations` computes
# `disabled = bool(same_type_rows) and integration is None` and skips the
# integration entirely, so that department is not receiving pipeline requests
# through this form. Selecting it would not preserve its behaviour: it would
# newly open the separate anonymous JSON endpoint for a department that had
# deliberately switched its intake off.
_CANDIDATE_REQUEST_FORMS = sa.text("""
    SELECT f.id, f.organization_id
    FROM forms f
    WHERE f.status = 'published'
      AND f.is_public = 1
      AND (f.require_authentication = 0 OR f.require_authentication IS NULL)
      AND f.allow_multiple_submissions = 1
      AND (
        EXISTS (
            SELECT 1 FROM form_integrations fi
            WHERE fi.form_id = f.id
              AND fi.integration_type = 'event_request'
              AND fi.is_active = 1
        )
        OR (
            f.integration_type = 'event_request'
            AND NOT EXISTS (
                SELECT 1 FROM form_integrations fi2
                WHERE fi2.form_id = f.id
                  AND fi2.integration_type = 'event_request'
            )
        )
      )
    """)


# Frozen copies of the label and field-type tables `FormsService` resolves an
# event-request submission through — `_EVENT_REQUEST_LABEL_MAP` and
# `_INTEGRATION_FIELD_TYPE_MAP["event_request"]`. Inlined rather than imported
# for the reason CLAUDE.md pitfall #20 gives for the other inlined normalizer:
# a migration must keep selecting the rows it selected the day it ran, and a
# helper that is free to change cannot promise that.
# Copied in FULL rather than narrowed to the two targets that matter, because
# the entries for the *other* targets are what make the resolution correct. A
# field labelled "Phone" resolves to `contact_phone`, and that is precisely
# what stops its field type being consulted — narrow the table to the name and
# email labels and an `email`-typed field called "Phone" wrongly reads as
# providing `contact_email`.
_LABEL_TARGETS = {
    "contact name": "contact_name",
    "name": "contact_name",
    "full name": "contact_name",
    "your name": "contact_name",
    "contact email": "contact_email",
    "email": "contact_email",
    "email address": "contact_email",
    "phone": "contact_phone",
    "phone number": "contact_phone",
    "contact phone": "contact_phone",
    "telephone": "contact_phone",
    "organization": "organization_name",
    "organization name": "organization_name",
    "org name": "organization_name",
    "company": "organization_name",
    "your organization": "organization_name",
    "outreach type": "outreach_type",
    "type": "outreach_type",
    "request type": "outreach_type",
    "type of event": "outreach_type",
    "description": "description",
    "event description": "description",
    "details": "description",
    "date flexibility": "date_flexibility",
    "preferred timeframe": "preferred_timeframe",
    "timeframe": "preferred_timeframe",
    "preferred date": "preferred_timeframe",
    "time of day": "preferred_time_of_day",
    "preferred time": "preferred_time_of_day",
    "preferred time of day": "preferred_time_of_day",
    "earliest date": "preferred_date_start",
    "latest date": "preferred_date_end",
    "audience size": "audience_size",
    "expected attendees": "audience_size",
    "number of attendees": "audience_size",
    "attendees": "audience_size",
    "expected audience size": "audience_size",
    "age group": "age_group",
    "age range": "age_group",
    "venue preference": "venue_preference",
    "venue": "venue_preference",
    "venue address": "venue_address",
    "location": "venue_address",
    "address": "venue_address",
    "special requests": "special_requests",
    "additional notes": "special_requests",
    "special needs": "special_requests",
}

_FIELD_TYPE_TARGETS = {
    "email": "contact_email",
    "phone": "contact_phone",
}


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _form_can_produce_a_request(bind, form_id: str) -> bool:
    """Whether this form can actually yield the two fields a request requires.

    An **active** integration row is not proof that a form creates event
    requests. `_refresh_integration_mappings` runs on every field add, rename
    and delete and rebuilds `field_mappings` wholesale from the current labels
    and field types, leaving `is_active` untouched — so deleting or renaming a
    form's contact fields silently empties the mappings that matter while the
    row still reads as active. `_process_event_request` then answers
    "missing required mapping(s)" to every submission, and that department is
    not feeding the pipeline at all. Selecting it would open the anonymous JSON
    endpoint for a department whose published form was never reaching the
    pipeline, which is a widening of a public surface rather than the
    preservation this backfill exists for.

    The runtime order is mirrored: `field_mappings` first, then the label and
    field-type fallback `_apply_label_fallback` applies when a required target
    is still missing.

    **Each field resolves to exactly one target, label first.**
    `_apply_label_fallback` reads `target = label_map.get(label)` and consults
    the field type only `if not target` — so a label that maps to anything at
    all settles that field outright. An `email`-typed field labelled "Name"
    therefore provides `contact_name` and **not** `contact_email`, and one
    labelled "Phone" provides `contact_phone`. Crediting a field with both its
    label's target and its type's is how an earlier version of this function
    qualified forms that produce nothing.

    Order does not matter, and that is a property of the runtime loop rather
    than an assumption about the labels: the candidate is computed *before* the
    `target not in used_targets` check, so a field's contribution never changes
    with position — a duplicate is skipped, never re-resolved down to its field
    type. The reachable set is therefore the union of one candidate per field,
    plus whatever the stored mappings already name.
    """
    targets: set = set()

    rows = bind.execute(
        sa.text(
            "SELECT field_mappings FROM form_integrations"
            " WHERE form_id = :form_id"
            "   AND integration_type = 'event_request'"
            "   AND is_active = 1"
        ),
        {"form_id": form_id},
    ).fetchall()
    for row in rows:
        mappings = _load_settings(row[0])
        targets.update(str(v) for v in mappings.values())

    fields = bind.execute(
        sa.text("SELECT label, field_type FROM form_fields WHERE form_id = :form_id"),
        {"form_id": form_id},
    ).fetchall()
    for label, field_type in fields:
        # `.strip().lower()`, matching the service, and compared in Python so
        # the columns' accent-insensitive utf8mb4_unicode_ci collation cannot
        # equate a label the service would not have matched.
        normalized = str(label or "").strip().lower()
        target = _LABEL_TARGETS.get(normalized)
        if not target:
            target = _FIELD_TYPE_TARGETS.get(str(field_type or "").strip().lower())
        if target:
            targets.add(target)

    return "contact_name" in targets and "contact_email" in targets


def _load_settings(raw) -> dict:
    """Read an organizations.settings value into a dict.

    MySQL's JSON type hands back a decoded object; MariaDB stores JSON as
    LONGTEXT and hands back the string.
    """
    if isinstance(raw, dict):
        return copy.deepcopy(raw)
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _target_org_ids(bind) -> list[str]:
    org_ids: list[str] = []
    seen: set = set()
    for form_id, organization_id in bind.execute(_CANDIDATE_REQUEST_FORMS):
        org_id = str(organization_id)
        if org_id in seen:
            continue
        if not _form_can_produce_a_request(bind, str(form_id)):
            continue
        seen.add(org_id)
        org_ids.append(org_id)
    return org_ids


def _enable_flag(bind, org_ids: list[str]) -> None:
    """Set ``accept_public_requests`` to true, skipping rows already carrying it."""
    for org_id in org_ids:
        row = bind.execute(
            sa.text("SELECT settings FROM organizations WHERE id = :id"),
            {"id": org_id},
        ).first()
        if row is None:
            continue

        settings = _load_settings(row[0])
        events = settings.get("events")
        if not isinstance(events, dict):
            events = {}
        pipeline = events.get("request_pipeline")
        if not isinstance(pipeline, dict):
            pipeline = {}

        if pipeline.get("accept_public_requests") is True:
            continue
        pipeline["accept_public_requests"] = True

        events["request_pipeline"] = pipeline
        settings["events"] = events
        bind.execute(
            sa.text("UPDATE organizations SET settings = :settings WHERE id = :id"),
            {"settings": json.dumps(settings), "id": org_id},
        )


def upgrade() -> None:
    if not (_has_table("organizations") and _has_table("forms")):
        return
    if not (_has_table("form_integrations") and _has_table("form_fields")):
        return
    bind = op.get_bind()
    _enable_flag(bind, _target_org_ids(bind))


def downgrade() -> None:
    """No-op — see "Irreversible" in the module docstring."""
