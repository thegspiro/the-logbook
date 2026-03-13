"""
Minute Service Unit Tests

Tests for MinuteService business logic using mocked database sessions.

Covers:
  - Create minutes (basic, with motions, with action items, with template)
  - Get / list minutes (retrieval, filtering)
  - Update minutes (updates, status restrictions)
  - Delete minutes (deletion, draft-only restriction)
  - Approval workflow (submit, approve, reject)
  - Motion CRUD (add, update, delete)
  - Action item CRUD (add, update, delete)
  - Stats aggregation
  - Cross-module bridge (create_from_meeting)
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.models.minute import (
    ActionItemPriority,
    MeetingMinutes,
    MinutesActionItemStatus,
    MinutesMeetingType,
    MinutesStatus,
    MotionStatus,
    DEFAULT_SPECIAL_SECTIONS,
)
from app.schemas.minute import (
    ActionItemCreate,
    ActionItemUpdate,
    MinutesCreate,
    MinutesUpdate,
    MotionCreate,
    MotionUpdate,
)
from app.services.minute_service import MinuteService


# ============================================
# Fixtures
# ============================================


@pytest.fixture
def mock_db():
    """Create a mock async database session."""
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    db.delete = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    """Create a MinuteService with a mocked db."""
    return MinuteService(mock_db)


@pytest.fixture
def org_id():
    return uuid4()


@pytest.fixture
def user_id():
    return uuid4()


def _make_minutes(**overrides) -> MagicMock:
    """Build a MagicMock that mimics a MeetingMinutes with sensible defaults."""
    defaults = {
        "id": str(uuid4()),
        "organization_id": str(uuid4()),
        "title": "Monthly Business Meeting",
        "meeting_type": MinutesMeetingType.BUSINESS.value,
        "meeting_date": datetime(2026, 3, 1, 19, 0, tzinfo=timezone.utc),
        "location": "Station 1",
        "called_by": "Chief Smith",
        "status": MinutesStatus.DRAFT.value,
        "attendees": [],
        "sections": [],
        "motions": [],
        "action_items": [],
        "template_id": None,
        "header_config": None,
        "footer_config": None,
        "submitted_at": None,
        "submitted_by": None,
        "approved_at": None,
        "approved_by": None,
        "rejected_at": None,
        "rejected_by": None,
        "rejection_reason": None,
        "created_by": str(uuid4()),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    minutes = MagicMock()
    for k, v in defaults.items():
        setattr(minutes, k, v)
    return minutes


def _make_motion(**overrides) -> MagicMock:
    """Build a MagicMock that mimics a Motion."""
    defaults = {
        "id": str(uuid4()),
        "minutes_id": str(uuid4()),
        "order": 0,
        "motion_text": "Motion to approve the budget",
        "moved_by": "John Doe",
        "seconded_by": "Jane Smith",
        "discussion_notes": None,
        "status": MotionStatus.PASSED,
        "votes_for": 10,
        "votes_against": 2,
        "votes_abstain": 1,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    motion = MagicMock()
    for k, v in defaults.items():
        setattr(motion, k, v)
    return motion


def _make_action_item(**overrides) -> MagicMock:
    """Build a MagicMock that mimics an ActionItem."""
    defaults = {
        "id": str(uuid4()),
        "minutes_id": str(uuid4()),
        "description": "Follow up on equipment order",
        "assignee_id": str(uuid4()),
        "assignee_name": "John Doe",
        "due_date": datetime(2026, 4, 1, tzinfo=timezone.utc),
        "priority": ActionItemPriority.MEDIUM,
        "status": MinutesActionItemStatus.PENDING,
        "completed_at": None,
        "completion_notes": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    defaults.update(overrides)
    item = MagicMock()
    for k, v in defaults.items():
        setattr(item, k, v)
    return item


# ============================================
# Create Minutes Tests
# ============================================


class TestCreateMinutes:

    @pytest.mark.unit
    async def test_create_basic_minutes(self, service, mock_db, org_id, user_id):
        """Successfully creating basic meeting minutes with default sections."""
        created_minutes = _make_minutes()
        # get_minutes is called after creation to reload relationships
        service.get_minutes = AsyncMock(return_value=created_minutes)

        data = MinutesCreate(
            title="March Business Meeting",
            meeting_type="business",
            meeting_date=datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc),
            location="Station 1",
        )

        result = await service.create_minutes(data, org_id, user_id)

        assert result is not None
        mock_db.add.assert_called()
        mock_db.flush.assert_awaited_once()
        mock_db.commit.assert_awaited_once()
        service.get_minutes.assert_awaited_once()

    @pytest.mark.unit
    async def test_create_minutes_with_motions(self, service, mock_db, org_id, user_id):
        """Creating minutes with inline motions adds motion records."""
        created_minutes = _make_minutes()
        service.get_minutes = AsyncMock(return_value=created_minutes)

        data = MinutesCreate(
            title="Meeting with Motions",
            meeting_type="business",
            meeting_date=datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc),
            motions=[
                MotionCreate(
                    motion_text="Approve the budget",
                    moved_by="John Doe",
                    seconded_by="Jane Smith",
                    status="passed",
                    votes_for=10,
                    votes_against=2,
                    votes_abstain=1,
                    order=0,
                ),
            ],
        )

        result = await service.create_minutes(data, org_id, user_id)

        assert result is not None
        # 1 call for the minutes + 1 call for the motion
        assert mock_db.add.call_count == 2

    @pytest.mark.unit
    async def test_create_minutes_with_action_items(
        self, service, mock_db, org_id, user_id
    ):
        """Creating minutes with inline action items adds action item records."""
        created_minutes = _make_minutes()
        service.get_minutes = AsyncMock(return_value=created_minutes)

        data = MinutesCreate(
            title="Meeting with Actions",
            meeting_type="business",
            meeting_date=datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc),
            action_items=[
                ActionItemCreate(
                    description="Order new hoses",
                    assignee_name="Chief Smith",
                    priority="high",
                ),
                ActionItemCreate(
                    description="Schedule training",
                    assignee_name="Captain Jones",
                    priority="medium",
                ),
            ],
        )

        result = await service.create_minutes(data, org_id, user_id)

        assert result is not None
        # 1 for minutes + 2 for action items
        assert mock_db.add.call_count == 3

    @pytest.mark.unit
    async def test_create_minutes_with_template(
        self, service, mock_db, org_id, user_id
    ):
        """Creating minutes with a template_id populates sections from template."""
        template_id = str(uuid4())
        template = MagicMock()
        template.sections = [
            {
                "order": 0,
                "key": "opening",
                "title": "Opening",
                "default_content": "Welcome all",
            },
            {
                "order": 1,
                "key": "closing",
                "title": "Closing",
                "default_content": "",
            },
        ]
        template.header_config = {"org_name": "Test FD"}
        template.footer_config = {"show_page_numbers": True}

        service._get_template = AsyncMock(return_value=template)
        created_minutes = _make_minutes()
        service.get_minutes = AsyncMock(return_value=created_minutes)

        data = MinutesCreate(
            title="Template-based Meeting",
            meeting_type="business",
            meeting_date=datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc),
            template_id=template_id,
        )

        result = await service.create_minutes(data, org_id, user_id)

        assert result is not None
        service._get_template.assert_awaited_once_with(template_id, org_id)

    @pytest.mark.unit
    async def test_create_minutes_default_sections_by_meeting_type(
        self, service, mock_db, org_id, user_id
    ):
        """When no template and no sections, default sections are used based on meeting type."""
        created_minutes = _make_minutes()
        service.get_minutes = AsyncMock(return_value=created_minutes)

        data = MinutesCreate(
            title="Special Meeting",
            meeting_type="special",
            meeting_date=datetime(2026, 3, 10, 19, 0, tzinfo=timezone.utc),
        )

        await service.create_minutes(data, org_id, user_id)

        # Verify the MeetingMinutes constructor was called - the minutes
        # model is created with special sections
        add_call = mock_db.add.call_args_list[0]
        minutes_obj = add_call[0][0]
        assert isinstance(minutes_obj, MeetingMinutes)
        assert len(minutes_obj.sections) == len(DEFAULT_SPECIAL_SECTIONS)


# ============================================
# Get / List Minutes Tests
# ============================================


class TestGetMinutes:

    @pytest.mark.unit
    async def test_get_minutes_found(self, service, mock_db, org_id):
        """get_minutes returns the minutes when found."""
        expected = _make_minutes()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = expected
        mock_db.execute.return_value = mock_result

        result = await service.get_minutes("some-id", org_id)

        assert result is expected

    @pytest.mark.unit
    async def test_get_minutes_not_found(self, service, mock_db, org_id):
        """get_minutes returns None when not found."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        result = await service.get_minutes("nonexistent-id", org_id)

        assert result is None


class TestListMinutes:

    @pytest.mark.unit
    async def test_list_minutes_no_filters(self, service, mock_db, org_id):
        """list_minutes returns all minutes for the organization."""
        m1 = _make_minutes(title="Meeting 1")
        m2 = _make_minutes(title="Meeting 2")
        mock_result = MagicMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [m1, m2]
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute.return_value = mock_result

        result = await service.list_minutes(org_id)

        assert len(result) == 2

    @pytest.mark.unit
    async def test_list_minutes_with_meeting_type_filter(
        self, service, mock_db, org_id
    ):
        """list_minutes with meeting_type filter passes the filter."""
        mock_result = MagicMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute.return_value = mock_result

        result = await service.list_minutes(org_id, meeting_type="special")

        assert result == []
        mock_db.execute.assert_awaited_once()

    @pytest.mark.unit
    async def test_list_minutes_with_status_filter(self, service, mock_db, org_id):
        """list_minutes with status filter passes the filter."""
        mock_result = MagicMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute.return_value = mock_result

        result = await service.list_minutes(org_id, status="approved")

        assert result == []
        mock_db.execute.assert_awaited_once()

    @pytest.mark.unit
    async def test_list_minutes_with_search(self, service, mock_db, org_id):
        """list_minutes with search term applies search filter."""
        mock_result = MagicMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute.return_value = mock_result

        result = await service.list_minutes(org_id, search="budget")

        assert result == []
        mock_db.execute.assert_awaited_once()

    @pytest.mark.unit
    async def test_list_minutes_with_pagination(self, service, mock_db, org_id):
        """list_minutes with skip/limit applies pagination."""
        mock_result = MagicMock()
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = []
        mock_result.scalars.return_value = mock_scalars
        mock_db.execute.return_value = mock_result

        result = await service.list_minutes(org_id, skip=10, limit=5)

        assert result == []


# ============================================
# Update Minutes Tests
# ============================================


class TestUpdateMinutes:

    @pytest.mark.unit
    async def test_update_minutes_not_found(self, service, mock_db, org_id):
        """update_minutes returns None when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        data = MinutesUpdate(title="Updated Title")
        result = await service.update_minutes("nonexistent", org_id, data)

        assert result is None

    @pytest.mark.unit
    async def test_update_draft_minutes(self, service, mock_db, org_id):
        """update_minutes succeeds for draft minutes."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MinutesUpdate(title="Updated Title")
        updated = await service.update_minutes(minutes.id, org_id, data)

        assert updated is not None
        assert minutes.title == "Updated Title"
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    async def test_update_rejected_minutes_resets_to_draft(
        self, service, mock_db, org_id
    ):
        """update_minutes on rejected minutes resets status to draft."""
        minutes = _make_minutes(
            status=MinutesStatus.REJECTED.value,
            rejected_at=datetime.now(timezone.utc),
            rejected_by=str(uuid4()),
            rejection_reason="Needs corrections",
        )
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MinutesUpdate(title="Corrected Title")
        updated = await service.update_minutes(minutes.id, org_id, data)

        assert updated is not None
        assert minutes.status == MinutesStatus.DRAFT
        assert minutes.rejected_at is None
        assert minutes.rejected_by is None
        assert minutes.rejection_reason is None
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    async def test_update_approved_minutes_raises(self, service, mock_db, org_id):
        """update_minutes raises ValueError for approved minutes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MinutesUpdate(title="Should Fail")
        with pytest.raises(ValueError, match="draft or rejected"):
            await service.update_minutes(minutes.id, org_id, data)

    @pytest.mark.unit
    async def test_update_submitted_minutes_raises(self, service, mock_db, org_id):
        """update_minutes raises ValueError for submitted minutes."""
        minutes = _make_minutes(status=MinutesStatus.SUBMITTED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MinutesUpdate(title="Should Fail")
        with pytest.raises(ValueError, match="draft or rejected"):
            await service.update_minutes(minutes.id, org_id, data)

    @pytest.mark.unit
    async def test_update_clears_empty_event_id(self, service, mock_db, org_id):
        """update_minutes clears event_id when it is an empty string."""
        minutes = _make_minutes(
            status=MinutesStatus.DRAFT.value,
            event_id="some-event-id",
        )
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MinutesUpdate(event_id="")
        await service.update_minutes(minutes.id, org_id, data)

        assert minutes.event_id is None


# ============================================
# Delete Minutes Tests
# ============================================


class TestDeleteMinutes:

    @pytest.mark.unit
    async def test_delete_draft_minutes(self, service, mock_db, org_id):
        """delete_minutes succeeds for draft minutes."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        result = await service.delete_minutes(minutes.id, org_id)

        assert result is True
        mock_db.delete.assert_awaited_once_with(minutes)
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    async def test_delete_not_found(self, service, mock_db, org_id):
        """delete_minutes returns False when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        result = await service.delete_minutes("nonexistent", org_id)

        assert result is False

    @pytest.mark.unit
    async def test_delete_approved_minutes_raises(self, service, mock_db, org_id):
        """delete_minutes raises ValueError for approved minutes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="draft"):
            await service.delete_minutes(minutes.id, org_id)

    @pytest.mark.unit
    async def test_delete_submitted_minutes_raises(self, service, mock_db, org_id):
        """delete_minutes raises ValueError for submitted minutes."""
        minutes = _make_minutes(status=MinutesStatus.SUBMITTED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="draft"):
            await service.delete_minutes(minutes.id, org_id)

    @pytest.mark.unit
    async def test_delete_rejected_minutes_raises(self, service, mock_db, org_id):
        """delete_minutes raises ValueError for rejected minutes."""
        minutes = _make_minutes(status=MinutesStatus.REJECTED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="draft"):
            await service.delete_minutes(minutes.id, org_id)


# ============================================
# Approval Workflow Tests
# ============================================


class TestSubmitForApproval:

    @pytest.mark.unit
    async def test_submit_draft_minutes(self, service, mock_db, org_id, user_id):
        """submit_for_approval succeeds for draft minutes."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        result = await service.submit_for_approval(minutes.id, org_id, user_id)

        assert result is not None
        assert minutes.status == MinutesStatus.SUBMITTED
        assert minutes.submitted_by == str(user_id)
        assert minutes.submitted_at is not None
        assert minutes.rejected_at is None
        mock_db.commit.assert_awaited()

    @pytest.mark.unit
    async def test_submit_rejected_minutes(self, service, mock_db, org_id, user_id):
        """submit_for_approval succeeds for rejected minutes."""
        minutes = _make_minutes(
            status=MinutesStatus.REJECTED.value,
            rejected_at=datetime.now(timezone.utc),
            rejected_by=str(uuid4()),
            rejection_reason="Fix typos",
        )
        service.get_minutes = AsyncMock(return_value=minutes)

        submitted = await service.submit_for_approval(minutes.id, org_id, user_id)

        assert submitted is not None
        assert minutes.status == MinutesStatus.SUBMITTED
        assert minutes.rejected_at is None
        assert minutes.rejected_by is None
        assert minutes.rejection_reason is None

    @pytest.mark.unit
    async def test_submit_approved_minutes_raises(
        self, service, mock_db, org_id, user_id
    ):
        """submit_for_approval raises ValueError for approved minutes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="draft or rejected"):
            await service.submit_for_approval(minutes.id, org_id, user_id)

    @pytest.mark.unit
    async def test_submit_not_found(self, service, mock_db, org_id, user_id):
        """submit_for_approval returns None when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        result = await service.submit_for_approval("nonexistent", org_id, user_id)

        assert result is None


class TestApproveMinutes:

    @pytest.mark.unit
    async def test_approve_submitted_minutes(self, service, mock_db, org_id, user_id):
        """approve_minutes succeeds for submitted minutes."""
        minutes = _make_minutes(status=MinutesStatus.SUBMITTED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        result = await service.approve_minutes(minutes.id, org_id, user_id)

        assert result is not None
        assert minutes.status == MinutesStatus.APPROVED
        assert minutes.approved_by == str(user_id)
        assert minutes.approved_at is not None
        mock_db.commit.assert_awaited()

    @pytest.mark.unit
    async def test_approve_draft_minutes_raises(
        self, service, mock_db, org_id, user_id
    ):
        """approve_minutes raises ValueError for draft minutes."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="submitted"):
            await service.approve_minutes(minutes.id, org_id, user_id)

    @pytest.mark.unit
    async def test_approve_already_approved_raises(
        self, service, mock_db, org_id, user_id
    ):
        """approve_minutes raises ValueError for already approved minutes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="submitted"):
            await service.approve_minutes(minutes.id, org_id, user_id)

    @pytest.mark.unit
    async def test_approve_not_found(self, service, mock_db, org_id, user_id):
        """approve_minutes returns None when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        result = await service.approve_minutes("nonexistent", org_id, user_id)

        assert result is None


class TestRejectMinutes:

    @pytest.mark.unit
    async def test_reject_submitted_minutes(self, service, mock_db, org_id, user_id):
        """reject_minutes succeeds for submitted minutes."""
        minutes = _make_minutes(status=MinutesStatus.SUBMITTED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        result = await service.reject_minutes(
            minutes.id, org_id, user_id, "Needs more detail"
        )

        assert result is not None
        assert minutes.status == MinutesStatus.REJECTED
        assert minutes.rejected_by == str(user_id)
        assert minutes.rejected_at is not None
        assert minutes.rejection_reason == "Needs more detail"
        mock_db.commit.assert_awaited()

    @pytest.mark.unit
    async def test_reject_draft_minutes_raises(
        self, service, mock_db, org_id, user_id
    ):
        """reject_minutes raises ValueError for draft minutes."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="submitted"):
            await service.reject_minutes(minutes.id, org_id, user_id, "No reason")

    @pytest.mark.unit
    async def test_reject_not_found(self, service, mock_db, org_id, user_id):
        """reject_minutes returns None when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        result = await service.reject_minutes(
            "nonexistent", org_id, user_id, "No reason"
        )

        assert result is None


# ============================================
# Motion CRUD Tests
# ============================================


class TestAddMotion:

    @pytest.mark.unit
    async def test_add_motion_to_draft_minutes(self, service, mock_db, org_id):
        """add_motion succeeds for draft minutes."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MotionCreate(
            motion_text="Motion to approve treasurer report",
            moved_by="John Doe",
            seconded_by="Jane Smith",
            status="passed",
            votes_for=8,
            votes_against=1,
            votes_abstain=0,
            order=0,
        )

        result = await service.add_motion(minutes.id, org_id, data)

        assert result is not None
        mock_db.add.assert_called_once()
        mock_db.commit.assert_awaited_once()
        mock_db.refresh.assert_awaited_once()

    @pytest.mark.unit
    async def test_add_motion_to_rejected_minutes(self, service, mock_db, org_id):
        """add_motion succeeds for rejected minutes."""
        minutes = _make_minutes(status=MinutesStatus.REJECTED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MotionCreate(
            motion_text="Additional motion",
            status="passed",
            order=1,
        )

        result = await service.add_motion(minutes.id, org_id, data)

        assert result is not None

    @pytest.mark.unit
    async def test_add_motion_to_approved_minutes_raises(
        self, service, mock_db, org_id
    ):
        """add_motion raises ValueError for approved minutes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MotionCreate(
            motion_text="Late motion",
            status="passed",
            order=0,
        )

        with pytest.raises(ValueError, match="draft or rejected"):
            await service.add_motion(minutes.id, org_id, data)

    @pytest.mark.unit
    async def test_add_motion_not_found(self, service, mock_db, org_id):
        """add_motion returns None when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        data = MotionCreate(
            motion_text="Motion",
            status="passed",
            order=0,
        )

        result = await service.add_motion("nonexistent", org_id, data)

        assert result is None


class TestUpdateMotion:

    @pytest.mark.unit
    async def test_update_motion_success(self, service, mock_db, org_id):
        """update_motion succeeds for draft minutes with an existing motion."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        motion = _make_motion(minutes_id=minutes.id)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = motion
        mock_db.execute.return_value = mock_result

        data = MotionUpdate(motion_text="Updated motion text")
        result = await service.update_motion(motion.id, minutes.id, org_id, data)

        assert result is not None
        assert motion.motion_text == "Updated motion text"
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    async def test_update_motion_status_conversion(self, service, mock_db, org_id):
        """update_motion properly converts status string to MotionStatus enum."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        motion = _make_motion(minutes_id=minutes.id, status=MotionStatus.PASSED)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = motion
        mock_db.execute.return_value = mock_result

        data = MotionUpdate(status="tabled")
        result = await service.update_motion(motion.id, minutes.id, org_id, data)

        assert result is not None
        assert motion.status == MotionStatus.TABLED

    @pytest.mark.unit
    async def test_update_motion_approved_minutes_raises(
        self, service, mock_db, org_id
    ):
        """update_motion raises ValueError for approved minutes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = MotionUpdate(motion_text="Should fail")
        with pytest.raises(ValueError, match="draft or rejected"):
            await service.update_motion("motion-id", minutes.id, org_id, data)

    @pytest.mark.unit
    async def test_update_motion_not_found(self, service, mock_db, org_id):
        """update_motion returns None when motion does not exist."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        data = MotionUpdate(motion_text="Update nonexistent")
        result = await service.update_motion("nonexistent", minutes.id, org_id, data)

        assert result is None

    @pytest.mark.unit
    async def test_update_motion_minutes_not_found(self, service, mock_db, org_id):
        """update_motion returns None when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        data = MotionUpdate(motion_text="No minutes")
        result = await service.update_motion("motion-id", "bad-id", org_id, data)

        assert result is None


class TestDeleteMotion:

    @pytest.mark.unit
    async def test_delete_motion_success(self, service, mock_db, org_id):
        """delete_motion succeeds for draft minutes with existing motion."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        motion = _make_motion(minutes_id=minutes.id)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = motion
        mock_db.execute.return_value = mock_result

        result = await service.delete_motion(motion.id, minutes.id, org_id)

        assert result is True
        mock_db.delete.assert_awaited_once_with(motion)
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    async def test_delete_motion_approved_minutes_raises(
        self, service, mock_db, org_id
    ):
        """delete_motion raises ValueError for approved minutes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="draft or rejected"):
            await service.delete_motion("motion-id", minutes.id, org_id)

    @pytest.mark.unit
    async def test_delete_motion_not_found(self, service, mock_db, org_id):
        """delete_motion returns False when motion does not exist."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        result = await service.delete_motion("nonexistent", minutes.id, org_id)

        assert result is False

    @pytest.mark.unit
    async def test_delete_motion_minutes_not_found(self, service, mock_db, org_id):
        """delete_motion returns False when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        result = await service.delete_motion("motion-id", "bad-id", org_id)

        assert result is False


# ============================================
# Action Item CRUD Tests
# ============================================


class TestAddActionItem:

    @pytest.mark.unit
    async def test_add_action_item_success(self, service, mock_db, org_id):
        """add_action_item succeeds when minutes exist."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = ActionItemCreate(
            description="Order new equipment",
            assignee_name="Captain Jones",
            priority="high",
            due_date=datetime(2026, 4, 15, tzinfo=timezone.utc),
        )

        result = await service.add_action_item(minutes.id, org_id, data)

        assert result is not None
        mock_db.add.assert_called_once()
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    async def test_add_action_item_not_found(self, service, mock_db, org_id):
        """add_action_item returns None when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        data = ActionItemCreate(
            description="Order new equipment",
            priority="medium",
        )

        result = await service.add_action_item("nonexistent", org_id, data)

        assert result is None

    @pytest.mark.unit
    async def test_add_action_item_to_approved_minutes(
        self, service, mock_db, org_id
    ):
        """add_action_item works even on approved minutes (no status restriction)."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        data = ActionItemCreate(
            description="Post-approval follow up",
            priority="low",
        )

        result = await service.add_action_item(minutes.id, org_id, data)

        assert result is not None


class TestUpdateActionItem:

    @pytest.mark.unit
    async def test_update_action_item_on_draft_minutes(
        self, service, mock_db, org_id
    ):
        """update_action_item allows all fields on draft minutes."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        item = _make_action_item(minutes_id=minutes.id)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute.return_value = mock_result

        data = ActionItemUpdate(
            description="Updated description",
            priority="urgent",
            assignee_name="New Person",
        )

        result = await service.update_action_item(
            item.id, minutes.id, org_id, data
        )

        assert result is not None
        assert item.description == "Updated description"
        assert item.priority == ActionItemPriority.URGENT
        assert item.assignee_name == "New Person"
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    async def test_update_action_item_on_approved_minutes_restricts_fields(
        self, service, mock_db, org_id
    ):
        """update_action_item on approved minutes only allows status and completion_notes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        item = _make_action_item(
            minutes_id=minutes.id,
            description="Original description",
            assignee_name="Original Person",
        )
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute.return_value = mock_result

        data = ActionItemUpdate(
            description="Should be ignored",
            status="completed",
            completion_notes="Done",
        )

        result = await service.update_action_item(
            item.id, minutes.id, org_id, data
        )

        assert result is not None
        # description should NOT be updated on approved minutes
        assert item.description == "Original description"
        # status and completion_notes should be updated
        assert item.status == MinutesActionItemStatus.COMPLETED
        assert item.completion_notes == "Done"
        assert item.completed_at is not None

    @pytest.mark.unit
    async def test_update_action_item_mark_completed_sets_timestamp(
        self, service, mock_db, org_id
    ):
        """Marking an action item as completed sets completed_at."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        item = _make_action_item(minutes_id=minutes.id, completed_at=None)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute.return_value = mock_result

        data = ActionItemUpdate(status="completed")
        updated = await service.update_action_item(
            item.id, minutes.id, org_id, data
        )

        assert updated is not None
        assert item.status == MinutesActionItemStatus.COMPLETED
        assert item.completed_at is not None

    @pytest.mark.unit
    async def test_update_action_item_not_found(self, service, mock_db, org_id):
        """update_action_item returns None when action item not found."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        data = ActionItemUpdate(description="No item")
        result = await service.update_action_item(
            "nonexistent", minutes.id, org_id, data
        )

        assert result is None

    @pytest.mark.unit
    async def test_update_action_item_minutes_not_found(
        self, service, mock_db, org_id
    ):
        """update_action_item returns None when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        data = ActionItemUpdate(description="No minutes")
        result = await service.update_action_item(
            "item-id", "bad-minutes", org_id, data
        )

        assert result is None


class TestDeleteActionItem:

    @pytest.mark.unit
    async def test_delete_action_item_success(self, service, mock_db, org_id):
        """delete_action_item succeeds for draft minutes."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        item = _make_action_item(minutes_id=minutes.id)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute.return_value = mock_result

        result = await service.delete_action_item(item.id, minutes.id, org_id)

        assert result is True
        mock_db.delete.assert_awaited_once_with(item)
        mock_db.commit.assert_awaited_once()

    @pytest.mark.unit
    async def test_delete_action_item_approved_minutes_raises(
        self, service, mock_db, org_id
    ):
        """delete_action_item raises ValueError for approved minutes."""
        minutes = _make_minutes(status=MinutesStatus.APPROVED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        with pytest.raises(ValueError, match="draft or rejected"):
            await service.delete_action_item("item-id", minutes.id, org_id)

    @pytest.mark.unit
    async def test_delete_action_item_not_found(self, service, mock_db, org_id):
        """delete_action_item returns False when item not found."""
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        result = await service.delete_action_item("nonexistent", minutes.id, org_id)

        assert result is False

    @pytest.mark.unit
    async def test_delete_action_item_minutes_not_found(
        self, service, mock_db, org_id
    ):
        """delete_action_item returns False when minutes not found."""
        service.get_minutes = AsyncMock(return_value=None)

        result = await service.delete_action_item("item-id", "bad-id", org_id)

        assert result is False

    @pytest.mark.unit
    async def test_delete_action_item_on_rejected_minutes(
        self, service, mock_db, org_id
    ):
        """delete_action_item succeeds on rejected minutes."""
        minutes = _make_minutes(status=MinutesStatus.REJECTED.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        item = _make_action_item(minutes_id=minutes.id)
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = item
        mock_db.execute.return_value = mock_result

        result = await service.delete_action_item(item.id, minutes.id, org_id)

        assert result is True


# ============================================
# Stats Tests
# ============================================


class TestGetStats:

    @pytest.mark.unit
    async def test_get_stats_returns_all_fields(self, service, mock_db, org_id):
        """get_stats returns total, this_month, open_action_items, pending_approval."""
        # Mock 4 sequential execute calls for: total, this_month, open_items, pending
        total_result = MagicMock()
        total_result.scalar.return_value = 25

        this_month_result = MagicMock()
        this_month_result.scalar.return_value = 3

        open_items_result = MagicMock()
        open_items_result.scalar.return_value = 7

        pending_result = MagicMock()
        pending_result.scalar.return_value = 2

        mock_db.execute = AsyncMock(
            side_effect=[total_result, this_month_result, open_items_result, pending_result]
        )

        result = await service.get_stats(org_id)

        assert result["total"] == 25
        assert result["this_month"] == 3
        assert result["open_action_items"] == 7
        assert result["pending_approval"] == 2

    @pytest.mark.unit
    async def test_get_stats_handles_none_scalars(self, service, mock_db, org_id):
        """get_stats converts None scalars to 0."""
        none_result = MagicMock()
        none_result.scalar.return_value = None

        mock_db.execute = AsyncMock(
            return_value=none_result
        )

        result = await service.get_stats(org_id)

        assert result["total"] == 0
        assert result["this_month"] == 0
        assert result["open_action_items"] == 0
        assert result["pending_approval"] == 0


# ============================================
# Cross-Module Bridge Tests
# ============================================


class TestCreateFromMeeting:

    @pytest.mark.unit
    async def test_create_from_meeting_success(self, service, mock_db, org_id, user_id):
        """create_from_meeting creates minutes pre-populated from a Meeting."""
        meeting_id = uuid4()

        # Mock the Meeting model
        mock_meeting = MagicMock()
        mock_meeting.id = str(meeting_id)
        mock_meeting.organization_id = str(org_id)
        mock_meeting.title = "March Business Meeting"
        mock_meeting.meeting_type = "business"
        mock_meeting.meeting_date = datetime(2026, 3, 10).date()
        mock_meeting.start_time = datetime(2026, 3, 10, 19, 0).time()
        mock_meeting.location = "Station 1"
        mock_meeting.called_by = "Chief Smith"
        mock_meeting.agenda = "Discuss budget"
        mock_meeting.event_id = None
        mock_meeting.attendees = []

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_meeting
        mock_db.execute.return_value = mock_result

        with patch("app.services.minute_service.generate_uuid", return_value="gen-uuid"):
            result = await service.create_from_meeting(meeting_id, org_id, user_id)

        assert result is not None
        mock_db.add.assert_called_once()
        mock_db.commit.assert_awaited_once()

        # Verify the created MeetingMinutes object
        created = mock_db.add.call_args[0][0]
        assert isinstance(created, MeetingMinutes)
        assert created.title == "Minutes: March Business Meeting"
        assert created.meeting_type == MinutesMeetingType.BUSINESS
        assert created.location == "Station 1"
        assert created.called_by == "Chief Smith"
        assert created.status == MinutesStatus.DRAFT
        assert created.created_by == str(user_id)

    @pytest.mark.unit
    async def test_create_from_meeting_not_found(
        self, service, mock_db, org_id, user_id
    ):
        """create_from_meeting returns None when meeting does not exist."""
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = mock_result

        result = await service.create_from_meeting(uuid4(), org_id, user_id)

        assert result is None

    @pytest.mark.unit
    async def test_create_from_meeting_with_attendees(
        self, service, mock_db, org_id, user_id
    ):
        """create_from_meeting populates attendees from meeting attendees."""
        meeting_id = uuid4()

        # Mock attendee
        mock_attendee = MagicMock()
        mock_attendee.user_id = str(uuid4())
        mock_attendee.present = True
        mock_attendee.excused = False

        # Mock user lookup
        mock_user = MagicMock()
        mock_user.first_name = "John"
        mock_user.last_name = "Doe"
        mock_user.username = "jdoe"

        mock_meeting = MagicMock()
        mock_meeting.id = str(meeting_id)
        mock_meeting.organization_id = str(org_id)
        mock_meeting.title = "Meeting with Attendees"
        mock_meeting.meeting_type = "business"
        mock_meeting.meeting_date = datetime(2026, 3, 10).date()
        mock_meeting.start_time = datetime(2026, 3, 10, 19, 0).time()
        mock_meeting.location = "Station 1"
        mock_meeting.called_by = None
        mock_meeting.agenda = None
        mock_meeting.event_id = None
        mock_meeting.attendees = [mock_attendee]

        # First execute returns the meeting, second returns the user
        meeting_result = MagicMock()
        meeting_result.scalar_one_or_none.return_value = mock_meeting

        user_result = MagicMock()
        user_result.scalar_one_or_none.return_value = mock_user

        mock_db.execute = AsyncMock(
            side_effect=[meeting_result, user_result]
        )

        with patch("app.services.minute_service.generate_uuid", return_value="gen-uuid"):
            result = await service.create_from_meeting(meeting_id, org_id, user_id)

        assert result is not None
        created = mock_db.add.call_args[0][0]
        assert len(created.attendees) == 1
        assert created.attendees[0]["name"] == "John Doe"
        assert created.attendees[0]["present"] is True

    @pytest.mark.unit
    async def test_create_from_meeting_special_type(
        self, service, mock_db, org_id, user_id
    ):
        """create_from_meeting maps 'special' meeting type correctly."""
        meeting_id = uuid4()

        mock_meeting = MagicMock()
        mock_meeting.id = str(meeting_id)
        mock_meeting.organization_id = str(org_id)
        mock_meeting.title = "Emergency Special Meeting"
        mock_meeting.meeting_type = "special"
        mock_meeting.meeting_date = datetime(2026, 3, 10).date()
        mock_meeting.start_time = None
        mock_meeting.location = None
        mock_meeting.called_by = None
        mock_meeting.agenda = None
        mock_meeting.event_id = None
        mock_meeting.attendees = []

        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = mock_meeting
        mock_db.execute.return_value = mock_result

        with patch("app.services.minute_service.generate_uuid", return_value="gen-uuid"):
            from_meeting = await service.create_from_meeting(meeting_id, org_id, user_id)

        assert from_meeting is not None
        created = mock_db.add.call_args[0][0]
        assert created.meeting_type == MinutesMeetingType.SPECIAL
        # Special meetings should use special sections
        section_keys = [s["key"] for s in created.sections]
        assert "purpose" in section_keys


# ============================================
# Workflow Integration Tests
# ============================================


class TestWorkflowTransitions:
    """Test the full approval workflow: draft -> submitted -> approved/rejected."""

    @pytest.mark.unit
    async def test_full_approval_flow(self, service, mock_db, org_id, user_id):
        """Draft -> Submit -> Approve follows the correct state transitions."""
        approver_id = uuid4()
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        # Submit
        await service.submit_for_approval(minutes.id, org_id, user_id)
        assert minutes.status == MinutesStatus.SUBMITTED

        # Approve
        await service.approve_minutes(minutes.id, org_id, approver_id)
        assert minutes.status == MinutesStatus.APPROVED
        assert minutes.approved_by == str(approver_id)

    @pytest.mark.unit
    async def test_rejection_and_resubmit_flow(self, service, mock_db, org_id, user_id):
        """Draft -> Submit -> Reject -> Edit -> Resubmit."""
        reviewer_id = uuid4()
        minutes = _make_minutes(status=MinutesStatus.DRAFT.value)
        service.get_minutes = AsyncMock(return_value=minutes)

        # Submit
        await service.submit_for_approval(minutes.id, org_id, user_id)
        assert minutes.status == MinutesStatus.SUBMITTED

        # Reject
        await service.reject_minutes(
            minutes.id, org_id, reviewer_id, "Missing attendance"
        )
        assert minutes.status == MinutesStatus.REJECTED
        assert minutes.rejection_reason == "Missing attendance"

        # Edit (updates reset to draft)
        data = MinutesUpdate(title="Updated with attendance")
        await service.update_minutes(minutes.id, org_id, data)
        assert minutes.status == MinutesStatus.DRAFT
        assert minutes.rejected_at is None

        # Resubmit
        await service.submit_for_approval(minutes.id, org_id, user_id)
        assert minutes.status == MinutesStatus.SUBMITTED
