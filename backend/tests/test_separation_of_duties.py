"""
Separation of duties.

One person must not occupy both sides of a control — raise a payment and
approve it, examine themselves, or sign off their own hours. ISO 27001 A.5.3
asks for this by name, and a department's bylaws normally require it for
disbursements specifically.
"""

import uuid

import pytest

from app.services.separation_of_duties import (
    SeparationOfDutiesError,
    assert_different_person,
)

pytestmark = [pytest.mark.unit]

_ALICE = str(uuid.uuid4())
_BOB = str(uuid.uuid4())


class TestAssertDifferentPerson:
    def test_rejects_the_same_person_on_both_sides(self):
        with pytest.raises(SeparationOfDutiesError) as exc:
            assert_different_person(
                _ALICE, _ALICE, action="approve", record="check request"
            )

        message = str(exc.value)
        assert "approve" in message
        assert "check request" in message

    def test_allows_two_different_people(self):
        assert_different_person(_ALICE, _BOB, action="approve", record="check request")

    def test_compares_as_strings(self):
        # ids arrive as UUID objects from path params and as str from the ORM;
        # comparing those directly would silently never match and disable the
        # control.
        with pytest.raises(SeparationOfDutiesError):
            assert_different_person(
                uuid.UUID(_ALICE), _ALICE, action="approve", record="expense report"
            )

    def test_is_a_value_error_so_endpoints_return_400(self):
        # The endpoint layer's existing `except ValueError` handling turns this
        # into a 400 with the message intact; if it stopped being a ValueError
        # those handlers would let it escape as a 500.
        assert issubclass(SeparationOfDutiesError, ValueError)

    @pytest.mark.parametrize(
        ("actor", "subject"),
        [(None, _ALICE), (_ALICE, None), (None, None), ("", _ALICE)],
    )
    def test_no_ops_when_either_side_is_unknown(self, actor, subject):
        # An unattributed record cannot be shown to be self-approval. Blocking
        # on absence would wedge legacy rows that predate the field.
        assert_different_person(actor, subject, action="approve", record="entry")


class TestTheDocumentedCoverageMatchesTheCode:
    """`docs/COMPLIANCE.md` maps ISO 27001 A.5.3 to this one helper, so the
    set of paths it actually guards is a compliance claim, not a detail.

    It drifted badly once: the control row named a single call site
    (`finance_service.approve_step()`) while the guard had reached twenty
    across eight modules, which understates the control to the reviewer who
    reads that page to aim an audit. Nothing checked it, so nothing caught it.
    This does.

    A new guarded module is a good thing and should fail here anyway — the
    fix is one line in the coverage table, and the alternative is the table
    silently going stale again.
    """

    # Modules holding at least one `assert_different_person` call, as the
    # coverage table in docs/COMPLIANCE.md enumerates them.
    _DOCUMENTED_MODULES = frozenset(
        {
            "app/api/v1/endpoints/skills_testing.py",
            "app/services/admin_hours_service.py",
            "app/services/course_cohort_service.py",
            "app/services/driver_exception_service.py",
            "app/services/finance_service.py",
            "app/services/minute_service.py",
            "app/services/storefront_service.py",
            "app/services/training_submission_service.py",
        }
    )

    @staticmethod
    def _call_sites():
        import ast
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1]
        found: dict[str, int] = {}
        for path in sorted((root / "app").rglob("*.py")):
            source = path.read_text()
            if "assert_different_person(" not in source:
                continue
            for node in ast.walk(ast.parse(source)):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "assert_different_person"
                ):
                    key = str(path.relative_to(root))
                    found[key] = found.get(key, 0) + 1
        return found

    def test_the_guarded_modules_are_the_documented_ones(self):
        actual = frozenset(self._call_sites())
        undocumented = actual - self._DOCUMENTED_MODULES
        assert not undocumented, (
            "these modules call assert_different_person but are missing from "
            "the coverage table in docs/COMPLIANCE.md: "
            + ", ".join(sorted(undocumented))
        )
        departed = self._DOCUMENTED_MODULES - actual
        assert not departed, (
            "the coverage table in docs/COMPLIANCE.md credits these modules "
            "with a guard they no longer have: " + ", ".join(sorted(departed))
        )

    def test_the_call_site_total_matches_the_documented_count(self):
        # The table says "22 call sites across 9 modules" -- 8 app modules plus
        # the helper's own definition module, which the sweep above skips.
        total = sum(self._call_sites().values())
        assert total == 22, (
            f"assert_different_person now has {total} call sites, not the 22 "
            "docs/COMPLIANCE.md claims; update the coverage table"
        )

    def test_the_sweep_itself_finds_something(self):
        # A silent zero-match walk would pass both assertions above while
        # checking nothing -- the failure mode that let the original claim rot.
        sites = self._call_sites()
        assert len(sites) >= 8
        assert sum(sites.values()) >= 22
