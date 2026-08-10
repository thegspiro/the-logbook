"""Let untouched email templates track the built-in stylesheet.

``create_template`` used to copy ``DEFAULT_CSS`` into every row it created, so
an organization's templates were frozen on whatever stylesheet shipped the day
they signed up — improving the default reached new departments only. The
service now stores NULL and falls back to the current default at render time.

This migration NULLs out the rows that still hold a *verbatim* copy of one of
the two stylesheets we have ever shipped as the default. A department that
edited its CSS has something that matches neither string and is left alone.

Downgrade re-fills NULLs with the stylesheet in force at the time of writing,
so the column is never left NULL for code that predates the fallback.

Revision ID: 20260810_0003
Revises: 20260810_0002
Create Date: 2026-08-10
"""

import sqlalchemy as sa
from alembic import op

revision = "20260810_0003"
down_revision = "20260810_0002"
branch_labels = None
depends_on = None


# The stylesheet seeded by 20260206_0302 / 20260206_0303.
_SEEDED_CSS = """body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
.header h1 { margin: 0; font-size: 24px; }
.content { padding: 20px; background-color: #f9fafb; }
.content p { margin: 0 0 16px 0; }
.button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
.details { background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }
.footer { padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }"""

# The stylesheet EmailTemplateService copied into rows before this change.
_SERVICE_CSS = """
body { font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.logo { text-align: center; padding: 16px 0 0 0; }
.logo img { max-height: 80px; max-width: 200px; }
.header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
.header h1 { margin: 0; font-size: 24px; }
.content { padding: 20px; background-color: #f9fafb; }
.content p { margin: 0 0 16px 0; }
.button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
.details { background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; border: 1px solid #e5e7eb; }
.footer { padding: 20px; text-align: center; font-size: 12px; color: #4b5563; }
"""


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE email_templates SET css_styles = NULL "
            "WHERE css_styles IN (:seeded, :service)"
        ).bindparams(seeded=_SEEDED_CSS, service=_SERVICE_CSS)
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE email_templates SET css_styles = :service "
            "WHERE css_styles IS NULL"
        ).bindparams(service=_SERVICE_CSS)
    )
