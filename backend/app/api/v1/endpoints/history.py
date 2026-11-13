"""
History module endpoints (``/api/v1/history``, gated on the module).

Three audiences, decided by the server:

* any signed-in member reads what is published to members or the public;
* ``history.view`` / ``history.manage`` read everything, drafts and research
  included, and ``history.manage`` writes;
* ``history.publish`` decides publication, and the department's clearance list
  stands between it and the public.

Every by-id read resolves inside the caller's department, and every
client-sent id is checked against it before it is stored.
"""

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, handle_service_errors
from app.models.history import HistoricalMember, PublicationLevel
from app.models.user import Position, User
from app.schemas.history import (
    ClearanceDecide,
    ClearanceRequestResponse,
    ClearanceReview,
    ClearanceStepResponse,
    ClearanceStepsReplace,
    ClearanceSubmit,
    HistoricalMemberCreate,
    HistoricalMemberFullView,
    HistoricalMemberList,
    HistoricalMemberMemberView,
    HistoricalMemberUpdate,
    HistoricalMemberView,
    HistoryTitleCreate,
    HistoryTitleMerge,
    HistoryTitleResponse,
    HistoryTitleUpdate,
    HonorRollEntry,
    MarkdownRender,
    MarkdownRendered,
    MergePreview,
    MergeRequest,
    PersonCheck,
    PositionOption,
    PublishRequest,
    RelationCreate,
    RevisionResponse,
    ServicePeriodsReplace,
    UnpublishRequest,
)
from app.services.history_clearance_service import (
    HistoryClearanceService,
    record_path,
    review_path,
)
from app.services.history_merge_service import HistoryMergeService
from app.services.history_notifications import (
    awaiting_clearance_notice,
    clearance_list_changed_notice,
    clearance_outcome_notice,
    send_history_notice,
    unique_ids,
)
from app.services.history_service import (
    MEMORIAL_FIELDS,
    RECORD_MEMBER,
    HistoryService,
    Viewer,
    display_name,
    service_years,
)
from app.utils.markdown_render import render_markdown

router = APIRouter()

_PERSON = "Person"


async def _audit(
    db: AsyncSession, user: User, event_type: str, data: dict, severity: str = "info"
) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="history",
        severity=severity,
        event_data=data,
        user_id=str(user.id),
        username=user.username,
    )


async def _person_view(
    db: AsyncSession, viewer: Viewer, person: HistoricalMember
) -> HistoricalMemberView:
    service = HistoryService(db)
    relations = await service.relations_for(viewer, person)
    if not viewer.can_view_archive:
        return HistoricalMemberMemberView(**service.member_view(person, relations))
    clearance = HistoryClearanceService(db)
    latest = await clearance.latest_request(
        viewer.organization_id, RECORD_MEMBER, person.id
    )
    clearance_view = (
        await clearance.request_view(
            latest, record_label=display_name(person), viewer_id=viewer.user_id
        )
        if latest
        else None
    )
    required = bool(await clearance.list_steps(viewer.organization_id))
    cleared = await clearance.is_cleared(
        viewer.organization_id,
        RECORD_MEMBER,
        person.id,
        person.substantial_revision_number,
    )
    return HistoricalMemberFullView(
        **service.full_view(
            viewer,
            person,
            relations,
            clearance_view,
            clearance_required=required,
            cleared_for_public=cleared,
        )
    )


async def _managed_person(
    db: AsyncSession, user: User, person_id: str
) -> HistoricalMember:
    return ensure_found(
        await HistoryService(db).get_person(str(user.organization_id), person_id),
        _PERSON,
    )


# ----------------------------------------------------------------------
# People
# ----------------------------------------------------------------------


@router.get("/people", response_model=HistoricalMemberList)
async def list_people(
    search: Optional[str] = Query(None, max_length=100),
    decade: Optional[int] = Query(None, ge=1700, le=2200),
    title_id: Optional[str] = Query(None, max_length=36),
    memorial: Optional[bool] = None,
    line_of_duty: Optional[bool] = None,
    level: Optional[PublicationLevel] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The roster of past members.

    Members see records published to members or the public; holders of
    history.view or history.manage also see drafts and may filter by level.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryService(db)
    if decade is not None and decade % 10:
        raise HTTPException(status_code=400, detail="A decade starts on a 0 year")
    people, total = await service.list_people(
        viewer,
        search=search,
        decade=decade,
        title_id=title_id,
        memorial=memorial,
        line_of_duty=line_of_duty,
        level=level,
        limit=limit,
        offset=offset,
    )
    return HistoricalMemberList(items=[service.summary(p) for p in people], total=total)


@router.get("/people/check", response_model=PersonCheck)
async def check_person(
    last_name: Optional[str] = Query(None, max_length=100),
    first_name: Optional[str] = Query(None, max_length=100),
    badge_number: Optional[str] = Query(None, max_length=50),
    exclude_id: Optional[str] = Query(None, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Warnings for the entry form: a badge number already recorded for someone
    else, and people who may be the same person. Never a refusal.

    **Requires permission: history.manage**
    """
    warnings = await HistoryService(db).check_warnings(
        str(current_user.organization_id),
        last_name=last_name,
        first_name=first_name,
        badge_number=badge_number,
        exclude_id=exclude_id,
    )
    return PersonCheck(warnings=warnings)


@router.get("/people/{person_id}", response_model=HistoricalMemberView)
async def get_person(
    person_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One person. Members receive the published view without restricted
    fields; the archive's keepers receive every field.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryService(db)
    person = await service.get_readable_person(viewer, person_id)
    redirected_from = None
    if person is None:
        # A record merged into another: its address leads to the kept one,
        # so links and bookmarks to it keep working.
        new_id = await service.redirected_id(viewer.organization_id, person_id)
        if new_id:
            person = await service.get_readable_person(viewer, new_id)
            redirected_from = person_id
    view = await _person_view(db, viewer, ensure_found(person, _PERSON))
    view.redirected_from = redirected_from
    return view


@router.post("/people", response_model=HistoricalMemberFullView, status_code=201)
async def create_person(
    payload: HistoricalMemberCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add a person to the archive, as a draft.

    **Requires permission: history.manage**
    """
    async with handle_service_errors("Could not add this person"):
        person = await HistoryService(db).create_person(
            str(current_user.organization_id),
            payload.model_dump(exclude_unset=True),
            str(current_user.id),
        )
    await db.commit()
    await _audit(db, current_user, "history_person_created", {"person_id": person.id})
    view = await _person_view(db, Viewer.of(current_user), person)
    assert isinstance(view, HistoricalMemberFullView)
    return view


@router.post(
    "/people/from-member/{user_id}",
    response_model=HistoricalMemberFullView,
    status_code=201,
)
async def create_person_from_member(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Start a record from a current or former member's account, copying their
    name once. The record keeps its own copy from then on.

    **Requires permission: history.manage**
    """
    async with handle_service_errors("Could not add this person"):
        person = await HistoryService(db).create_from_member(
            str(current_user.organization_id), user_id, str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_person_created",
        {"person_id": person.id, "from_user_id": person.user_id},
    )
    view = await _person_view(db, Viewer.of(current_user), person)
    assert isinstance(view, HistoricalMemberFullView)
    return view


@router.patch("/people/{person_id}", response_model=HistoricalMemberFullView)
async def update_person(
    person_id: str,
    payload: HistoricalMemberUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Edit a person. The edit is recorded in the change history as minor or
    substantial; a substantial edit to a public record needs clearing again
    before the public sees it.

    **Requires permission: history.manage**
    """
    person = await _managed_person(db, current_user, person_id)
    values = payload.model_dump(exclude_unset=True)
    edit_kind = values.pop("edit_kind")
    edit_note = values.pop("edit_note", None)
    async with handle_service_errors("Could not save this person"):
        person = await HistoryService(db).update_person(
            person,
            values,
            edit_kind=edit_kind,
            edit_note=edit_note,
            actor_id=str(current_user.id),
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_person_updated",
        {"person_id": person.id, "edit_kind": edit_kind, "fields": sorted(values)},
    )
    reloaded = await _managed_person(db, current_user, person_id)
    view = await _person_view(db, Viewer.of(current_user), reloaded)
    assert isinstance(view, HistoricalMemberFullView)
    return view


@router.put("/people/{person_id}/periods", response_model=HistoricalMemberFullView)
async def replace_service_periods(
    person_id: str,
    payload: ServicePeriodsReplace,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Replace a person's periods of service and the titles held in each.

    **Requires permission: history.manage**
    """
    person = await _managed_person(db, current_user, person_id)
    async with handle_service_errors("Could not save the service periods"):
        person = await HistoryService(db).replace_periods(
            person,
            [p.model_dump() for p in payload.periods],
            edit_kind=payload.edit_kind,
            edit_note=payload.edit_note,
            actor_id=str(current_user.id),
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_person_updated",
        {
            "person_id": person.id,
            "edit_kind": payload.edit_kind,
            "fields": ["service_periods"],
        },
    )
    reloaded = await _managed_person(db, current_user, person_id)
    view = await _person_view(db, Viewer.of(current_user), reloaded)
    assert isinstance(view, HistoricalMemberFullView)
    return view


@router.delete("/people/{person_id}", status_code=204)
async def delete_person(
    person_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Delete a person. Only an unpublished record can be deleted.

    **Requires permission: history.manage**
    """
    person = await _managed_person(db, current_user, person_id)
    label = display_name(person)
    async with handle_service_errors("Could not delete this person"):
        await HistoryService(db).delete_person(person)
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_person_deleted",
        {"person_id": person_id, "display_name": label},
        severity="warning",
    )


@router.get("/people/{person_id}/merge-preview", response_model=MergePreview)
async def merge_preview(
    person_id: str,
    other_id: str = Query(..., min_length=1, max_length=36),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    The two records side by side before a merge: each field, whether it needs
    a choice, and anything that refuses or should give the Historian pause.

    **Requires permission: history.manage**
    """
    keep = await _managed_person(db, current_user, person_id)
    other = await _managed_person(db, current_user, other_id)
    return MergePreview(**await HistoryMergeService(db).preview(keep, other))


@router.post("/people/{person_id}/merge", response_model=HistoricalMemberFullView)
async def merge_person(
    person_id: str,
    payload: MergeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Merge another record into this one. The other record's periods, family
    links and change history move here, and its address forwards here.

    **Requires permission: history.manage**
    """
    async with handle_service_errors("Could not merge these records"):
        try:
            person = await HistoryMergeService(db).merge(
                str(current_user.organization_id),
                person_id,
                payload.other_id,
                dict(payload.choices),
                str(current_user.id),
            )
        except LookupError:
            raise HTTPException(status_code=404, detail="Person not found")
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_person_merged",
        {"person_id": person.id, "merged_person_id": payload.other_id},
    )
    reloaded = await _managed_person(db, current_user, person.id)
    view = await _person_view(db, Viewer.of(current_user), reloaded)
    assert isinstance(view, HistoricalMemberFullView)
    return view


@router.get("/people/{person_id}/revisions", response_model=list[RevisionResponse])
async def list_revisions(
    person_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The person's change history. Readable by holders of history.view or
    history.manage and by members holding a position on the department's
    clearance list.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    if not viewer.can_view_archive and not await HistoryClearanceService(db).is_clearer(
        viewer.organization_id, viewer.user_id
    ):
        raise HTTPException(status_code=403, detail="Not allowed")
    person = ensure_found(
        await HistoryService(db).get_person(viewer.organization_id, person_id),
        _PERSON,
    )
    revisions = await HistoryService(db).revisions(
        viewer.organization_id, RECORD_MEMBER, person.id
    )
    return [
        RevisionResponse(
            id=r.id,
            revision_number=r.revision_number,
            kind=r.kind,
            note=r.note,
            actor_name=r.actor.full_name if r.actor else None,
            created_at=r.created_at,
        )
        for r in revisions
    ]


@router.post("/people/{person_id}/relations", response_model=HistoricalMemberFullView)
async def add_relation(
    person_id: str,
    payload: RelationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Link two people as family. The link shows from both sides.

    **Requires permission: history.manage**
    """
    person = await _managed_person(db, current_user, person_id)
    async with handle_service_errors("Could not link these people"):
        relation = await HistoryService(db).add_relation(
            person,
            payload.related_member_id,
            payload.relation_type,
            payload.label,
            str(current_user.id),
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_relation_added",
        {
            "relation_id": relation.id,
            "person_id": person.id,
            "related_person_id": relation.related_member_id,
            "relation_type": relation.relation_type.value,
        },
    )
    view = await _person_view(db, Viewer.of(current_user), person)
    assert isinstance(view, HistoricalMemberFullView)
    return view


@router.delete("/relations/{relation_id}", status_code=204)
async def delete_relation(
    relation_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Remove a family link.

    **Requires permission: history.manage**
    """
    service = HistoryService(db)
    relation = ensure_found(
        await service.get_relation(str(current_user.organization_id), relation_id),
        "Link",
    )
    data = {
        "relation_id": relation.id,
        "person_id": relation.member_id,
        "related_person_id": relation.related_member_id,
    }
    await service.delete_relation(relation)
    await db.commit()
    await _audit(db, current_user, "history_relation_removed", data)


@router.post("/people/{person_id}/publish", response_model=HistoricalMemberFullView)
async def publish_person(
    person_id: str,
    payload: PublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Publish to members, or to the public once the department's clearance list
    has cleared the record's latest substantial revision. Publishing to the
    public is stored now and shown on the department's website once the
    public feed is turned on.

    **Requires permission: history.publish**
    """
    person = await _managed_person(db, current_user, person_id)
    async with handle_service_errors("Could not publish this record"):
        person = await HistoryService(db).publish(
            person, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_person_published",
        {"person_id": person.id, "level": payload.level},
    )
    reloaded = await _managed_person(db, current_user, person_id)
    view = await _person_view(db, Viewer.of(current_user), reloaded)
    assert isinstance(view, HistoricalMemberFullView)
    return view


@router.post("/people/{person_id}/unpublish", response_model=HistoricalMemberFullView)
async def unpublish_person(
    person_id: str,
    payload: UnpublishRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.publish")),
):
    """
    Lower a record's publication: back to members only, or to draft.

    **Requires permission: history.publish**
    """
    person = await _managed_person(db, current_user, person_id)
    async with handle_service_errors("Could not unpublish this record"):
        person = await HistoryService(db).unpublish(
            person, PublicationLevel(payload.level), str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_person_unpublished",
        {"person_id": person.id, "level": payload.level},
    )
    reloaded = await _managed_person(db, current_user, person_id)
    view = await _person_view(db, Viewer.of(current_user), reloaded)
    assert isinstance(view, HistoricalMemberFullView)
    return view


@router.get("/honor-roll", response_model=list[HonorRollEntry])
async def honor_roll(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Members who died in the line of duty, with the memorial details each
    record makes visible to the caller.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryService(db)
    entries = []
    for person in await service.honor_roll(viewer):
        shown = (
            service.member_view(person, [])
            if not viewer.can_view_archive
            else {field: getattr(person, field) for field in MEMORIAL_FIELDS}
        )
        entries.append(
            HonorRollEntry(
                id=person.id,
                display_name=display_name(person),
                titles=service.summary(person)["titles"],
                service_years=service_years(person.service_periods),
                death_date=shown.get("death_date"),
                death_date_precision=shown.get("death_date_precision"),
                death_date_circa=shown.get("death_date_circa"),
                death_circumstances=shown.get("death_circumstances"),
            )
        )
    return entries


@router.post("/render-markdown", response_model=MarkdownRendered)
async def preview_markdown(
    payload: MarkdownRender,
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Preview a biography as it will be shown.

    **Requires permission: history.manage**
    """
    return MarkdownRendered(html=render_markdown(payload.markdown))


# ----------------------------------------------------------------------
# Titles
# ----------------------------------------------------------------------


def _title_response(title, uses: int = 0) -> HistoryTitleResponse:
    return HistoryTitleResponse(
        id=title.id,
        name=title.name,
        source=title.source,
        sort_order=title.sort_order,
        is_retired=title.is_retired,
        usage_count=uses,
    )


@router.get("/titles", response_model=list[HistoryTitleResponse])
async def list_titles(
    include_retired: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's list of historical titles. The first visit fills it from
    the department's current ranks and positions.

    **Authentication required**
    """
    titles = await HistoryService(db).list_titles(
        str(current_user.organization_id), include_retired=include_retired
    )
    await db.commit()
    return [_title_response(t, uses) for t, uses in titles]


@router.post("/titles", response_model=HistoryTitleResponse, status_code=201)
async def create_title(
    payload: HistoryTitleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Add a title to the list.

    **Requires permission: history.manage**
    """
    async with handle_service_errors("Could not add this title"):
        title = await HistoryService(db).create_title(
            str(current_user.organization_id), payload.name, str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_title_created",
        {"title_id": title.id, "name": title.name},
    )
    return _title_response(title)


@router.patch("/titles/{title_id}", response_model=HistoryTitleResponse)
async def update_title(
    title_id: str,
    payload: HistoryTitleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Rename, retire or reorder a title. A rename corrects every record using it.

    **Requires permission: history.manage**
    """
    service = HistoryService(db)
    title = ensure_found(
        await service.get_title(str(current_user.organization_id), title_id), "Title"
    )
    before = title.name
    async with handle_service_errors("Could not save this title"):
        title = await service.update_title(
            title, payload.model_dump(exclude_unset=True)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_title_updated",
        {
            "title_id": title.id,
            "from": before,
            "to": title.name,
            "is_retired": title.is_retired,
        },
    )
    return _title_response(title)


@router.post("/titles/{title_id}/merge", response_model=HistoryTitleResponse)
async def merge_title(
    title_id: str,
    payload: HistoryTitleMerge,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Merge a title into another: every record using it moves to the other
    title, and this one is removed.

    **Requires permission: history.manage**
    """
    service = HistoryService(db)
    org_id = str(current_user.organization_id)
    source = ensure_found(await service.get_title(org_id, title_id), "Title")
    target = ensure_found(
        await service.get_title(org_id, payload.into_title_id), "Title"
    )
    data = {"from_title_id": source.id, "from": source.name, "into_title_id": target.id}
    async with handle_service_errors("Could not merge these titles"):
        target = await service.merge_title(source, target)
    await db.commit()
    await _audit(db, current_user, "history_title_merged", data)
    return _title_response(target)


# ----------------------------------------------------------------------
# Clearance
# ----------------------------------------------------------------------


@router.get("/clearance/steps", response_model=list[ClearanceStepResponse])
async def list_clearance_steps(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The department's clearance list, in order.

    **Authentication required**
    """
    service = HistoryClearanceService(db)
    org_id = str(current_user.organization_id)
    steps = await service.list_steps(org_id)
    names = await service.position_names(
        org_id, {s.position_id for s in steps if s.position_id}
    )
    return [
        ClearanceStepResponse(
            id=s.id,
            step_order=s.step_order,
            name=s.name,
            position_id=s.position_id,
            position_name=names.get(s.position_id) if s.position_id else None,
            blocked=s.position_id is None or s.position_id not in names,
        )
        for s in steps
    ]


@router.get("/clearance/positions", response_model=list[PositionOption])
async def list_clearance_positions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("history.manage", "settings.manage")
    ),
):
    """
    The department's positions, for choosing who clears each step. Names only:
    who holds them and what they grant are not part of this answer.

    **Requires permission: history.manage or settings.manage**
    """
    result = await db.execute(
        select(Position.id, Position.name)
        .where(Position.organization_id == str(current_user.organization_id))
        .order_by(Position.priority.desc(), Position.name)
    )
    return [PositionOption(id=pid, name=name) for pid, name in result.all()]


@router.put("/clearance/steps", response_model=list[ClearanceStepResponse])
async def replace_clearance_steps(
    payload: ClearanceStepsReplace,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("history.manage", "settings.manage")
    ),
):
    """
    Replace the department's clearance list. Every change is written to the
    audit log and emailed to the department's administrators.

    **Requires permission: history.manage or settings.manage**
    """
    service = HistoryClearanceService(db)
    org_id = str(current_user.organization_id)
    async with handle_service_errors("Could not save the clearance list"):
        before, after = await service.replace_steps(
            org_id, [s.model_dump() for s in payload.steps]
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_clearance_list_changed",
        {"before": before, "after": after},
        severity="warning",
    )
    if before != after:
        background_tasks.add_task(
            send_history_notice,
            org_id,
            unique_ids(await service.administrators(org_id)),
            clearance_list_changed_notice(current_user.full_name),
        )
    return await list_clearance_steps(db=db, current_user=current_user)


@router.post(
    "/clearance/requests", response_model=ClearanceRequestResponse, status_code=201
)
async def submit_for_clearance(
    payload: ClearanceSubmit,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Send a record's current revision through the clearance list — required
    before publishing to the public, optional for internal review.

    **Requires permission: history.manage**
    """
    person = await _managed_person(db, current_user, payload.record_id)
    service = HistoryClearanceService(db)
    async with handle_service_errors("Could not submit this record"):
        request, notify = await service.submit(
            person, payload.purpose, str(current_user.id)
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_clearance_submitted",
        {
            "request_id": request.id,
            "record_id": person.id,
            "purpose": request.purpose.value,
        },
    )
    label = display_name(person)
    background_tasks.add_task(
        send_history_notice,
        str(current_user.organization_id),
        unique_ids(notify),
        awaiting_clearance_notice(label, review_path(request.id)),
    )
    return ClearanceRequestResponse(
        **await service.request_view(
            request, record_label=label, viewer_id=str(current_user.id)
        )
    )


@router.post(
    "/clearance/requests/{request_id}/decide", response_model=ClearanceRequestResponse
)
async def decide_clearance(
    request_id: str,
    payload: ClearanceDecide,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Clear the current step, or return the record for changes with a note.
    Only a member holding the current step's position may decide it.

    **Authentication required**
    """
    org_id = str(current_user.organization_id)
    service = HistoryClearanceService(db)
    request = ensure_found(await service.get_request(org_id, request_id), "Request")
    person = await _managed_person(db, current_user, request.record_id)
    async with handle_service_errors("Could not record this decision"):
        try:
            outcome = await service.decide(
                request, payload.decision, payload.note, str(current_user.id)
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_clearance_decided",
        {
            "request_id": request_id,
            "record_id": person.id,
            "decision": payload.decision.value,
            "status": outcome.request.status.value,
        },
    )
    label = display_name(person)
    path = record_path(RECORD_MEMBER, person.id)
    if outcome.notify_next:
        background_tasks.add_task(
            send_history_notice,
            org_id,
            unique_ids(outcome.notify_next),
            awaiting_clearance_notice(label, review_path(request_id)),
        )
    if outcome.notify_submitter:
        background_tasks.add_task(
            send_history_notice,
            org_id,
            [outcome.notify_submitter],
            clearance_outcome_notice(
                label,
                path,
                cleared=outcome.request.status.value == "cleared",
            ),
        )
    return ClearanceRequestResponse(
        **await service.request_view(
            outcome.request, record_label=label, viewer_id=str(current_user.id)
        )
    )


@router.get("/clearance/queue", response_model=list[ClearanceRequestResponse])
async def clearance_queue(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Records waiting on a step the caller can decide.

    **Authentication required**
    """
    org_id = str(current_user.organization_id)
    service = HistoryClearanceService(db)
    history = HistoryService(db)
    out = []
    for request in await service.queue(org_id, str(current_user.id)):
        person = await history.get_person(org_id, request.record_id)
        if person is None:
            continue
        out.append(
            ClearanceRequestResponse(
                **await service.request_view(
                    request,
                    record_label=display_name(person),
                    viewer_id=str(current_user.id),
                )
            )
        )
    return out


@router.get("/clearance/requests/{request_id}", response_model=ClearanceReview)
async def review_clearance_request(
    request_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    One request and the record as members would read it, for the people
    reviewing it. Readable by the archive's keepers, the member who submitted
    it, and any member holding a position on the request's steps — a reviewer
    has to read a draft to clear it.

    **Authentication required**
    """
    viewer = Viewer.of(current_user)
    service = HistoryClearanceService(db)
    request = ensure_found(
        await service.get_request(viewer.organization_id, request_id), "Request"
    )
    step_positions = {
        str(step["position_id"]) for step in request.steps if step.get("position_id")
    }
    allowed = (
        viewer.can_view_archive
        or str(request.submitted_by or "") == viewer.user_id
        or bool(
            step_positions
            & await service.held_position_ids(viewer.organization_id, viewer.user_id)
        )
    )
    if not allowed:
        # The same answer as a missing request: a member who may not review
        # it learns nothing about what is under review.
        raise HTTPException(status_code=404, detail="Request not found")
    history = HistoryService(db)
    person = ensure_found(
        await history.get_person(viewer.organization_id, request.record_id), _PERSON
    )
    relations = await history.relations_for(viewer, person)
    return ClearanceReview(
        request=ClearanceRequestResponse(
            **await service.request_view(
                request, record_label=display_name(person), viewer_id=viewer.user_id
            )
        ),
        record=HistoricalMemberMemberView(**history.member_view(person, relations)),
    )
