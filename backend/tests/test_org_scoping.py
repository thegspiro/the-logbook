"""
Unit tests for the shared multi-tenant org-scoping helper
(``app.utils.org_scoping``).

These exercise the fail-closed contract that the XC-1 remediation relies on:
a client-supplied FK id is accepted only when it names a row in the caller's
organization. The DB layer is faked (no MySQL needed) — the helper's only real
dependency is SQLAlchemy statement compilation.
"""

import pytest
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.utils.org_scoping import assert_all_in_org, assert_in_org, is_in_org


class _Base(DeclarativeBase):
    pass


class _Widget(_Base):
    __tablename__ = "widgets_test_org_scoping"

    id: Mapped[str] = mapped_column(primary_key=True)
    organization_id: Mapped[str] = mapped_column()


class _FakeResult:
    def __init__(self, val):
        self._val = val

    def scalar_one_or_none(self):
        return self._val


class _FakeMultiResult:
    def __init__(self, ids):
        self._ids = ids

    def all(self):
        return [(i,) for i in self._ids]


class _FakeSetSession:
    """Returns the subset of the queried ids that are seeded for the bound org.

    Mirrors ``WHERE id IN (:ids) AND organization_id = :org`` so the test
    asserts the list helper is genuinely org-scoping rather than just counting.
    """

    def __init__(self, seeded_ids, seeded_org):
        self.seeded_ids = {str(i) for i in seeded_ids}
        self.seeded_org = str(seeded_org)

    async def execute(self, stmt):
        # An IN clause compiles to a single expanding bindparam holding the
        # whole list, so flatten before matching.
        bound = set()
        for value in stmt.compile().params.values():
            if isinstance(value, (list, tuple, set)):
                bound.update(str(v) for v in value)
            else:
                bound.add(str(value))
        if self.seeded_org not in bound:
            return _FakeMultiResult([])
        return _FakeMultiResult(sorted(self.seeded_ids & bound))


class _FakeSession:
    """Returns a row only when the compiled query binds the seeded id AND org.

    This mirrors what a real ``WHERE id = :id AND organization_id = :org`` query
    would return, so the test asserts the helper is actually org-scoping.
    """

    def __init__(self, seeded_id, seeded_org):
        self.seeded_id = str(seeded_id)
        self.seeded_org = str(seeded_org)

    async def execute(self, stmt):
        bound = {str(v) for v in stmt.compile().params.values()}
        if self.seeded_id in bound and self.seeded_org in bound:
            return _FakeResult("row-exists")
        return _FakeResult(None)


async def test_is_in_org_true_for_same_org():
    db = _FakeSession("w1", "orgA")
    assert await is_in_org(db, _Widget, "w1", "orgA") is True


async def test_is_in_org_false_for_foreign_org():
    db = _FakeSession("w1", "orgA")
    # Right id, wrong org — must fail closed.
    assert await is_in_org(db, _Widget, "w1", "orgB") is False


async def test_is_in_org_false_for_missing_id_or_org():
    db = _FakeSession("w1", "orgA")
    assert await is_in_org(db, _Widget, None, "orgA") is False
    assert await is_in_org(db, _Widget, "w1", None) is False


async def test_assert_in_org_raises_for_foreign_row():
    db = _FakeSession("w1", "orgA")
    with pytest.raises(ValueError, match="Invalid widget"):
        await assert_in_org(db, _Widget, "w1", "orgB", label="widget")


async def test_assert_in_org_allows_none_when_optional():
    db = _FakeSession("w1", "orgA")
    # Should not raise — optional FK simply not set.
    await assert_in_org(db, _Widget, None, "orgA", allow_none=True)


async def test_assert_in_org_requires_id_by_default():
    db = _FakeSession("w1", "orgA")
    with pytest.raises(ValueError, match="required"):
        await assert_in_org(db, _Widget, None, "orgA", label="widget")


async def test_assert_in_org_passes_for_same_org():
    db = _FakeSession("w1", "orgA")
    # Should not raise.
    await assert_in_org(db, _Widget, "w1", "orgA", label="widget")


async def test_assert_all_in_org_passes_when_every_id_is_in_org():
    db = _FakeSetSession(["w1", "w2", "w3"], "orgA")
    # Should not raise.
    await assert_all_in_org(db, _Widget, ["w1", "w3"], "orgA", label="widget")


async def test_assert_all_in_org_raises_when_one_id_is_foreign():
    db = _FakeSetSession(["w1"], "orgA")
    with pytest.raises(ValueError, match="Invalid widget"):
        await assert_all_in_org(db, _Widget, ["w1", "w-other"], "orgA", label="widget")


async def test_assert_all_in_org_does_not_name_the_offending_id():
    """The message must not confirm an id exists (or not) in another org."""
    db = _FakeSetSession(["w1"], "orgA")
    with pytest.raises(ValueError, match="Invalid widget") as exc:
        await assert_all_in_org(db, _Widget, ["w-other"], "orgA", label="widget")
    assert "w-other" not in str(exc.value)


async def test_assert_all_in_org_accepts_empty_collections():
    db = _FakeSetSession([], "orgA")
    # No references is a valid state — only a *foreign* reference is a fault.
    await assert_all_in_org(db, _Widget, None, "orgA", label="widget")
    await assert_all_in_org(db, _Widget, [], "orgA", label="widget")
    await assert_all_in_org(db, _Widget, ["", None], "orgA", label="widget")


async def test_assert_all_in_org_fails_closed_without_an_org():
    db = _FakeSetSession(["w1"], "orgA")
    with pytest.raises(ValueError, match="Invalid widget"):
        await assert_all_in_org(db, _Widget, ["w1"], None, label="widget")
