"""Recover from a migration that fails because its change is already there.

MySQL commits DDL as it goes, so a migration interrupted part-way, or a column
the startup column repair added from the models first, leaves a database where
re-running a migration raises "already exists" or "Duplicate column". Startup
used to answer that by stamping ``alembic_version`` to head, which marked every
migration still to come as applied without running any of them. One redundant
step silently dropped all the rest: an installation stamped that way kept
``event_requests.contact_email`` NOT NULL after the release that relaxed it,
and phone-only requests failed with "Internal server error".

``upgrade_skipping_duplicates`` instead finds the one migration that raised,
marks only it as applied, logs which it was, and carries on with the rest. A
healthy upgrade is a single ``upgrade`` call exactly as before; the per-step
work happens only after a failure.

The Alembic and database calls are passed in so the decision logic is tested
without a database; ``main.run_migrations`` supplies the real ones.
"""

from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from loguru import logger


def is_duplicate_error(error: BaseException) -> bool:
    """A failure that means the change a migration makes is already present."""
    text = str(error).lower()
    return "already exists" in text or "duplicate" in text


@dataclass(frozen=True)
class SkippedMigration:
    """A migration marked as applied after its change was found already present."""

    revision: str
    error: str


def _down_revisions(
    revisions: dict[str, tuple[str, ...]], revision: str
) -> tuple[str, ...]:
    return revisions.get(revision, ())


def _applied(revisions: dict[str, tuple[str, ...]], heads: Iterable[str]) -> set[str]:
    """Every revision at or below the stored heads."""
    seen: set[str] = set()
    stack = list(heads)
    while stack:
        rev = stack.pop()
        if rev in seen:
            continue
        seen.add(rev)
        stack.extend(_down_revisions(revisions, rev))
    return seen


def ready_revisions(
    revisions: dict[str, tuple[str, ...]], heads: Iterable[str], target: str
) -> list[str]:
    """The pending revisions Alembic could run next: not yet applied, needed
    for ``target``, and with every parent applied. Sorted, so the order a
    failure is looked for in does not depend on dict ordering."""
    applied = _applied(revisions, heads)
    needed = _applied(revisions, [target]) - applied
    return sorted(
        rev
        for rev in needed
        if all(parent in applied for parent in _down_revisions(revisions, rev))
    )


def heads_after_marking(
    revisions: dict[str, tuple[str, ...]], heads: Iterable[str], revision: str
) -> list[str]:
    """``alembic_version`` rows once ``revision`` counts as applied: it replaces
    its parents, as Alembic's own bookkeeping does for a step it ran."""
    parents = set(_down_revisions(revisions, revision))
    return sorted((set(heads) - parents) | {revision})


def upgrade_skipping_duplicates(
    *,
    revisions: dict[str, tuple[str, ...]],
    target: str,
    upgrade: Callable[[str], None],
    read_heads: Callable[[], list[str]],
    write_heads: Callable[[list[str]], None],
) -> list[SkippedMigration]:
    """Upgrade to ``target``; skip only a migration whose change already exists.

    ``revisions`` maps each revision id to its parents. ``upgrade`` runs
    ``alembic upgrade <rev>``; ``read_heads`` / ``write_heads`` read and replace
    the ``alembic_version`` rows. Any other error is raised unchanged, as is a
    duplicate error that cannot be pinned on one migration.

    Returns the migrations skipped, in the order they were skipped.
    """
    skipped: list[SkippedMigration] = []
    # Each round either finishes, skips one migration, or applies at least one,
    # so the number of revisions bounds the rounds.
    for _ in range(len(revisions) + 1):
        try:
            upgrade(target)
            return skipped
        except Exception as error:
            if not is_duplicate_error(error):
                raise
            first_error = error

        heads = read_heads()
        culprit: Optional[SkippedMigration] = None
        progressed = False
        for revision in ready_revisions(revisions, heads, target):
            try:
                upgrade(revision)
                progressed = True
            except Exception as error:
                if not is_duplicate_error(error):
                    raise
                culprit = SkippedMigration(revision=revision, error=str(error))
                break
            heads = read_heads()

        if culprit is not None:
            heads = read_heads()
            write_heads(heads_after_marking(revisions, heads, culprit.revision))
            logger.error(
                "Migration {} was marked as applied without completing, because "
                "its change already exists: {}",
                culprit.revision,
                culprit.error,
            )
            skipped.append(culprit)
            # Done once the target counts as applied; asking Alembic again
            # would only re-run a no-op upgrade.
            if target in _applied(revisions, read_heads()):
                return skipped
        elif not progressed:
            raise first_error
    raise RuntimeError("Migration recovery did not converge on the target revision")
