"""Settle every organization's email_service section into its canonical shape.

Two things changed on 2026-09-03 (PR #2196) about the ``email_service``
section of ``organizations.settings``:

* ``EmailServiceSettings.platform`` is validated against the five known
  values on write. A row saved earlier may carry any label (``sendgrid``,
  say) beside its ``smtp_*`` fields; the read path already presents such a
  label as ``selfhosted`` / ``other``, but only in the returned copy.
* The Gmail / Microsoft OAuth client-credential keys were removed from the
  schema. Nothing ever sent through them, but a row saved earlier still
  carries the encrypted secrets, and the write path prunes them only when
  an administrator next saves the section.

An organization that never revisits Settings > Email would keep both
indefinitely. This migration settles the rows already there, as the
repository's rule for JSON columns requires (CLAUDE.md pitfall #20): one
canonical stored shape, normalized on every write path, plus a migration
for existing rows.

The transform is inlined rather than imported from ``app.utils`` because a
migration must keep transforming rows the way it did the day it ran. It is
done in Python, not SQL JSON functions, so MySQL 8.0 and MariaDB 10.11 both
run it (the CI matrix covers both).

**This migration is not reversible.** The removed keys held encrypted OAuth
secrets that nothing reads and that cannot be reconstructed; the original
platform label is not kept. ``downgrade()`` is deliberately a no-op.

Revision ID: e3a9c1d5b7f2
Revises: 7bfe85f2e4e5
Create Date: 2026-09-03 13:00:00.000000
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "e3a9c1d5b7f2"
down_revision = "7bfe85f2e4e5"
branch_labels = None
depends_on = None

# Frozen copies of the runtime values, on purpose (see module docstring).
_EMAIL_PLATFORMS = ("gmail", "microsoft", "selfhosted", "cloudflare", "other")
_LEGACY_OAUTH_KEYS = (
    "google_client_id",
    "google_client_secret",
    "microsoft_tenant_id",
    "microsoft_client_id",
    "microsoft_client_secret",
)


def _load_settings(raw):
    """Normalize JSON values returned by different database drivers."""
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        if not raw.strip():
            return None
        raw = json.loads(raw)
    return raw if isinstance(raw, dict) else None


def _settle_email_section(section):
    """Return (settled_section, changed). ``section`` is not mutated."""
    if not isinstance(section, dict):
        return section, False
    settled = dict(section)
    changed = False

    platform = settled.get("platform")
    if platform not in _EMAIL_PLATFORMS:
        # Same rule as app.utils.email_providers.normalize_stored_platform on
        # the day this migration was written: a label with SMTP details is a
        # self-hosted server; anything else is "configure later".
        settled["platform"] = "selfhosted" if settled.get("smtp_host") else "other"
        changed = True

    for key in _LEGACY_OAUTH_KEYS:
        if key in settled:
            del settled[key]
            changed = True

    return settled, changed


def upgrade() -> None:
    bind = op.get_bind()
    if "organizations" not in sa.inspect(bind).get_table_names():
        return

    rows = bind.execute(
        sa.text("SELECT id, settings FROM organizations WHERE settings IS NOT NULL")
    ).fetchall()

    for org_id, raw_settings in rows:
        settings = _load_settings(raw_settings)
        if not settings:
            continue
        section = settings.get("email_service")
        if not isinstance(section, dict):
            continue
        settled, changed = _settle_email_section(section)
        if not changed:
            continue
        updated = dict(settings)
        updated["email_service"] = settled
        bind.execute(
            sa.text("UPDATE organizations SET settings = :settings WHERE id = :id"),
            {"settings": json.dumps(updated), "id": org_id},
        )


def downgrade() -> None:
    # Irreversible by design: the pruned keys held encrypted OAuth secrets
    # that nothing reads and cannot be reconstructed, and the original
    # platform label is not retained. The settled shape is also what the
    # previous code read without complaint, so a downgrade needs nothing.
    pass
