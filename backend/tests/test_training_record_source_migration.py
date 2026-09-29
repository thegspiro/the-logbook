"""The training-record source link: its migration and the model agree.

``training_records.source_event_id`` plus the unique (source_event_id, user_id)
index is what lets finalizing an event's attendance update a member's credit in
place across a reopen, rather than filing a second record. These checks pin the
migration's shape — each step guarded on its own, the downgrade undoing it in
the order MySQL accepts — and that the model declares the same objects, since
startup's ``create_all`` builds from the model on a fresh install.
"""

from pathlib import Path

import pytest

from app.models.training import TrainingRecord

pytestmark = pytest.mark.unit

REVISION = "2b15c5a8ba82"


def _source() -> str:
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = [p for p in versions.glob("*.py") if REVISION in p.name]
    assert matches, f"no migration file for {REVISION}"
    return matches[0].read_text(encoding="utf-8")


class TestMigration:
    def test_chains_from_the_previous_head(self):
        assert 'down_revision = "fb7da5b05833"' in _source()

    def test_every_step_is_guarded_on_its_own(self):
        """Startup's create_all and column repair can build any one of the
        three objects before this revision runs; each guard stands alone so a
        partial build still upgrades."""
        upgrade = _source().split("def upgrade()", 1)[1].split("def downgrade()")[0]
        assert "if not _has_column(_COLUMN):" in upgrade
        assert "if not _has_index(_INDEX):" in upgrade
        assert "if not _foreign_keys_on(_COLUMN):" in upgrade

    def test_index_is_unique_over_event_and_member(self):
        upgrade = _source().split("def upgrade()", 1)[1].split("def downgrade()")[0]
        assert 'op.create_index(_INDEX, _TABLE, [_COLUMN, "user_id"], unique=True)' in (
            upgrade
        )
        # Before the key, so MySQL adopts it as the key's backing index.
        assert upgrade.index("op.create_index") < upgrade.index("op.create_foreign_key")

    def test_foreign_key_sets_null(self):
        """An event's deletion must not take the member's history with it."""
        assert 'ondelete="SET NULL"' in _source()

    def test_downgrade_drops_key_then_index_then_column(self):
        downgrade = _source().split("def downgrade()", 1)[1]
        key = downgrade.index("op.drop_constraint")
        index = downgrade.index("op.drop_index")
        column = downgrade.index("op.drop_column")
        assert key < index < column


class TestModelMatchesMigration:
    def test_column_is_nullable_with_set_null_key(self):
        column = TrainingRecord.__table__.c.source_event_id
        assert column.nullable is True  # CLAUDE.md pitfall #2
        (fk,) = column.foreign_keys
        assert fk.column.table.name == "events"
        assert fk.ondelete == "SET NULL"

    def test_unique_index_is_declared(self):
        indexes = {ix.name: ix for ix in TrainingRecord.__table__.indexes}
        index = indexes["uq_training_record_event_user"]
        assert index.unique is True
        assert [c.name for c in index.columns] == ["source_event_id", "user_id"]
