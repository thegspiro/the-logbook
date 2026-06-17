"""
Tests for the minutes template service (app/services/template_service.py).

Focus on the "single default template per meeting type" invariant
(_clear_defaults, and update_template clearing other defaults before
setting one), plus the CRUD guards (get/update/delete on a missing
template, and get_default_for_type). DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.schemas.minute import TemplateUpdate
from app.services.template_service import TemplateService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _db(side_effect):
    db = MagicMock()
    db.execute = AsyncMock(side_effect=side_effect)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    return db


def _tpl(**kw):
    return SimpleNamespace(
        id=kw.get("id", "t1"),
        organization_id="org-1",
        meeting_type=kw.get("meeting_type", "business"),
        is_default=kw.get("is_default", False),
        name=kw.get("name", "Template"),
    )


class TestClearDefaults:
    async def test_unsets_all_existing_defaults(self):
        t1, t2 = _tpl(id="a", is_default=True), _tpl(id="b", is_default=True)
        db = _db([_scalars([t1, t2])])
        await TemplateService(db)._clear_defaults("org-1", "business")
        assert t1.is_default is False
        assert t2.is_default is False

    async def test_no_existing_defaults_is_noop(self):
        db = _db([_scalars([])])
        await TemplateService(db)._clear_defaults("org-1", "business")
        # No exception; nothing to clear.


class TestGetDefaultForType:
    async def test_returns_default(self):
        tpl = _tpl(is_default=True)
        out = await TemplateService(_db([_one(tpl)])).get_default_for_type(
            "org-1", "business"
        )
        assert out is tpl

    async def test_none_when_absent(self):
        out = await TemplateService(_db([_one(None)])).get_default_for_type(
            "org-1", "business"
        )
        assert out is None


class TestUpdateTemplate:
    async def test_missing_returns_none(self):
        out = await TemplateService(_db([_one(None)])).update_template(
            "t1", "org-1", TemplateUpdate(name="X")
        )
        assert out is None

    async def test_setting_default_clears_others_first(self):
        tpl = _tpl(meeting_type="business", is_default=False)
        svc = TemplateService(_db([_one(tpl)]))
        svc._clear_defaults = AsyncMock()
        out = await svc.update_template("t1", "org-1", TemplateUpdate(is_default=True))
        # Other defaults for this meeting type are cleared before this one is set.
        svc._clear_defaults.assert_awaited_once()
        args = svc._clear_defaults.await_args.args
        assert args[1] == "business"
        assert out.is_default is True

    async def test_plain_field_update_does_not_clear_defaults(self):
        tpl = _tpl(name="Old")
        svc = TemplateService(_db([_one(tpl)]))
        svc._clear_defaults = AsyncMock()
        out = await svc.update_template("t1", "org-1", TemplateUpdate(name="New"))
        assert out.name == "New"
        svc._clear_defaults.assert_not_awaited()


class TestDeleteTemplate:
    async def test_missing_returns_false(self):
        assert (
            await TemplateService(_db([_one(None)])).delete_template("t1", "org-1")
            is False
        )

    async def test_success(self):
        db = _db([_one(_tpl())])
        assert await TemplateService(db).delete_template("t1", "org-1") is True
        db.delete.assert_awaited()
        db.commit.assert_awaited()


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
