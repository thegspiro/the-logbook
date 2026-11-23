#!/usr/bin/env python3
"""Report, and optionally rejoin, a forked Alembic chain.

Two pull requests that each add a migration on the same parent both pass CI,
and whichever merges second leaves ``main`` with two heads; ``alembic upgrade
head`` then refuses to run anywhere. The fix is always the same file: a merge
revision whose ``down_revision`` is the tuple of heads and whose upgrade and
downgrade do nothing. ``.github/workflows/rejoin-migration-heads.yml`` runs
this on every push to ``main`` that touches the versions directory and opens
that file as a pull request.

**The revision id is derived from the heads, not random.** The merge for a
given set of heads is therefore the same file whoever writes it. On
2026-11-14 three sessions each wrote their own merge revision for one pair of
heads, and the two that merged 25 seconds apart forked ``main`` again
(docs/rules/migrations.md, "Parallel branches and a single head"). Two copies
of an identical file merge into one.

Usage:
    python3 scripts/rejoin_migration_heads.py            # report heads
    python3 scripts/rejoin_migration_heads.py --write    # write the merge

Exit status: 0 when the chain has one head (nothing written), 1 when it has
more than one and ``--write`` was not given, 2 when the chain cannot be read,
3 when a merge revision was written. With ``$GITHUB_OUTPUT`` set, ``heads``,
``revision`` and ``path`` are appended to it as key=value lines.

Reads the revision files only; no database and no ``env.py`` are involved,
so it needs nothing beyond ``alembic`` and ``sqlalchemy``.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SCRIPT_LOCATION = REPO_ROOT / "backend" / "alembic"

EXIT_ONE_HEAD = 0
EXIT_FORKED = 1
EXIT_ERROR = 2
EXIT_WROTE = 3

# A revision file name starts "YYYYMMDD_HHMM_"; the merge is stamped one
# minute after the newest head so it sorts after the revisions it joins.
_STAMP = re.compile(r"^(\d{8}_\d{4})_")


class ChainError(Exception):
    """The versions directory could not be read as an Alembic chain."""


def revision_id_for(heads: Sequence[str]) -> str:
    """The merge revision's id: the same for the same heads, in any order."""
    digest = hashlib.sha256(("merge:" + ",".join(sorted(heads))).encode()).hexdigest()
    return digest[:12]


def _script_directory(script_location: Path):
    from alembic.script import ScriptDirectory

    if not (script_location / "versions").is_dir():
        raise ChainError(f"no versions directory under {script_location}")
    try:
        return ScriptDirectory(str(script_location))
    except Exception as exc:  # alembic raises several types for a bad chain
        raise ChainError(f"cannot read the chain: {exc}") from exc


def heads_of(script_location: Path) -> list[str]:
    try:
        heads = list(_script_directory(script_location).get_heads())
    except ChainError:
        raise
    except Exception as exc:
        raise ChainError(f"cannot read the chain: {exc}") from exc
    if not heads:
        raise ChainError("the chain has no head")
    return sorted(heads)


def _first_line(text: Optional[str]) -> str:
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip().rstrip(".")
    return "no message"


def _stamp_after(paths: Sequence[str]) -> str:
    stamps = []
    for path in paths:
        match = _STAMP.match(Path(path).name)
        if match:
            stamps.append(datetime.strptime(match.group(1), "%Y%m%d_%H%M"))
    if not stamps:
        raise ChainError("no head file carries a YYYYMMDD_HHMM_ prefix to sort after")
    return (max(stamps) + timedelta(minutes=1)).strftime("%Y%m%d_%H%M")


def render_merge(revision: str, heads: Sequence[str], messages: dict[str, str]) -> str:
    """The merge revision file, in the repository's style for merge revisions."""
    named = "\n".join(f'- ``{head}`` ("{messages[head]}")' for head in heads)
    revises = ", ".join(heads)
    tuple_literal = ", ".join(f'"{head}"' for head in heads)
    return f'''"""Merge {len(heads)} migration heads on main

Written by scripts/rejoin_migration_heads.py. These heads each saw a single
head in their own branch's CI run, and all of them landed on ``main``:

{named}

``alembic upgrade head`` fails until they are rejoined. Nothing is created
here. Each revision already ran its own DDL; Alembic runs each revision exactly
once no matter how many merge paths reach it.

The revision id is derived from the heads, so any other merge of exactly these
heads is this same file and cannot fork the chain again.

Revision ID: {revision}
Revises: {revises}
"""

from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "{revision}"
# Keep the tuple on one line: the repository's lightweight migration-chain
# validators intentionally parse revision metadata one physical line at a time.
# fmt: off
down_revision: Union[str, Sequence[str], None] = ({tuple_literal})
# fmt: on
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: a merge revision only reconciles the revision graph."""


def downgrade() -> None:
    """No-op: splitting the graph back into separate heads needs no DDL."""
'''


def write_merge(script_location: Path) -> Optional[Path]:
    """Write the merge revision for a forked chain; None when there is one head."""
    directory = _script_directory(script_location)
    heads = heads_of(script_location)
    if len(heads) == 1:
        return None
    revision = revision_id_for(heads)
    known = {script.revision for script in directory.walk_revisions()}
    if revision in known:
        # Reached only when the file exists yet does not join these heads.
        raise ChainError(
            f"revision {revision} already exists and does not join {heads}"
        )
    scripts = {head: directory.get_revision(head) for head in heads}
    messages = {head: _first_line(scripts[head].doc) for head in heads}
    stamp = _stamp_after([scripts[head].path for head in heads])
    short = "_".join(head[:6] for head in heads)
    path = script_location / "versions" / f"{stamp}_{revision}_merge_heads_{short}.py"
    path.write_text(render_merge(revision, heads, messages), encoding="utf-8")
    return path


def _github_output(values: dict[str, str]) -> None:
    target = os.environ.get("GITHUB_OUTPUT")
    if not target:
        return
    with open(target, "a", encoding="utf-8") as fh:
        for key, value in values.items():
            fh.write(f"{key}={value}\n")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true", help="write the merge revision")
    parser.add_argument(
        "--script-location",
        type=Path,
        default=DEFAULT_SCRIPT_LOCATION,
        help="the alembic directory holding versions/ (default: backend/alembic)",
    )
    args = parser.parse_args(argv)

    try:
        heads = heads_of(args.script_location)
        print("heads: " + " ".join(heads))
        if len(heads) == 1:
            _github_output({"heads": heads[0], "revision": "", "path": ""})
            return EXIT_ONE_HEAD
        if not args.write:
            print(f"the chain has {len(heads)} heads; run with --write to join them")
            _github_output({"heads": " ".join(heads), "revision": "", "path": ""})
            return EXIT_FORKED
        path = write_merge(args.script_location)
    except ChainError as exc:
        print(f"rejoin-migration-heads: {exc}", file=sys.stderr)
        return EXIT_ERROR

    assert path is not None  # more than one head was confirmed above
    revision = revision_id_for(heads)
    try:
        shown = str(path.relative_to(REPO_ROOT))
    except ValueError:
        shown = str(path)
    print(f"wrote {shown} (revision {revision})")
    _github_output({"heads": " ".join(heads), "revision": revision, "path": shown})
    return EXIT_WROTE


if __name__ == "__main__":
    sys.exit(main())
