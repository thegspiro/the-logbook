"""Regression tests for the endpoint permission/documentation checker.

Every case here corresponds to a way the checker was wrong before 2026-08-18,
and each wrong answer was in the dangerous direction: it made an unchecked or
mis-documented route look fine, or made a correct one look broken. Two of them
had been silently true across 202 routes.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import ast
import unittest

from check_endpoint_permissions import (
    authorizer_permissions,
    documented_permissions,
    enforced_permissions,
)


def route(src: str):
    """Parse a snippet and return (function node, module authorizer map)."""
    tree = ast.parse(src)
    fn = next(
        n
        for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        and not n.name.startswith("_authorize_")
    )
    return fn, authorizer_permissions(tree)


class DocstringSpellings(unittest.TestCase):
    """Both spellings in use must be read.

    Reading only one was not a miscount. A docstring the regex cannot see
    contributes no permissions at all, so it can never produce a `mismatch` —
    it lands in `understated`, a warning. Every route using the unread spelling
    was therefore exempt from the check the script exists to perform.
    """

    def test_requires_permission_spelling(self):
        perms, _ = documented_permissions("**Requires permission: training.view**")
        assert perms == {"training.view"}

    def test_permissions_required_spelling(self):
        perms, _ = documented_permissions(
            "**Permissions required:** facilities.view or facilities.manage"
        )
        assert perms == {"facilities.view", "facilities.manage"}

    def test_wrapped_list_keeps_every_permission(self):
        """A list too long for one line used to lose everything after the wrap.

        That reads as a `mismatch` — an ERROR — against a docstring that is
        complete and correct. Two routes were failing exactly this way.
        """
        perms, _ = documented_permissions(
            "    **Permissions required:** apparatus.view, apparatus.manage,\n"
            "    scheduling.view, or scheduling.manage\n"
        )
        assert perms == {"apparatus.view", "apparatus.manage", "scheduling.view", "scheduling.manage"}

    def test_prose_after_a_sentence_end_is_not_captured(self):
        """The wrap must not swallow the paragraph below it."""
        perms, _ = documented_permissions(
            "    **Permissions required:** scheduling.manage, or the shift's officer.\n"
            "    Unrelated prose mentioning apparatus.view should not count.\n"
        )
        assert perms == {"scheduling.manage"}

    def test_blank_line_stops_the_wrap(self):
        perms, _ = documented_permissions(
            "    **Permissions required:** roles.view\n"
            "\n"
            "    Later paragraph naming users.view.\n"
        )
        assert perms == {"roles.view"}


class SignatureEnforcement(unittest.TestCase):
    def test_reads_require_permission_dependency(self):
        fn, auth = route(
            "async def r(user=Depends(require_permission('a.view', 'a.manage'))): pass"
        )
        assert enforced_permissions(fn, auth) == {"a.view", "a.manage"}


class BodyAuthorizers(unittest.TestCase):
    """Permission enforcement that cannot live in the signature.

    The officer named on a shift may manage it without holding
    scheduling.manage, and that check needs the loaded shift row. Reading only
    the signature reported these as `undefended` — the script's most alarming
    finding, and here entirely wrong. Anyone "fixing" the report by adding the
    dependency would have removed the shift officer's access.
    """

    def test_permission_passed_at_the_call_site(self):
        fn, auth = route(
            "async def _authorize_shift_management(s, u, i, permission):\n"
            "    user_has_permission(u, permission)\n"
            "async def r(user=Depends(get_current_user)):\n"
            "    await _authorize_shift_management(s, user, i, 'scheduling.manage')\n"
        )
        assert enforced_permissions(fn, auth) == {"scheduling.manage"}

    def test_permission_hardcoded_inside_the_helper(self):
        """The call site names nothing; the helper's own body is the source."""
        fn, auth = route(
            "async def _authorize_assignment_management(s, u, i):\n"
            "    if not user_has_permission(u, 'scheduling.assign'):\n"
            "        raise HTTPException(403)\n"
            "async def r(user=Depends(get_current_user)):\n"
            "    await _authorize_assignment_management(s, user, i)\n"
        )
        assert enforced_permissions(fn, auth) == {"scheduling.assign"}

    def test_helper_taking_a_parameter_contributes_nothing_itself(self):
        """Otherwise a parameterised helper would leak one call site's literal
        into every other route that calls it."""
        _, auth = route(
            "async def _authorize_shift_management(s, u, i, permission):\n"
            "    user_has_permission(u, permission)\n"
            "async def r(): pass\n"
        )
        assert auth["_authorize_shift_management"] == set()

    def test_unrecognised_helper_is_not_treated_as_enforcement(self):
        """A guard the checker does not know about must NOT read as protection —
        that would turn a genuine `undefended` finding into a silent pass."""
        fn, auth = route(
            "async def r(user=Depends(get_current_user)):\n"
            "    await _some_other_helper(s, user, 'scheduling.manage')\n"
        )
        assert enforced_permissions(fn, auth) == set()


if __name__ == "__main__":
    unittest.main()
