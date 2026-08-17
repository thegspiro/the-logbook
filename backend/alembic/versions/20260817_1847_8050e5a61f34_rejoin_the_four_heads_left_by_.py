"""rejoin the four heads left by concurrent migration PRs

Five separate pull requests each noticed that 20260816_0006 and 20260816_0007
had forked off 20260816_0005, and each fixed it independently. All five merged
within the hour, so the repair itself became the fork: four heads, plus two
files claiming revision id 20260816_0008.

What landed, and what happened to it:

* ``20260816_0008`` (driver exceptions) and ``20260816_0009`` (reversible
  completion effects) carry real schema work and take both forked revisions as
  parents. Both kept.
* ``71d86eba9a9e`` and ``bb34f8937c89`` are no-op merge revisions that do the
  same job as each other. Both kept — they may already be recorded in a
  deployment's ``alembic_version``, and deleting a revision a database has
  stamped strands it at an id its chain no longer contains.
* ``20260816_0008_merge_finalization_and_email_prefs.py`` was deleted rather
  than kept. It duplicated the ``20260816_0008`` id already held by the driver
  exceptions revision, which makes the versions directory unloadable — Alembic
  cannot resolve either one — so something had to go, and a no-op is the only
  member of the set whose removal has no schema consequence.

This revision names all four surviving heads as parents. Alembic runs each
ancestor exactly once no matter how many merge paths reach it, so the duplicate
reconciliations are harmless once rejoined.

Revision ID: 8050e5a61f34
Revises: 20260816_0008, 20260816_0009, 71d86eba9a9e, bb34f8937c89
Create Date: 2026-08-17 18:47:00.000000

"""

# revision identifiers, used by Alembic.
# Kept on one line: scripts/validate_migrations.py parses this file as text and
# reads a wrapped tuple as the literal "(".
revision = "8050e5a61f34"
down_revision = ("20260816_0008", "20260816_0009", "71d86eba9a9e", "bb34f8937c89")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """No schema change — this revision exists only to rejoin the heads."""


def downgrade() -> None:
    """No schema change — reversing this simply re-forks the chain."""
