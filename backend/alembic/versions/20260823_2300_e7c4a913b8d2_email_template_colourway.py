"""Add the email template colourway columns.

Revision ID: e7c4a913b8d2
Revises: e4b91c7d2a58

``header_accent``, ``status_chip`` and ``layout`` record what a notice looks
like as data, so an officer can change it from the Email Templates screen.
The renderer fills the ``{{header_accent}}`` / ``{{chip_tint}}`` /
``{{status_chip}}`` tokens ``build_shell`` leaves in the body from these.

**All three are nullable and there is no backfill.** NULL means "this body
carries its own colours", which is true of every row written before this
migration: those bodies hold literal hexes, have no tokens to fill, and
therefore render byte-for-byte as they do today. A department is opted in
when it creates a template or presses Reset, and not before.

The one thing this rewrites is a body still byte-identical to the *current*
shipped default — upgraded to the token form and stamped with the colourway
that default was built with. A body anybody has touched is left exactly
alone.

**What that does and does not reach.** The 1b shell and these columns land in
the same change, so a department upgrading straight from the previous release
holds a pre-1b body — centred logo, solid header band — which no amount of
token substitution reconstructs, and which this migration therefore does not
match or convert. That is deliberate and is the rollout the change chose:
existing wording is left alone and a department adopts the new design per
template with Reset, which the banner on the Templates tab says. The rows this
does convert are the ones written by an intermediate build — a staging
environment tracking main between the two commits — where the body is already
the 1b shell with its hexes written in and only the columns are missing.

The upgrade is reversible: ``downgrade`` restores the literal hexes from the
same map before dropping the columns, so a body that went through this
migration comes back out of it unchanged.
"""

import html

import sqlalchemy as sa
from alembic import op

revision = "e7c4a913b8d2"
down_revision = "e4b91c7d2a58"
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


_LAYOUT_CLASSES = {
    "notice": "content",
    "receipt": "content-receipt",
    "digest": "content-digest",
}


def _materialise(body: str, accent: str, chip: str, layout: str = "notice") -> str:
    """Write a colourway into a token-bearing body, as the renderer would.

    Every token ``build_shell`` defers, not only the colours: a downgrade
    drops the columns that answer them, so one left behind would mail a
    literal ``{{content_class}}`` as a class attribute and a
    ``{{status_chip_cell}}`` as text.

    Frozen copies of the tint map, the layout classes and the chip markup,
    for the reason every migration keeps its own: it has to keep
    transforming rows the way it did the day it ran, and the helpers these
    mirror are free to change underneath it.
    """
    tint = _CHIP_TINTS.get(accent, "#f1f5f9")
    cell = ""
    if chip:
        cell = (
            '<td style="text-align: right;">'
            f'<span class="chip" style="background-color: {tint}; '
            f'color: {accent};">{html.escape(str(chip))}</span></td>'
        )
    return (
        body.replace("{{header_accent}}", accent)
        .replace("{{chip_tint}}", tint)
        .replace("{{status_chip_cell}}", cell)
        .replace("{{status_chip}}", chip)
        .replace(
            "{{content_class}}", _LAYOUT_CLASSES.get(layout or "notice", "content")
        )
    )


def _previous_forms(defn: dict, accent: str, chip: str) -> list:
    """Every shape this default's body could be stored in before the upgrade.

    One candidate: ``defn["html"]`` with the colour tokens written back in as
    hexes. The layout is not part of it — the content class is chosen when the
    mail is rendered, from the ``layout`` column, so the stored body is the
    same whichever layout a notice uses and a notice that changed layout needs
    no separate form to match.

    A list rather than a single value because the ``in_()`` in ``upgrade``
    takes one, and because the shape this has to recognise is the sort of
    thing that grows a second entry later.
    """
    return [_materialise(defn["html"], accent, chip)]


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

    # Put the colours back into the bodies before the columns that hold them
    # go away, or a converted body would mail a literal "{{header_accent}}"
    # in a style attribute.
    #
    # Row by row, from each row's own header_accent / status_chip, not from
    # the shipped default: a department that recoloured a notice after the
    # upgrade still has a body byte-identical to defn["html"], so writing the
    # shipped accent back into it would silently discard their choice at the
    # moment the column that recorded it is dropped — an unrecoverable loss
    # in the one direction that is supposed to be the safe way out.
    for defn in EmailTemplateService._DEFAULT_TEMPLATE_DEFS:
        if not defn.get("accent"):
            continue
        rows = connection.execute(
            sa.select(
                table.c.id,
                table.c.header_accent,
                table.c.status_chip,
                table.c.layout,
            ).where(table.c.html_body == defn["html"])
        ).fetchall()
        for row_id, accent, chip, layout in rows:
            accent = accent or defn["accent"]
            chip = defn.get("chip", "") if chip is None else chip
            layout = layout or defn.get("layout", "notice")
            connection.execute(
                table.update()
                .where(table.c.id == row_id)
                .values(html_body=_materialise(defn["html"], accent, chip, layout))
            )

    op.drop_column("email_templates", "layout")
    op.drop_column("email_templates", "status_chip")
    op.drop_column("email_templates", "header_accent")
