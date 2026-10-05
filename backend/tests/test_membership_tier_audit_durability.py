"""A tier advance must commit its audit trail, not just the advancement.

LIFE-5. `MembershipTierService.advance_all` used to commit the membership-type
changes and *then* write their audit events, which left the trail depending on
somebody else committing afterwards. On the scheduled path nobody does:

    main.py   `async with async_session_factory() as db:`  -> close(), no commit
      run_membership_tier_advance(db)
        _for_each_org(db, ...)                             -> never commits
          advance_all(org)      commits the changes, THEN writes audit rows

`log_audit_event` opens a SAVEPOINT (`db.begin_nested()`); releasing it does
not commit the enclosing transaction, and `AsyncSession.__aexit__` only closes.
So the rows were discarded.

**Measured, not inferred.** Driving a cron-shaped advance (seed in one session,
`advance_all` in a session that is closed without committing, read back in a
third) moved a member from `active` to `senior` and wrote **zero**
`membership_tier_auto_advanced` rows. After the fix the same run wrote one, with
the advancement still persisted. That measurement needs three real sessions and
a committing write, so it is not what this file does — committing it would mean
a test that writes rows the `db_session` fixture cannot roll back, and a run
killed midway would strand them for every later test. What this file pins is the
ordering that makes the audit durable, which is the thing a future edit would
break.

The endpoint path survived the original ordering only because FastAPI's
`get_session` dependency commits on teardown. A service should not rely on its
caller to persist its own audit trail — least of all this one: it changes a
member's membership class unattended, and clears the operational rank of anyone
moved into an administrative tier, so the audit row is the only record that
those permissions went away.
"""

import ast
import inspect
import textwrap

import pytest

pytestmark = [pytest.mark.unit]


def _advance_all_tree() -> tuple[ast.AST, str]:
    from app.services.membership_tier_service import MembershipTierService

    source = textwrap.dedent(inspect.getsource(MembershipTierService.advance_all))
    return ast.parse(source), source


def _calls(tree: ast.AST, predicate) -> list[int]:
    """Line numbers of calls matching `predicate`, in source order."""
    return sorted(
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and predicate(node)
    )


def _is_commit(node: ast.Call) -> bool:
    return isinstance(node.func, ast.Attribute) and node.func.attr == "commit"


def _is_audit(node: ast.Call) -> bool:
    return (isinstance(node.func, ast.Name) and node.func.id == "log_audit_event") or (
        isinstance(node.func, ast.Attribute) and node.func.attr == "log_audit_event"
    )


class TestTheAuditTrailIsCommittedWithTheAdvancement:
    def test_the_audit_write_precedes_the_commit(self):
        tree, _ = _advance_all_tree()
        audits = _calls(tree, _is_audit)
        commits = _calls(tree, _is_commit)

        assert audits, "advance_all no longer audits its advancements at all"
        assert commits, "advance_all no longer commits"
        assert max(audits) < max(commits), (
            "advance_all commits before writing its audit events. "
            "`log_audit_event` only opens a SAVEPOINT, `_for_each_org` never "
            "commits, and the scheduled-task loop's session is closed without "
            "committing — so audit rows written after the last commit are "
            "discarded on the cron path, and the advancement lands unrecorded."
        )

    def test_exactly_one_commit_covers_the_advancements(self):
        """A second commit after the audit loop would work too, but two
        commits would split the change from its record again — the invariant
        is that the audit rows and the rows they describe land together."""
        tree, _ = _advance_all_tree()
        assert len(_calls(tree, _is_commit)) == 1, (
            "advance_all should commit once, after auditing, so the "
            "advancement and its audit trail are one atomic unit"
        )

    def test_every_advancement_is_audited_not_just_the_batch(self):
        """One audit row per member, not one per run: the event payload
        carries `cleared_rank`, so a batch-level record could not say whose
        rank was removed.

        Walked over the AST rather than searched for in the text. The comment
        that now explains this ordering names `log_audit_event` itself, so a
        string search finds the prose several lines before the call.
        """
        tree, _ = _advance_all_tree()
        in_a_loop = any(
            _calls(node, _is_audit)
            for node in ast.walk(tree)
            if isinstance(node, (ast.For, ast.AsyncFor))
        )
        assert in_a_loop, (
            "the audit call is no longer inside a loop, so a run advancing "
            "several members would record fewer rows than it changed"
        )
