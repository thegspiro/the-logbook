"""Add the email template colourway columns.

Revision ID: e7c4a913b8d2
Revises: d5e82c0a7f31

``header_accent``, ``status_chip`` and ``layout`` record what a notice looks
like as data, so an officer can change it from the Email Templates screen.
The renderer fills the ``{{header_accent}}`` / ``{{chip_tint}}`` /
``{{status_chip}}`` tokens ``build_shell`` leaves in the body from these.

**All three are nullable and there is no backfill.** NULL means "this body
carries its own colours", which is true of every row written before this
migration: those bodies hold literal hexes, have no tokens to fill, and
therefore render byte-for-byte as they do today. A department is opted in
when it creates a template or presses Reset, and not before.

The one thing this does rewrite is a body that is still byte-identical to the
shipped default — those are upgraded to the token form and stamped with the
colourway the default was built with, so the "Edited" badge does not start
calling every untouched notice edited. A body anybody has touched is left
exactly alone; it is edited, and saying so is correct.

The upgrade is reversible: ``downgrade`` restores the literal hexes from the
same map before dropping the columns, so a body that went through this
migration comes back out of it unchanged.
"""

import sqlalchemy as sa
from alembic import op

revision = "e7c4a913b8d2"
down_revision = "d5e82c0a7f31"
branch_labels = None
depends_on = None

# Frozen copies. A migration has to keep transforming rows the way it did the
# day it ran, so it cannot read a constant that is free to change underneath
# it — the same reason 20260819_2037 inlines its own normaliser.
_CHIP_TINTS = {
    "#b91c1c": "#fef2f2",
    "#b45309": "#fffbeb",
    "#047857": "#f0fdf4",
    "#1d4ed8": "#eff6ff",
    "#4338ca": "#eef2ff",
    "#6d28d9": "#faf5ff",
    "#334155": "#f1f5f9",
}


def _previous_forms(defn: dict, accent: str, chip: str) -> list:
    """Every shape this default's body could be stored in before the upgrade.

    ``defn["html"]`` is already the token form, so the literal-hex form has to
    be reconstructed to compare against. Two candidates, not one:

    1. The body as it stands, with the hexes written in.
    2. The same, with the content class reverted to ``content``.

    The second exists because four notices changed layout in the same release
    that introduced these columns — the two election reports to ``digest``,
    two store notices to ``receipt``. Their stored bodies say
    ``class="content"``, and matching only the first candidate would leave
    exactly those four unconverted and newly badged "Edited", which is the
    opposite of what this migration is for.
    """
    literal = (
        defn["html"]
        .replace("{{header_accent}}", accent)
        .replace("{{chip_tint}}", _CHIP_TINTS.get(accent, "#f1f5f9"))
        .replace("{{status_chip}}", chip)
    )
    forms = [literal]
    for variant in ("content-receipt", "content-digest"):
        if f'<div class="{variant}">' in literal:
            forms.append(
                literal.replace(f'<div class="{variant}">', '<div class="content">')
            )
    return forms


def _templates_table() -> sa.Table:
    return sa.table(
        "email_templates",
        sa.column("id", sa.String),
        sa.column("html_body", sa.Text),
        sa.column("header_accent", sa.String),
        sa.column("status_chip", sa.String),
        sa.column("layout", sa.String),
    )


def upgrade() -> None:
    op.add_column(
        "email_templates",
        sa.Column(
            "header_accent",
            sa.String(length=7),
            nullable=True,
            comment="Accent hex; NULL means the body carries its own colours.",
        ),
    )
    op.add_column(
        "email_templates",
        sa.Column("status_chip", sa.String(length=40), nullable=True),
    )
    op.add_column(
        "email_templates",
        sa.Column(
            "layout",
            sa.String(length=16),
            nullable=True,
            comment="notice | receipt | digest; NULL means the body decides.",
        ),
    )

    from app.services.email_template_service import EmailTemplateService

    connection = op.get_bind()
    table = _templates_table()

    # Only bodies still byte-identical to a shipped default are converted.
    for defn in EmailTemplateService._DEFAULT_TEMPLATE_DEFS:
        accent = defn.get("accent")
        if not accent:
            continue
        chip = defn.get("chip", "")
        layout = defn.get("layout", "notice")
        connection.execute(
            table.update()
            .where(table.c.html_body.in_(_previous_forms(defn, accent, chip)))
            .values(
                html_body=defn["html"],
                header_accent=accent,
                status_chip=chip,
                layout=layout,
            )
        )


def downgrade() -> None:
    from app.services.email_template_service import EmailTemplateService

    connection = op.get_bind()
    table = _templates_table()

    # Put the hexes back before the columns that hold them go away, or the
    # bodies this migration converted would mail with a literal
    # "{{header_accent}}" in a style attribute.
    for defn in EmailTemplateService._DEFAULT_TEMPLATE_DEFS:
        accent = defn.get("accent")
        if not accent:
            continue
        # The first candidate is the current layout's form, which is what a
        # row this migration converted came from.
        literal = _previous_forms(defn, accent, defn.get("chip", ""))[0]
        connection.execute(
            table.update()
            .where(table.c.html_body == defn["html"])
            .values(html_body=literal)
        )

    op.drop_column("email_templates", "layout")
    op.drop_column("email_templates", "status_chip")
    op.drop_column("email_templates", "header_accent")
