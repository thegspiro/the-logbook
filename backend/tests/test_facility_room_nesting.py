"""
Nested Facility Room Tests

Rooms can sit inside other rooms — a quartermaster's storage space within the
volunteer office. Four things have to hold for that to be safe:

* the parent belongs to the caller's org (CLAUDE.md pitfall #14c),
* the parent is in the same facility, so a room isn't in two buildings at once,
* no room ends up inside its own subtree,
* deleting a room keeps its sub-rooms, re-parented a level up.

Mocked sessions — no DB — so it runs in the sandbox.
"""

import importlib.util
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.facilities import FacilityRoomCreate, FacilityRoomUpdate
from app.services.facilities_service import MAX_ROOM_NESTING_DEPTH, FacilitiesService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return FacilitiesService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


@pytest.fixture
def facility_id():
    return str(uuid4())


def make_room(room_id, facility_id, parent_room_id=None, name="Room"):
    room = MagicMock()
    room.id = room_id
    room.facility_id = facility_id
    room.parent_room_id = parent_room_id
    room.name = name
    return room


@pytest.mark.parametrize(
    ("schema", "payload"),
    [
        (FacilityRoomCreate, {"facility_id": "facility", "name": "Room"}),
        (FacilityRoomUpdate, {}),
    ],
)
def test_empty_parent_room_id_is_rejected(schema, payload):
    with pytest.raises(ValidationError):
        schema(parent_room_id="", **payload)


class TestAssertParentRoomValid:
    async def test_no_parent_is_a_noop(self, service, org_id, facility_id):
        with patch.object(service, "get_room") as mock_get:
            await service._assert_parent_room_valid(None, org_id, facility_id)
        mock_get.assert_not_called()

    async def test_room_cannot_contain_itself(self, service, org_id, facility_id):
        room_id = str(uuid4())
        with pytest.raises(ValueError, match="inside itself"):
            await service._assert_parent_room_valid(
                room_id, org_id, facility_id, room_id=room_id
            )

    async def test_parent_outside_org_is_rejected(self, service, org_id, facility_id):
        # get_room is org-scoped, so another org's room resolves to None.
        with patch.object(service, "get_room", return_value=None):
            with pytest.raises(ValueError, match="Invalid parent room"):
                await service._assert_parent_room_valid(
                    str(uuid4()), org_id, facility_id
                )

    async def test_parent_in_another_facility_is_rejected(
        self, service, org_id, facility_id
    ):
        other_facility_parent = make_room(str(uuid4()), str(uuid4()))
        with patch.object(service, "get_room", return_value=other_facility_parent):
            with pytest.raises(ValueError, match="same facility"):
                await service._assert_parent_room_valid(
                    other_facility_parent.id, org_id, facility_id
                )

    async def test_parent_inside_own_subtree_is_rejected(
        self, service, org_id, facility_id
    ):
        room_id = str(uuid4())
        descendant = make_room(str(uuid4()), facility_id, parent_room_id=room_id)
        with patch.object(service, "get_room", return_value=descendant), patch.object(
            service, "_room_descendants", return_value=({descendant.id}, 2)
        ):
            with pytest.raises(ValueError, match="own sub-rooms"):
                await service._assert_parent_room_valid(
                    descendant.id, org_id, facility_id, room_id=room_id
                )

    async def test_exceeding_the_depth_cap_is_rejected(
        self, service, org_id, facility_id
    ):
        parent = make_room(str(uuid4()), facility_id)
        with patch.object(service, "get_room", return_value=parent), patch.object(
            service, "_room_depth", return_value=MAX_ROOM_NESTING_DEPTH
        ):
            with pytest.raises(ValueError, match="levels deep"):
                await service._assert_parent_room_valid(parent.id, org_id, facility_id)

    async def test_valid_parent_passes(self, service, org_id, facility_id):
        parent = make_room(str(uuid4()), facility_id)
        with patch.object(service, "get_room", return_value=parent), patch.object(
            service, "_room_depth", return_value=1
        ):
            await service._assert_parent_room_valid(parent.id, org_id, facility_id)


class TestCreateRoomNesting:
    async def test_create_validates_the_parent(self, service, org_id, facility_id):
        with patch.object(
            service, "get_facility", return_value=MagicMock()
        ), patch.object(service, "get_room", return_value=None):
            with pytest.raises(ValueError, match="Invalid parent room"):
                await service.create_room(
                    FacilityRoomCreate(
                        facility_id=facility_id,
                        name="Quartermaster's Storage",
                        parent_room_id=str(uuid4()),
                    ),
                    org_id,
                    created_by=str(uuid4()),
                )


class TestUpdateRoomNesting:
    async def test_untouched_nesting_skips_the_walk(self, service, org_id, facility_id):
        room = make_room(str(uuid4()), facility_id)
        with patch.object(service, "get_room", return_value=room), patch.object(
            service, "get_facility", return_value=None
        ), patch.object(service, "_assert_parent_room_valid") as mock_assert:
            await service.update_room(room.id, FacilityRoomUpdate(capacity=12), org_id)
        mock_assert.assert_not_called()

    async def test_moving_buildings_revalidates_the_untouched_parent(
        self, service, org_id, facility_id
    ):
        """The parent stays behind in the old station — that has to be caught."""
        parent_id = str(uuid4())
        room = make_room(str(uuid4()), facility_id, parent_room_id=parent_id)
        new_facility_id = str(uuid4())

        with patch.object(service, "get_room", return_value=room), patch.object(
            service, "_assert_facility_in_org"
        ), patch.object(service, "get_facility", return_value=None), patch.object(
            service, "_room_descendants", return_value=(set(), 1)
        ), patch.object(
            service, "_assert_parent_room_valid"
        ) as mock_assert:
            await service.update_room(
                room.id, FacilityRoomUpdate(facility_id=new_facility_id), org_id
            )

        mock_assert.assert_awaited_once_with(
            parent_id, org_id, new_facility_id, room_id=room.id
        )

    async def test_clearing_the_parent_is_validated_as_top_level(
        self, service, org_id, facility_id
    ):
        room = make_room(str(uuid4()), facility_id, parent_room_id=str(uuid4()))

        with patch.object(service, "get_room", return_value=room), patch.object(
            service, "get_facility", return_value=None
        ), patch.object(
            # Clearing the parent changes the containment path, so update_room
            # now walks the subtree to refresh descendant Location names.
            service,
            "_room_descendants",
            return_value=(set(), 1),
        ), patch.object(
            service, "_assert_parent_room_valid"
        ) as mock_assert:
            await service.update_room(
                room.id, FacilityRoomUpdate(parent_room_id=None), org_id
            )

        mock_assert.assert_awaited_once_with(None, org_id, facility_id, room_id=room.id)
        assert room.parent_room_id is None


class TestSubtreeFollowsAMovedRoom:
    async def test_descendants_change_building_with_their_container(
        self, service, org_id, facility_id
    ):
        """A storage closet cannot stay behind when the office it is in moves."""
        room = make_room(str(uuid4()), facility_id)
        child = make_room(str(uuid4()), facility_id, parent_room_id=room.id)
        new_facility = MagicMock()
        new_facility.id = str(uuid4())

        result = MagicMock()
        result.scalars.return_value.all.return_value = [child]
        service.db.execute.return_value = result

        with patch.object(service, "get_room", return_value=room), patch.object(
            service, "_assert_facility_in_org"
        ), patch.object(
            service, "get_facility", return_value=new_facility
        ), patch.object(
            service, "_assert_parent_room_valid"
        ), patch.object(
            service, "_room_descendants", return_value=({child.id}, 2)
        ), patch.object(
            service, "_sync_room_location"
        ) as mock_sync:
            await service.update_room(
                room.id, FacilityRoomUpdate(facility_id=new_facility.id), org_id
            )

        assert child.facility_id == new_facility.id
        mock_sync.assert_any_await(child, new_facility, org_id)

    async def test_reparenting_refreshes_descendant_location_names(
        self, service, org_id, facility_id
    ):
        """Sub-room Location names embed the containment path, so moving a
        room under a different parent goes stale a level down even though
        neither the building nor any name changed."""
        old_parent_id = str(uuid4())
        new_parent_id = str(uuid4())
        room = make_room(str(uuid4()), facility_id, parent_room_id=old_parent_id)
        child = make_room(str(uuid4()), facility_id, parent_room_id=room.id)
        facility = MagicMock()
        facility.id = facility_id

        result = MagicMock()
        result.scalars.return_value.all.return_value = [child]
        service.db.execute.return_value = result

        with patch.object(service, "get_room", return_value=room), patch.object(
            service, "get_facility", return_value=facility
        ), patch.object(service, "_assert_parent_room_valid"), patch.object(
            service, "_room_descendants", return_value=({child.id}, 2)
        ), patch.object(
            service, "_sync_room_location"
        ) as mock_sync:
            await service.update_room(
                room.id, FacilityRoomUpdate(parent_room_id=new_parent_id), org_id
            )

        # Same building: only the name path is rewritten, the child stays put.
        assert child.facility_id == facility_id
        mock_sync.assert_any_await(child, facility, org_id)

    async def test_resending_the_unchanged_parent_skips_the_descendant_walk(
        self, service, org_id, facility_id
    ):
        """The form sends every field it owns, so an update usually carries
        the parent it already had — that must not trigger a subtree resync."""
        parent_id = str(uuid4())
        room = make_room(str(uuid4()), facility_id, parent_room_id=parent_id)
        facility = MagicMock()
        facility.id = facility_id

        with patch.object(service, "get_room", return_value=room), patch.object(
            service, "get_facility", return_value=facility
        ), patch.object(service, "_assert_parent_room_valid"), patch.object(
            service, "_room_descendants"
        ) as mock_descendants, patch.object(
            service, "_sync_room_location"
        ):
            await service.update_room(
                room.id, FacilityRoomUpdate(parent_room_id=parent_id), org_id
            )

        mock_descendants.assert_not_called()

    async def test_a_rename_refreshes_descendant_location_names(
        self, service, org_id, facility_id
    ):
        """Sub-room Location names carry the path, so they go stale on rename."""
        room = make_room(str(uuid4()), facility_id, name="Volunteer Office")
        child = make_room(str(uuid4()), facility_id, parent_room_id=room.id)
        facility = MagicMock()
        facility.id = facility_id

        result = MagicMock()
        result.scalars.return_value.all.return_value = [child]
        service.db.execute.return_value = result

        with patch.object(service, "get_room", return_value=room), patch.object(
            service, "get_facility", return_value=facility
        ), patch.object(
            service, "_room_descendants", return_value=({child.id}, 2)
        ), patch.object(
            service, "_sync_room_location"
        ) as mock_sync:
            await service.update_room(
                room.id, FacilityRoomUpdate(name="Members Lounge"), org_id
            )

        # Unchanged building: the child keeps its facility, only the name path
        # is rewritten.
        assert child.facility_id == facility_id
        mock_sync.assert_any_await(child, facility, org_id)


class TestDeleteRoomKeepsSubRooms:
    async def test_children_are_re_parented_onto_the_grandparent(
        self, service, mock_db, org_id, facility_id
    ):
        grandparent_id = str(uuid4())
        room = make_room(str(uuid4()), facility_id, parent_room_id=grandparent_id)

        statements = []

        async def capture(statement, *args, **kwargs):
            statements.append(statement)
            result = MagicMock()
            result.scalar_one_or_none.return_value = None
            result.scalars.return_value.all.return_value = []
            return result

        mock_db.execute.side_effect = capture

        with patch.object(service, "get_room", return_value=room), patch.object(
            service, "_room_descendants", return_value=(set(), 1)
        ):
            assert await service.delete_room(room.id, org_id) is True

        update_statements = [
            stmt for stmt in statements if stmt.__visit_name__ == "update"
        ]
        assert len(update_statements) == 1
        # The children follow the deleted room's own parent, not NULL — unless
        # the deleted room was top-level, where NULL is the grandparent.
        assert update_statements[0].compile().params["parent_room_id"] == (
            grandparent_id
        )
        mock_db.delete.assert_awaited_with(room)


class TestParentRoomMigrationGuards:
    """20260816_0001 must survive a mid-flight failure on MySQL.

    MySQL DDL is non-transactional: a crash after add_column but before the
    index/FK leaves the column present. A retry that bails out on the column
    guard alone would stamp the revision complete without the index or the
    ON DELETE SET NULL backstop — so each DDL statement gets its own guard.
    """

    PATH = (
        Path(__file__).parents[1]
        / "alembic/versions/20260816_0001_add_facility_room_parent.py"
    )

    def _load(self):
        spec = importlib.util.spec_from_file_location("_room_parent_probe", self.PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_migration_imports_cleanly(self):
        module = self._load()
        assert callable(module.upgrade)
        assert callable(module.downgrade)

    def test_index_name_matches_the_models_naming_convention(self):
        """The model's index=True materializes as ix_facility_rooms_
        parent_room_id under the metadata naming convention; the migration
        must create the same name or migration-built and create_all()-built
        databases diverge. The legacy name stays recognized so installs that
        already ran the early build aren't double-indexed."""
        module = self._load()
        assert module._INDEX_NAME == "ix_facility_rooms_parent_room_id"
        assert module._LEGACY_INDEX_NAME == "idx_facility_rooms_parent"

        from app.models.facilities import FacilityRoom

        assert "ix_facility_rooms_parent_room_id" in {
            index.name for index in FacilityRoom.__table__.indexes
        }

    def test_upgrade_guards_column_index_and_fk_independently(self):
        source = self.PATH.read_text()
        upgrade = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]

        # No early return once the column exists — that is exactly the retry
        # hole this migration had.
        assert 'if "parent_room_id" in columns' not in upgrade
        assert 'if "parent_room_id" not in columns:' in upgrade
        assert "_INDEX_NAME, _LEGACY_INDEX_NAME" in upgrade
        assert "_FK_NAME not in fk_names" in upgrade

    def test_downgrade_drops_whichever_index_name_exists(self):
        source = self.PATH.read_text()
        downgrade = source.split("def downgrade()", 1)[1]
        assert "_INDEX_NAME, _LEGACY_INDEX_NAME" in downgrade
