"""Enable the Inventory module for organizations that use equipment checks

Equipment checklists moved to the Inventory module, and the
``/api/v1/equipment-checks`` router moved to ``module_gate("inventory")`` with
them. A department that had deliberately switched Inventory off would lose
equipment checks on upgrade — including the crew-facing half that still lives
on the shift screen — so this turns Inventory back on wherever checks are
actually in use.

Scope is much narrower than "every organization", for two reasons:

* ``ModuleSettings.inventory`` declares ``default=True``, and
  ``OrganizationService._trusted_stored_modules`` deliberately leaves an
  *absent* key out so Pydantic applies that default. An org with no stored
  ``inventory`` key already resolves to enabled; there is nothing to fix.
* An org with no stored ``modules`` dict at all is unconfigured, and likewise
  already resolves to the defaults.

So only an explicit stored ``"inventory": false`` needs rewriting.

The one shape that must be left alone even though it contains
``"inventory": false`` is onboarding's failed-dual-write signature: a dict
whose every field is False with no ``_user_configured`` marker.
``_trusted_stored_modules`` returns ``None`` for it, so the org already runs on
the declared defaults (Inventory on). Writing ``True`` into that dict would
make ``any(stored.values())`` true and promote it to a *trusted*
configuration — at which point every other False in it becomes a real choice
and the department loses every module it has. Skipping it is not a nicety.

Revision ID: 20260830_0002
Revises: 20260830_0001
Create Date: 2026-08-30 00:02:00.000000
"""

import copy
import json

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "20260830_0002"
down_revision = "20260830_0001"
branch_labels = None
depends_on = None


def _load(raw):
    """``settings`` is JSON; the driver hands back str or dict depending."""
    if isinstance(raw, str):
        return json.loads(raw or "{}")
    return raw or {}


def upgrade() -> None:
    bind = op.get_bind()

    orgs_with_templates = {
        row.organization_id
        for row in bind.execute(
            sa.text("SELECT DISTINCT organization_id FROM equipment_check_templates")
        )
    }

    rows = bind.execute(sa.text("SELECT id, settings FROM organizations")).fetchall()
    for row in rows:
        settings = _load(row.settings)
        modules = settings.get("modules")
        if not isinstance(modules, dict) or not modules:
            continue  # unconfigured: already resolves to the True default

        # Mirrors _trusted_stored_modules. An untrusted dict is ignored by the
        # resolver, so the org is already on the defaults — and writing to it
        # would promote it to trusted. See the module docstring.
        if not (
            any(bool(v) for k, v in modules.items() if k != "_user_configured")
            or modules.get("_user_configured")
        ):
            continue

        if modules.get("inventory") is not False:
            continue  # absent -> default True; already True -> nothing to do

        uses_checks = bool(modules.get("scheduling")) or row.id in orgs_with_templates
        if not uses_checks:
            continue

        # Raw SQL, so SQLAlchemy's change detection is not what is being
        # guarded here — but deep-copy anyway (CLAUDE.md pitfall #12): the next
        # person to touch this will reach for the ORM, and it also stops a
        # nested reference being shared across loop iterations.
        updated = copy.deepcopy(settings)
        updated["modules"]["inventory"] = True
        bind.execute(
            sa.text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {"s": json.dumps(updated), "id": row.id},
        )


def downgrade() -> None:
    """Deliberately a no-op.

    Nothing distinguishes an organization this migration switched Inventory on
    for from one that always had it on, so switching it back off would take
    departments' gear catalogues with it to undo a change they never saw.
    """
