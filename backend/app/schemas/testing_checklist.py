"""
Testing checklist Pydantic schemas

Request/response shapes for the in-app testing home (`/testing`).
"""

import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models.testing_checklist import (
    TestingAccessExpectation,
    TestingCheckStatus,
)
from app.schemas.base import UTCResponseBase

_RESPONSE_CONFIG = ConfigDict(
    from_attributes=True, alias_generator=to_camel, populate_by_name=True
)
_REQUEST_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)

# The route patterns the frontend router declares: a leading slash, then path
# segments, ":param" placeholders and the punctuation those use. Anything else
# is not a route this checklist can be a list of, and the column is a poor
# place to discover that.
ROUTE_PATH_PATTERN = re.compile(r"^/[A-Za-z0-9\-_/:.]*$")

MAX_NOTE_CHARS = 2000
MAX_RUN_LABEL_CHARS = 120
# Long enough for the build ids vite stamps; a cap so the column cannot be used
# as free storage.
MAX_BUILD_ID_CHARS = 64
# A parameterized route has one or two segments; the cap is a bound on junk,
# not a design constraint.
MAX_PARAMS = 8
MAX_PARAM_VALUE_CHARS = 200


class TestingCheckUpsert(BaseModel):
    """Record (or re-record) one tester's finding on one page."""

    model_config = _REQUEST_CONFIG

    route_path: str = Field(..., max_length=200)
    status: TestingCheckStatus = TestingCheckStatus.UNTESTED
    note: Optional[str] = Field(default=None, max_length=MAX_NOTE_CHARS)
    params: Optional[dict[str, str]] = None
    # The bundle the tester was looking at, so a mark can be told from one made
    # three deployments ago. Absent in development, where nothing is stamped.
    build_id: Optional[str] = Field(default=None, max_length=MAX_BUILD_ID_CHARS)
    # What the screen predicted this account would meet. Stored as reported —
    # see TestingAccessExpectation for why that is enough.
    expected_access: Optional[TestingAccessExpectation] = None

    @field_validator("route_path")
    @classmethod
    def _validate_route_path(cls, value: str) -> str:
        path = value.strip()
        if not ROUTE_PATH_PATTERN.match(path):
            raise ValueError("routePath must be a route pattern such as /events/:id")
        return path

    @field_validator("note")
    @classmethod
    def _blank_note_is_no_note(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("params")
    @classmethod
    def _validate_params(cls, value: Optional[dict]) -> Optional[dict]:
        if value is None:
            return None
        if len(value) > MAX_PARAMS:
            raise ValueError(f"at most {MAX_PARAMS} route parameters")
        cleaned = {
            str(name): str(param)[:MAX_PARAM_VALUE_CHARS]
            for name, param in value.items()
            if str(param).strip()
        }
        return cleaned or None


class TestingRunCreate(BaseModel):
    """Open a new run, retiring the current one."""

    model_config = _REQUEST_CONFIG

    label: str = Field(..., min_length=1, max_length=MAX_RUN_LABEL_CHARS)
    build_id: Optional[str] = Field(default=None, max_length=MAX_BUILD_ID_CHARS)

    @field_validator("label")
    @classmethod
    def _require_label(cls, value: str) -> str:
        label = value.strip()
        if not label:
            raise ValueError("A run needs a label")
        return label


class TestingRunResponse(UTCResponseBase):
    """One pass over the checklist."""

    model_config = _RESPONSE_CONFIG

    id: str
    # 1, 2, 3 … per department; what orders the history picker.
    sequence: int
    label: str
    build_id: Optional[str] = None
    started_at: datetime
    started_by_id: Optional[str] = None
    started_by_name: Optional[str] = None
    # False for every run but the newest: an archived run is read-only, and the
    # screen has to say so rather than accept marks it will file in the wrong
    # place.
    is_current: bool = False


class TestingCheckResponse(UTCResponseBase):
    """One tester's mark on one page."""

    model_config = _RESPONSE_CONFIG

    id: str
    route_path: str
    status: TestingCheckStatus
    note: Optional[str] = None
    params: Optional[dict[str, str]] = None
    checked_at: Optional[datetime] = None
    # Nullable because testing_checklist_entries.user_id is an ON DELETE SET
    # NULL FK and the model keeps the row deliberately: an archived run is the
    # record of what was found then, so hard-deleting a member must not rewrite
    # it. Declaring this required meant one such row raised a Pydantic
    # ValidationError and 500'd the shared run for the whole department.
    user_id: Optional[str] = None
    # Who made the mark, and from which seat. Both are resolved at read time
    # from the users table; `tested_as` is the snapshot taken at write time,
    # because a mark made before a promotion no longer describes the account.
    user_name: Optional[str] = None
    tested_as: Optional[list[str]] = None
    build_id: Optional[str] = None
    expected_access: Optional[TestingAccessExpectation] = None
    is_mine: bool = False


class TestingChecklistResponse(UTCResponseBase):
    """The run as one tester sees it."""

    model_config = _RESPONSE_CONFIG

    entries: list[TestingCheckResponse]
    # The run these entries belong to, and every run the department has kept.
    # Absent only before the first mark, when no run has been opened yet.
    run: Optional[TestingRunResponse] = None
    runs: list[TestingRunResponse] = []
    # False when the caller asked for everyone's marks and holds the grant for
    # it; the screen labels its totals differently in each case, and guessing
    # from the row set would call a single-tester department "everyone".
    includes_all_testers: bool = False
    # Distinct testers represented in `entries`.
    tester_count: int = 0
