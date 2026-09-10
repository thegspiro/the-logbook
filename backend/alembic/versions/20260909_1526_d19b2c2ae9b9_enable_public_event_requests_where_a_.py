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

So: every organization that has a **published, public** form carrying the
``event_request`` integration is, today, accepting public event requests. This
migration writes that fact down. It sets the flag unconditionally for those
organizations rather than only where the key is absent — a stored ``false`` on
such an organization cannot have meant "do not take requests from my published
form", because the toggle never controlled that form. Organizations with no
such form are left untouched and keep the shipped default.

Idempotent: an organization already carrying ``true`` is skipped, so a re-run
writes nothing.

Guarded on both tables existing. Fresh installs come up through
``create_all`` + stamp-head rather than by replaying this chain (CLAUDE.md
pitfall #26), and CI runs ``alembic upgrade head`` against an empty database.
``organizations`` and ``forms`` are both migration-built today, so the guard is
belt-and-braces — but a database with neither table has no rows to backfill
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
_ORG_IDS_WITH_PUBLISHED_REQUEST_FORM = sa.text("""
    SELECT DISTINCT f.organization_id
    FROM forms f
    LEFT JOIN form_integrations fi
        ON fi.form_id = f.id
       AND fi.integration_type = 'event_request'
       AND fi.is_active = 1
    WHERE f.status = 'published'
      AND f.is_public = 1
      AND (f.integration_type = 'event_request' OR fi.id IS NOT NULL)
    """)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


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
    return [str(row[0]) for row in bind.execute(_ORG_IDS_WITH_PUBLISHED_REQUEST_FORM)]


def _rewrite_flag(bind, org_ids: list[str], value: bool | None) -> None:
    """Set ``accept_public_requests`` to *value*, or drop the key when None."""
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
            if value is None:
                continue
            events = {}
        pipeline = events.get("request_pipeline")
        if not isinstance(pipeline, dict):
            if value is None:
                continue
            pipeline = {}

        if value is None:
            if pipeline.get("accept_public_requests") is not True:
                continue
            pipeline.pop("accept_public_requests", None)
        else:
            if pipeline.get("accept_public_requests") is value:
                continue
            pipeline["accept_public_requests"] = value

        events["request_pipeline"] = pipeline
        settings["events"] = events
        bind.execute(
            sa.text("UPDATE organizations SET settings = :settings WHERE id = :id"),
            {"settings": json.dumps(settings), "id": org_id},
        )


def upgrade() -> None:
    if not (_has_table("organizations") and _has_table("forms")):
        return
    if not _has_table("form_integrations"):
        return
    bind = op.get_bind()
    _rewrite_flag(bind, _target_org_ids(bind), True)


def downgrade() -> None:
    """Remove the flag from the organizations this migration selected.

    The exact inverse is not recoverable — nothing recorded which of the
    selected organizations already carried ``true`` — so this reverses the
    selection rather than the individual writes: the key is dropped wherever it
    is ``true`` on an organization with a published request form, returning it
    to "never configured". For an organization that had deliberately turned it
    on, that is still the right end state on a downgrade: the code being
    reverted to does not read the flag on the Forms path at all, so its stored
    value changes nothing there.
    """
    if not (_has_table("organizations") and _has_table("forms")):
        return
    if not _has_table("form_integrations"):
        return
    bind = op.get_bind()
    _rewrite_flag(bind, _target_org_ids(bind), None)
