"""Rename the seeded outreach positions, and the report's name in its reminder.

The outreach vocabulary was unified on 2026-11-21 around a community risk
reduction framing (NFPA 1300): the leader is the **Community Outreach
Manager**, the members who deliver events are the **Community Outreach Team**,
and the report formerly called Community Engagement is **Outreach Impact**.
``DEFAULT_POSITIONS`` and the default email templates only reach departments
onboarded after this deploy, so this carries the new wording to rows already
stored.

**Only display text changes.** The slugs ``public_outreach`` and
``community_outreach_team`` stay: they key the permission registry and the
onboarding grants. No permission list is touched.

**Only rows still carrying the seeded wording are changed** — a system
position whose name (or description) is exactly the old default. A
department that renamed a position chose that title, and keeps it. In the
Guest Headcount Reminder template, only the exact phrase naming the report is
replaced, so a department's own edits to the rest of the body survive.

Idempotent: a second run finds no old wording to replace.

The downgrade restores the old wording under the same conditions. It cannot
tell a row this upgrade renamed from one a department renamed by hand to the
new default, so the latter is reverted too; that is the unavoidable cost of
reversing a rename nothing distinguishes from the seed.

Revision ID: 1a5c18b46791
Revises: 3daf47506e9e
Create Date: 2026-11-21 15:51:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "1a5c18b46791"
down_revision = "3daf47506e9e"
branch_labels = None
depends_on = None

# Frozen at this revision, not imported: a migration must keep targeting the
# rows it was written for after the registry and templates move on.
# (slug, field, old, new)
_POSITION_CHANGES = (
    ("public_outreach", "name", "Public Outreach", "Community Outreach Manager"),
    (
        "public_outreach",
        "description",
        "Manages public education and outreach events",
        "Leads the department's community outreach and risk reduction work",
    ),
    (
        "community_outreach_team",
        "name",
        "Community Education / Outreach Team",
        "Community Outreach Team",
    ),
    (
        "community_outreach_team",
        "description",
        "Members who deliver community education and public outreach events",
        "Members who deliver community outreach, education and risk reduction "
        "events",
    ),
)

_TEMPLATE_TYPE = "guest_headcount_reminder"
# The HTML default wraps the phrase across a line; the text default does not.
_TEMPLATE_PHRASES = (
    ("The Community\n        Engagement report", "The Outreach\n        Impact report"),
    ("The Community Engagement\nreport", "The Outreach Impact\nreport"),
)


def _has(bind, table: str) -> bool:
    return sa.inspect(bind).has_table(table)


def _apply(forward: bool) -> None:
    bind = op.get_bind()

    if _has(bind, "positions"):
        for slug, field, old, new in _POSITION_CHANGES:
            src, dst = (old, new) if forward else (new, old)
            # field is one of two literals above, never input.
            bind.execute(
                sa.text(
                    f"UPDATE positions SET {field} = :dst "
                    f"WHERE slug = :slug AND {field} = :src AND is_system = :sys"
                ),
                {"dst": dst, "src": src, "slug": slug, "sys": True},
            )

    if _has(bind, "email_templates"):
        for old, new in _TEMPLATE_PHRASES:
            src, dst = (old, new) if forward else (new, old)
            for column in ("html_body", "text_body"):
                bind.execute(
                    sa.text(
                        f"UPDATE email_templates "
                        f"SET {column} = REPLACE({column}, :src, :dst) "
                        "WHERE template_type = :type"
                    ),
                    # REPLACE leaves a body without the phrase unchanged.
                    {"src": src, "dst": dst, "type": _TEMPLATE_TYPE},
                )


def upgrade() -> None:
    _apply(forward=True)


def downgrade() -> None:
    _apply(forward=False)
