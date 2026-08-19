"""Bring a freshly migrated test database up to the shape production runs against.

Deployments do not rely on the Alembic chain alone. Application startup runs
``Base.metadata.create_all(checkfirst=True)`` followed by a missing-column
repair, and that is how model-only tables and later-added model columns
actually materialize in a running installation. 37 tables exist in the models
with no migration that creates them (``integrations``,
``approval_step_records``, ``positions``, ``skill_templates``, ...).

CI has to mirror that or it tests a database production never has. When the
contract suite ran without this step, every public endpoint reading one of
those tables answered 500 instead of its documented 404 — the four inbound
webhooks (documenso, calcom, salesforce, paypal) on ``integrations`` and the
three finance approval-token routes on ``approval_step_records``. Seven
failures, one missing step: the endpoints were fine, the schema was not.

This lived as a heredoc duplicated verbatim in two CI jobs. It is a file so the
two cannot drift apart, and so it can be run by hand when reproducing a CI
failure locally.
"""

import sys
from pathlib import Path

# `python - <<EOF` fed the old heredoc on stdin, where Python puts the *current
# directory* on sys.path — so `app` and `main` resolved from backend/. Running a
# file instead puts the *script's own directory* there, i.e. backend/scripts/,
# and both imports below fail with ModuleNotFoundError. Same bootstrap as the
# sibling scripts in this directory; it also makes the script runnable by hand
# from anywhere, not just from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from main import _add_missing_model_columns, _import_all_models


def main() -> None:
    # Importing every model module registers its table on Base.metadata, which
    # is what create_all diffs the database against. Base must be imported
    # after that call, not before, or metadata is read before it is populated.
    _import_all_models()

    from app.core.database import Base

    engine = create_engine(settings.SYNC_DATABASE_URL, poolclass=NullPool)
    try:
        with engine.begin() as conn:
            Base.metadata.create_all(conn, checkfirst=True)
        _add_missing_model_columns(engine)
    finally:
        engine.dispose()

    print("Schema repair complete")


if __name__ == "__main__":
    main()
