"""
History import: drafts, review and the commit that writes the records.

The rules live in ``history_import_engine``. This service stores an uploaded
roster as a draft, records the Historian's decision about each row, and turns a
fully decided draft into history records.

What a commit never does: create a login account. A row is matched to an
existing history record, mapped to an existing member account, created as a new
unlinked record, or skipped (owner decision, 2026-11-03). A match only fills the
record's empty fields and adds the row's service period; what the Historian
already wrote is never overwritten.

Every draft holds personal data (birth dates, notes about people who may still
be living), so its rows are encrypted and deleted on commit, on discard, and 30
days after the draft was last worked on.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.utils import list_within_detail_limit
from app.models.history import (
    DatePrecision,
    HistoricalMember,
    HistoricalMemberPeriodTitle,
    HistoricalMemberRelation,
    HistoricalMemberServicePeriod,
    HistoryImport,
    HistoryImportDecision,
    HistoryImportRow,
    HistoryImportStatus,
    HistoryImportTitleMapping,
    HistoryRevision,
    HistoryTitle,
    HistoryTitleAction,
    PublicationLevel,
    RevisionKind,
)
from app.models.user import User
from app.services import history_import_engine as engine
from app.services.history_service import (
    RECORD_MEMBER,
    HistoryService,
    clean_title_name,
    display_name,
    service_years,
    title_key,
)

#: Owner decision (2026-11-03): an untouched draft is deleted after 30 days.
DRAFT_LIFETIME = timedelta(days=30)

_PRIMARY = (
    HistoryImportDecision.MATCH,
    HistoryImportDecision.MAP,
    HistoryImportDecision.CREATE,
)


class ImportNotFound(LookupError):
    pass


class ImportNotDraft(ValueError):
    """The draft was committed, discarded or expired: nothing more to decide."""


class ImportNotReady(ValueError):
    """Commit refused: a row is undecided or has a problem, or a title is
    unresolved."""


@dataclass
class RowState:
    """One row as the review screen and the commit both read it."""

    row: HistoryImportRow
    parsed: engine.ParsedRow
    problems: list[str]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class HistoryImportService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.history = HistoryService(db)

    # ------------------------------------------------------------------
    # Drafts
    # ------------------------------------------------------------------

    async def create_draft(
        self, organization_id: str, actor_id: str, filename: str, text: str
    ) -> HistoryImport:
        headers, rows = engine.read_csv(text)
        mapping = engine.detect_column_mapping(headers)
        draft = HistoryImport(
            organization_id=str(organization_id),
            status=HistoryImportStatus.DRAFT,
            source_filename=filename[:255],
            headers=headers,
            column_mapping=mapping,
            row_count=len(rows),
            created_by=actor_id,
            expires_at=_now() + DRAFT_LIFETIME,
        )
        self.db.add(draft)
        await self.db.flush()
        for line_number, raw in rows:
            self.db.add(
                HistoryImportRow(
                    import_id=draft.id,
                    line_number=line_number,
                    cells=engine.cells_for(raw, mapping),
                )
            )
        await self.db.flush()
        await self.refresh_suggestions(draft)
        return draft

    async def list_imports(self, organization_id: str) -> list[HistoryImport]:
        result = await self.db.execute(
            select(HistoryImport)
            .where(
                HistoryImport.organization_id == str(organization_id),
                HistoryImport.status.in_(
                    (HistoryImportStatus.DRAFT, HistoryImportStatus.COMMITTED)
                ),
            )
            .order_by(HistoryImport.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_import(
        self, organization_id: str, import_id: str, *, for_update: bool = False
    ) -> HistoryImport:
        query = select(HistoryImport).where(
            HistoryImport.id == str(import_id),
            HistoryImport.organization_id == str(organization_id),
        )
        if for_update:
            query = query.with_for_update()
        draft = await self.db.scalar(query.execution_options(populate_existing=True))
        if draft is None:
            raise ImportNotFound("Import not found")
        return draft

    async def get_draft(
        self, organization_id: str, import_id: str, *, for_update: bool = False
    ) -> HistoryImport:
        draft = await self.get_import(organization_id, import_id, for_update=for_update)
        if draft.status != HistoryImportStatus.DRAFT:
            raise ImportNotDraft("This import is no longer a draft")
        return draft

    async def rows(self, draft: HistoryImport) -> list[HistoryImportRow]:
        result = await self.db.execute(
            select(HistoryImportRow)
            .where(HistoryImportRow.import_id == draft.id)
            .order_by(HistoryImportRow.line_number)
        )
        return list(result.scalars().all())

    async def _row(self, draft: HistoryImport, row_id: str) -> HistoryImportRow:
        row = await self.db.scalar(
            select(HistoryImportRow)
            .join(HistoryImport, HistoryImport.id == HistoryImportRow.import_id)
            .where(
                HistoryImportRow.id == str(row_id),
                HistoryImportRow.import_id == draft.id,
                HistoryImport.organization_id == draft.organization_id,
            )
        )
        if row is None:
            raise ImportNotFound("Row not found")
        return row

    def _touch(self, draft: HistoryImport) -> None:
        draft.expires_at = _now() + DRAFT_LIFETIME

    async def discard(self, organization_id: str, import_id: str) -> HistoryImport:
        draft = await self.get_draft(organization_id, import_id, for_update=True)
        await self.db.execute(
            delete(HistoryImportRow).where(HistoryImportRow.import_id == draft.id)
        )
        draft.status = HistoryImportStatus.DISCARDED
        draft.expires_at = None
        await self.db.flush()
        return draft

    # ------------------------------------------------------------------
    # What the rules need from the database
    # ------------------------------------------------------------------

    async def _existing_people(
        self, organization_id: str
    ) -> list[engine.ExistingPerson]:
        result = await self.db.execute(
            select(HistoricalMember)
            .options(selectinload(HistoricalMember.service_periods))
            .where(HistoricalMember.organization_id == str(organization_id))
        )
        return [
            engine.ExistingPerson(
                id=person.id,
                last_name=person.last_name,
                first_name=person.first_name,
                badge_number=person.badge_number,
                spans=tuple(
                    (
                        p.start_date.year if p.start_date else None,
                        (
                            9999
                            if p.is_ongoing
                            else (p.end_date.year if p.end_date else None)
                        ),
                    )
                    for p in person.service_periods
                ),
                user_id=person.user_id,
            )
            for person in result.scalars().all()
        ]

    async def _accounts(self, organization_id: str) -> list[engine.Account]:
        # Every account, current or archived: a former member's archived
        # account is exactly what an old roster names.
        result = await self.db.execute(
            select(User.id, User.last_name, User.first_name, User.preferred_name).where(
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
        )
        return [
            engine.Account(
                id=str(uid),
                last_name=last or "",
                first_name=first,
                preferred_name=preferred,
            )
            for uid, last, first, preferred in result.all()
        ]

    async def refresh_suggestions(
        self, draft: HistoryImport, only: Optional[Iterable[HistoryImportRow]] = None
    ) -> None:
        """Recompute suggestions, for every row or for the rows given."""
        rows = await self.rows(draft)
        people = await self._existing_people(draft.organization_id)
        accounts = await self._accounts(draft.organization_id)
        linked = {p.user_id: p.id for p in people if p.user_id}
        parsed = {
            row.id: engine.parse_row(engine.effective_values(row.cells, row.edits))
            for row in rows
        }
        repeats = engine.same_person_in_file(
            [
                engine.FileRow(
                    id=row.id,
                    line_number=row.line_number,
                    last_name=parsed[row.id].values.get("last_name", ""),
                    first_name=parsed[row.id].values.get("first_name"),
                    badge_number=parsed[row.id].values.get("badge_number"),
                )
                for row in rows
            ]
        )
        wanted = {row.id for row in only} if only is not None else None
        for row in rows:
            if wanted is not None and row.id not in wanted:
                continue
            suggestions = engine.suggest(parsed[row.id], people, accounts, linked)
            if row.id in repeats:
                suggestions.insert(
                    0,
                    {
                        "kind": engine.SUGGEST_SAME_AS,
                        "id": repeats[row.id],
                        "strength": engine.STRONG,
                    },
                )
            row.suggestions = suggestions
        await self.db.flush()

    # ------------------------------------------------------------------
    # Review
    # ------------------------------------------------------------------

    async def update_row(
        self,
        organization_id: str,
        import_id: str,
        row_id: str,
        values: dict[str, Any],
    ) -> HistoryImportRow:
        draft = await self.get_draft(organization_id, import_id, for_update=True)
        row = await self._row(draft, row_id)
        if "edits" in values:
            edits = dict(row.edits or {})
            for key, value in (values["edits"] or {}).items():
                if key not in engine.FIELDS:
                    raise ValueError(f"{key} is not a column the import reads")
                original = row.cells.get(key, "")
                text = (value or "").strip()
                if text == original:
                    edits.pop(key, None)
                else:
                    edits[key] = text
            row.edits = edits or None
            await self.db.flush()
            await self.refresh_suggestions(draft)
        if "decision" in values:
            await self._apply_decision(draft, row, values)
        self._touch(draft)
        await self.db.flush()
        return row

    async def _apply_decision(
        self, draft: HistoryImport, row: HistoryImportRow, values: dict[str, Any]
    ) -> None:
        decision = values.get("decision")
        row.target_member_id = None
        row.target_user_id = None
        row.target_row_id = None
        if decision is None:
            row.decision = None
            return
        decision = HistoryImportDecision(decision)
        if decision == HistoryImportDecision.MATCH:
            person = await self.history.get_person(
                draft.organization_id, values.get("target_member_id") or ""
            )
            if person is None:
                raise ValueError("Choose a history record to match")
            row.target_member_id = person.id
        elif decision == HistoryImportDecision.MAP:
            user_id = await self.history._validated_user_id(
                draft.organization_id, values.get("target_user_id")
            )
            if user_id is None:
                raise ValueError("Choose a member account")
            already = await self.db.scalar(
                select(HistoricalMember.id).where(
                    HistoricalMember.organization_id == draft.organization_id,
                    HistoricalMember.user_id == user_id,
                )
            )
            if already:
                raise ValueError(
                    "That account already has a history record. Match the row to "
                    "that record instead"
                )
            row.target_user_id = user_id
        elif decision == HistoryImportDecision.SAME_AS:
            target = await self._row(draft, values.get("target_row_id") or "")
            if target.id == row.id:
                raise ValueError("A row cannot repeat itself")
            row.target_row_id = target.id
        row.decision = decision

    async def accept_suggestions(self, organization_id: str, import_id: str) -> int:
        """Decide every undecided row the suggestions settle.

        One suggestion: take it. None: create a new record. Several: leave the
        row for the Historian, since picking one would be a guess.
        """
        draft = await self.get_draft(organization_id, import_id, for_update=True)
        decided = 0
        for row in await self.rows(draft):
            if row.decision is not None:
                continue
            suggestions = row.suggestions or []
            if len(suggestions) > 1:
                continue
            values: dict[str, Any]
            if not suggestions:
                values = {"decision": HistoryImportDecision.CREATE.value}
            else:
                only = suggestions[0]
                values = {"decision": only["kind"]}
                values[
                    {
                        engine.SUGGEST_MATCH: "target_member_id",
                        engine.SUGGEST_MAP: "target_user_id",
                        engine.SUGGEST_SAME_AS: "target_row_id",
                    }[only["kind"]]
                ] = only["id"]
            try:
                await self._apply_decision(draft, row, values)
            except (ValueError, ImportNotFound):
                # The suggested target changed since it was suggested (merged,
                # linked or deleted): leave the row for the Historian.
                row.decision = None
                continue
            decided += 1
        self._touch(draft)
        await self.db.flush()
        return decided

    async def set_titles(
        self,
        organization_id: str,
        import_id: str,
        choices: list[dict[str, Any]],
        actor_id: str,
    ) -> None:
        """Record the department's answer for each title text, for this import
        and every later one."""
        draft = await self.get_draft(organization_id, import_id, for_update=True)
        for choice in choices:
            text = clean_title_name(choice.get("text") or "")
            if not text:
                continue
            key = title_key(text)[:150]
            action = HistoryTitleAction(choice["action"])
            title_id: Optional[str] = None
            if action == HistoryTitleAction.MAP:
                title = await self.history.get_title(
                    organization_id, choice.get("title_id") or ""
                )
                if title is None:
                    raise ValueError(f'Choose a title for "{text}"')
                title_id = title.id
            mapping = await self.db.scalar(
                select(HistoryImportTitleMapping).where(
                    HistoryImportTitleMapping.organization_id == str(organization_id),
                    HistoryImportTitleMapping.source_key == key,
                )
            )
            if mapping is None:
                mapping = HistoryImportTitleMapping(
                    organization_id=str(organization_id), source_key=key
                )
                self.db.add(mapping)
            mapping.source_text = text[:150]
            mapping.action = action
            mapping.title_id = title_id
            mapping.updated_by = actor_id
        self._touch(draft)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Reading a draft
    # ------------------------------------------------------------------

    async def _title_lookup(
        self, organization_id: str
    ) -> tuple[dict[str, HistoryTitle], dict[str, HistoryImportTitleMapping]]:
        await self.history.ensure_titles_seeded(organization_id)
        titles = await self.db.execute(
            select(HistoryTitle).where(
                HistoryTitle.organization_id == str(organization_id)
            )
        )
        by_key = {t.name_key: t for t in titles.scalars().all()}
        mappings = await self.db.execute(
            select(HistoryImportTitleMapping).where(
                HistoryImportTitleMapping.organization_id == str(organization_id)
            )
        )
        return by_key, {m.source_key: m for m in mappings.scalars().all()}

    @staticmethod
    def _title_resolution(
        text: str,
        by_key: dict[str, HistoryTitle],
        mappings: dict[str, HistoryImportTitleMapping],
    ) -> dict[str, Any]:
        """How one title text will be written: as a title on the list, as a new
        title, dropped, or still waiting for the Historian."""
        key = title_key(text)
        mapping = mappings.get(key)
        if mapping is not None:
            if mapping.action == HistoryTitleAction.MAP:
                if mapping.title_id:
                    return {"status": "mapped", "title_id": mapping.title_id}
                # The title it pointed at is gone: ask again.
                return {"status": "unresolved"}
            if mapping.action == HistoryTitleAction.CREATE:
                return {"status": "create"}
            return {"status": "dropped"}
        title = by_key.get(key)
        if title is not None:
            return {"status": "known", "title_id": title.id}
        return {"status": "unresolved"}

    async def _states(self, draft: HistoryImport) -> list[RowState]:
        rows = await self.rows(draft)
        by_id = {row.id: row for row in rows}
        states = []
        mapped_users: dict[str, int] = {}
        for row in rows:
            if row.decision == HistoryImportDecision.MAP and row.target_user_id:
                mapped_users[row.target_user_id] = (
                    mapped_users.get(row.target_user_id, 0) + 1
                )
        # An account may have gained a history record since the row was mapped
        # to it (someone used "Add from member list" meanwhile): mapping it
        # now would give one account two records.
        linked_users = set(
            (
                await self.db.execute(
                    select(HistoricalMember.user_id).where(
                        HistoricalMember.organization_id == draft.organization_id,
                        HistoricalMember.user_id.is_not(None),
                    )
                )
            ).scalars()
        )
        for row in rows:
            parsed = engine.parse_row(engine.effective_values(row.cells, row.edits))
            problems = list(parsed.issues)
            if row.decision == HistoryImportDecision.MATCH and not row.target_member_id:
                problems.append("The record this row matched no longer exists")
            if row.decision == HistoryImportDecision.MAP:
                if not row.target_user_id:
                    problems.append("The account this row mapped to no longer exists")
                elif mapped_users.get(row.target_user_id, 0) > 1:
                    problems.append("Another row is mapped to the same account")
                elif row.target_user_id in linked_users:
                    problems.append(
                        "That account now has a history record: match the row to it"
                    )
            if row.decision == HistoryImportDecision.SAME_AS:
                target = by_id.get(row.target_row_id or "")
                if target is None:
                    problems.append("The row this repeats no longer exists")
                elif target.decision not in _PRIMARY:
                    problems.append(
                        f"Line {target.line_number}, which this repeats, must be "
                        "matched, mapped or created"
                    )
            states.append(RowState(row=row, parsed=parsed, problems=problems))
        return states

    async def detail(self, draft: HistoryImport) -> dict[str, Any]:
        """The draft as the review screen shows it."""
        view = self.summary_view(draft)
        if draft.status != HistoryImportStatus.DRAFT:
            view.update({"rows": [], "titles": [], "ready": False, "blockers": []})
            return view
        states = await self._states(draft)
        by_key, mappings = await self._title_lookup(draft.organization_id)
        title_texts: dict[str, str] = {}
        for state in states:
            if state.row.decision == HistoryImportDecision.SKIP:
                continue
            for text in state.parsed.titles:
                title_texts.setdefault(title_key(text), text)
        titles = []
        for key, text in sorted(title_texts.items()):
            resolution = self._title_resolution(text, by_key, mappings)
            titles.append({"text": text, "key": key, **resolution})
        names = await self._target_names(states)
        line_by_id = {s.row.id: s.row.line_number for s in states}
        rows = []
        for state in states:
            row = state.row
            rows.append(
                {
                    "id": row.id,
                    "line_number": row.line_number,
                    "values": state.parsed.values,
                    "edited_fields": sorted((row.edits or {}).keys()),
                    "problems": state.problems,
                    "decision": row.decision,
                    "target_member_id": row.target_member_id,
                    "target_user_id": row.target_user_id,
                    "target_row_id": row.target_row_id,
                    "target_label": self._target_label(row, names, line_by_id),
                    "suggestions": [
                        {
                            **s,
                            "label": self._suggestion_label(s, names, line_by_id),
                        }
                        for s in (row.suggestions or [])
                    ],
                }
            )
        blockers = self._blockers(states, titles)
        view.update(
            {
                "rows": rows,
                "titles": titles,
                "ready": not blockers,
                "blockers": blockers,
            }
        )
        return view

    @staticmethod
    def _blockers(states: list[RowState], titles: list[dict[str, Any]]) -> list[str]:
        undecided = sum(1 for s in states if s.row.decision is None)
        with_problems = sum(
            1
            for s in states
            if s.row.decision not in (None, HistoryImportDecision.SKIP) and s.problems
        )
        unresolved = sum(1 for t in titles if t["status"] == "unresolved")
        blockers = []
        if undecided:
            blockers.append(f"{undecided} row(s) still need a decision")
        if with_problems:
            blockers.append(
                f"{with_problems} row(s) have a problem to correct, or can be skipped"
            )
        if unresolved:
            blockers.append(f"{unresolved} title(s) still need an answer")
        if states and all(s.row.decision == HistoryImportDecision.SKIP for s in states):
            blockers.append("Every row is skipped: there is nothing to import")
        return blockers

    async def _target_names(self, states: list[RowState]) -> dict[str, str]:
        member_ids: set[str] = set()
        user_ids: set[str] = set()
        for state in states:
            row = state.row
            if row.target_member_id:
                member_ids.add(row.target_member_id)
            if row.target_user_id:
                user_ids.add(row.target_user_id)
            for s in row.suggestions or []:
                if s["kind"] == engine.SUGGEST_MATCH:
                    member_ids.add(s["id"])
                elif s["kind"] == engine.SUGGEST_MAP:
                    user_ids.add(s["id"])
        names: dict[str, str] = {}
        if member_ids:
            people = await self.db.execute(
                select(HistoricalMember)
                .options(selectinload(HistoricalMember.service_periods))
                .where(HistoricalMember.id.in_(member_ids))
            )
            for person in people.scalars().all():
                years = service_years(person.service_periods)
                label = display_name(person)
                names[person.id] = f"{label} ({years})" if years else label
        if user_ids:
            users = await self.db.execute(select(User).where(User.id.in_(user_ids)))
            for user in users.scalars().all():
                names[str(user.id)] = f"{user.full_name} (member account)"
        return names

    @staticmethod
    def _suggestion_label(
        suggestion: dict[str, Any], names: dict[str, str], lines: dict[str, int]
    ) -> str:
        if suggestion["kind"] == engine.SUGGEST_SAME_AS:
            return f"Same person as line {lines.get(suggestion['id'], '?')}"
        return names.get(suggestion["id"], "No longer available")

    @staticmethod
    def _target_label(
        row: HistoryImportRow, names: dict[str, str], lines: dict[str, int]
    ) -> Optional[str]:
        if row.target_member_id:
            return names.get(row.target_member_id)
        if row.target_user_id:
            return names.get(row.target_user_id)
        if row.target_row_id:
            return f"Line {lines.get(row.target_row_id, '?')}"
        return None

    @staticmethod
    def summary_view(draft: HistoryImport) -> dict[str, Any]:
        return {
            "id": draft.id,
            "status": draft.status,
            "source_filename": draft.source_filename,
            "row_count": draft.row_count,
            "column_mapping": draft.column_mapping,
            "summary": draft.summary,
            "expires_at": draft.expires_at,
            "created_at": draft.created_at,
            "committed_at": draft.committed_at,
        }

    # ------------------------------------------------------------------
    # Commit
    # ------------------------------------------------------------------

    async def commit(
        self, organization_id: str, import_id: str, actor_id: str
    ) -> HistoryImport:
        """Write the records. Runs once: the draft row is locked and must still
        be a draft, so a double-click or a retried request is refused rather
        than importing twice."""
        draft = await self.get_draft(organization_id, import_id, for_update=True)
        states = await self._states(draft)
        by_key, mappings = await self._title_lookup(organization_id)
        title_texts: dict[str, str] = {}
        for state in states:
            if state.row.decision == HistoryImportDecision.SKIP:
                continue
            for text in state.parsed.titles:
                title_texts.setdefault(title_key(text), text)
        titles = [
            {"text": text, "key": key, **self._title_resolution(text, by_key, mappings)}
            for key, text in title_texts.items()
        ]
        blockers = self._blockers(states, titles)
        if blockers:
            raise ImportNotReady(list_within_detail_limit("", blockers, separator="; "))
        title_ids = await self._settle_titles(organization_id, titles, actor_id)

        repeats: dict[str, list[RowState]] = {}
        for state in states:
            if state.row.decision == HistoryImportDecision.SAME_AS:
                repeats.setdefault(state.row.target_row_id or "", []).append(state)

        counts = {"created": 0, "mapped": 0, "matched": 0, "repeats": 0, "skipped": 0}
        note = f"Imported from {draft.source_filename}"
        for state in states:
            decision = state.row.decision
            if decision == HistoryImportDecision.SKIP:
                counts["skipped"] += 1
                continue
            if decision not in _PRIMARY:
                continue
            group = [state, *repeats.get(state.row.id, [])]
            counts["repeats"] += len(group) - 1
            if decision == HistoryImportDecision.MATCH:
                await self._fill_existing(
                    organization_id, state, group, title_ids, note, actor_id
                )
                counts["matched"] += 1
            else:
                await self._create_record(
                    organization_id, draft, state, group, title_ids, note, actor_id
                )
                counts[
                    "mapped" if decision == HistoryImportDecision.MAP else "created"
                ] += 1

        await self.db.execute(
            delete(HistoryImportRow).where(HistoryImportRow.import_id == draft.id)
        )
        draft.status = HistoryImportStatus.COMMITTED
        draft.committed_at = _now()
        draft.committed_by = actor_id
        draft.expires_at = None
        draft.summary = counts
        await self.db.flush()
        return draft

    async def _settle_titles(
        self, organization_id: str, titles: list[dict[str, Any]], actor_id: str
    ) -> dict[str, Optional[str]]:
        """{title key: title id, or None to drop}. Titles chosen to be added
        are added now, and the remembered answer becomes "this title"."""
        out: dict[str, Optional[str]] = {}
        for title in titles:
            if title["status"] in ("mapped", "known"):
                out[title["key"]] = title["title_id"]
            elif title["status"] == "dropped":
                out[title["key"]] = None
            elif title["status"] == "create":
                existing = await self.history._title_by_key(
                    organization_id, title["key"]
                )
                created = existing or await self.history.create_title(
                    organization_id, title["text"], actor_id
                )
                out[title["key"]] = created.id
                await self.db.execute(
                    update(HistoryImportTitleMapping)
                    .where(
                        HistoryImportTitleMapping.organization_id
                        == str(organization_id),
                        HistoryImportTitleMapping.source_key == title["key"],
                    )
                    .values(action=HistoryTitleAction.MAP, title_id=created.id)
                    .execution_options(synchronize_session=False)
                )
        return out

    @staticmethod
    def _period_values(
        parsed: engine.ParsedRow, title_ids: dict[str, Optional[str]]
    ) -> Optional[dict[str, Any]]:
        if not parsed.has_period:
            return None
        ids = []
        for text in parsed.titles:
            title_id = title_ids.get(title_key(text))
            if title_id and title_id not in ids:
                ids.append(title_id)
        return {
            "start_date": parsed.joined.value,
            "start_precision": parsed.joined.precision,
            "start_circa": parsed.joined.circa,
            "end_date": parsed.left.value,
            "end_precision": parsed.left.precision,
            "end_circa": parsed.left.circa,
            "is_ongoing": parsed.left.ongoing,
            "title_ids": ids,
        }

    @staticmethod
    def _same_span(
        period: HistoricalMemberServicePeriod, values: dict[str, Any]
    ) -> bool:
        start: Optional[date] = values["start_date"]
        end: Optional[date] = values["end_date"]
        ongoing: bool = values["is_ongoing"]
        return (
            period.start_date == start
            and period.end_date == end
            and period.is_ongoing == ongoing
        )

    async def _add_periods(
        self,
        person: HistoricalMember,
        periods: list[dict[str, Any]],
    ) -> None:
        """Add each period, folding an exact repeat of one already held into it
        so importing the same file twice does not double anyone's service."""
        order = len(person.service_periods)
        for values in periods:
            existing = next(
                (p for p in person.service_periods if self._same_span(p, values)),
                None,
            )
            if existing is not None:
                held = {t.title_id for t in existing.titles}
                for title_id in values["title_ids"]:
                    if title_id not in held:
                        self.db.add(
                            HistoricalMemberPeriodTitle(
                                period_id=existing.id, title_id=title_id
                            )
                        )
                continue
            period = HistoricalMemberServicePeriod(
                member_id=person.id,
                start_date=values["start_date"],
                start_precision=values["start_precision"] or DatePrecision.YEAR,
                start_circa=values["start_circa"],
                end_date=values["end_date"],
                end_precision=values["end_precision"] or DatePrecision.YEAR,
                end_circa=values["end_circa"],
                is_ongoing=values["is_ongoing"],
                sort_order=order,
            )
            order += 1
            self.db.add(period)
            await self.db.flush()
            for title_id in values["title_ids"]:
                self.db.add(
                    HistoricalMemberPeriodTitle(period_id=period.id, title_id=title_id)
                )
        await self.db.flush()

    @staticmethod
    def _person_values(parsed: engine.ParsedRow) -> dict[str, Any]:
        values = parsed.values
        out: dict[str, Any] = {
            key: values.get(key)
            for key in (
                "first_name",
                "middle_name",
                "last_name",
                "suffix",
                "nickname",
                "badge_number",
            )
        }
        out["research_notes"] = values.get("notes")
        if parsed.birth.value:
            out["birth_date"] = parsed.birth.value
            out["birth_date_precision"] = parsed.birth.precision
            out["birth_date_circa"] = parsed.birth.circa
        if parsed.death.value:
            out["death_date"] = parsed.death.value
            out["death_date_precision"] = parsed.death.precision
            out["death_date_circa"] = parsed.death.circa
        if parsed.line_of_duty_death:
            # A line-of-duty death is always a memorial; the death date keeps
            # the phase 1 default of Historian-only until the Historian widens it.
            out["is_line_of_duty_death"] = True
            out["is_memorial"] = True
        return out

    async def _create_record(
        self,
        organization_id: str,
        draft: HistoryImport,
        state: RowState,
        group: list[RowState],
        title_ids: dict[str, Optional[str]],
        note: str,
        actor_id: str,
    ) -> HistoricalMember:
        values = self._person_values(state.parsed)
        person = HistoricalMember(
            organization_id=str(organization_id),
            user_id=state.row.target_user_id,
            created_by=actor_id,
            updated_by=actor_id,
            revision_number=1,
            substantial_revision_number=1,
            import_id=draft.id,
            import_revision_number=1,
        )
        for key, value in values.items():
            if value is not None:
                setattr(person, key, value)
        self.history._settle_dates(person)
        self.db.add(person)
        await self.db.flush()
        loaded = await self.history.get_person(organization_id, person.id)
        if loaded is None:
            raise ValueError("An imported record could not be read back")
        periods = [
            p
            for p in (self._period_values(s.parsed, title_ids) for s in group)
            if p is not None
        ]
        await self._add_periods(loaded, periods)
        reloaded = await self.history.get_person(organization_id, person.id)
        if reloaded is None:
            raise ValueError("An imported record could not be read back")
        await self.history._log(
            reloaded,
            RevisionKind.CREATED,
            actor_id,
            f"{note}, line {state.row.line_number}",
            with_snapshot=True,
        )
        return reloaded

    async def _fill_existing(
        self,
        organization_id: str,
        state: RowState,
        group: list[RowState],
        title_ids: dict[str, Optional[str]],
        note: str,
        actor_id: str,
    ) -> None:
        await self.db.execute(
            select(HistoricalMember.id)
            .where(
                HistoricalMember.id == state.row.target_member_id,
                HistoricalMember.organization_id == str(organization_id),
            )
            .with_for_update()
        )
        person = await self.history.get_person(
            organization_id, state.row.target_member_id or ""
        )
        if person is None:
            raise ImportNotReady(
                f"The record line {state.row.line_number} matched no longer exists"
            )
        # Fill only what is empty: the Historian's own entries always win.
        parsed = state.parsed
        values = self._person_values(parsed)
        for key in (
            "first_name",
            "middle_name",
            "suffix",
            "nickname",
            "badge_number",
            "research_notes",
        ):
            if values.get(key) and not getattr(person, key):
                setattr(person, key, values[key])
        if parsed.birth.value and person.birth_date is None:
            person.birth_date = parsed.birth.value
            person.birth_date_precision = parsed.birth.precision
            person.birth_date_circa = parsed.birth.circa
        if parsed.death.value and person.death_date is None:
            person.death_date = parsed.death.value
            person.death_date_precision = parsed.death.precision
            person.death_date_circa = parsed.death.circa
        if parsed.line_of_duty_death and not person.is_line_of_duty_death:
            person.is_line_of_duty_death = True
            person.is_memorial = True
        self.history._settle_dates(person)
        person.updated_by = actor_id
        await self.db.flush()
        periods = [
            p
            for p in (self._period_values(s.parsed, title_ids) for s in group)
            if p is not None
        ]
        await self._add_periods(person, periods)
        reloaded = await self.history.get_person(organization_id, person.id)
        if reloaded is None:
            raise ImportNotReady("A matched record could not be read back")
        await self.history._after_edit(
            reloaded,
            "substantial",
            f"{note}, line {state.row.line_number}",
            actor_id,
        )

    # ------------------------------------------------------------------
    # Remove this import's records
    # ------------------------------------------------------------------

    async def remove_records(
        self, organization_id: str, import_id: str
    ) -> dict[str, Any]:
        """Delete the records this import created that nobody has touched since.

        A record stays if it was published, edited (by anyone, a later import's
        match included), linked to family, merged or reviewed: each of those
        is someone's work, and this is not the place to undo it. Records the
        import only added to are never touched.
        """
        draft = await self.get_import(organization_id, import_id, for_update=True)
        if draft.status != HistoryImportStatus.COMMITTED:
            raise ValueError("Only a committed import's records can be removed")
        result = await self.db.execute(
            select(HistoricalMember)
            .options(*self.history._person_options())
            .where(
                HistoricalMember.organization_id == str(organization_id),
                HistoricalMember.import_id == draft.id,
            )
            .with_for_update()
        )
        people = list(result.scalars().all())
        removed = 0
        kept: list[dict[str, str]] = []
        for person in people:
            reason = await self._why_kept(person)
            if reason:
                kept.append(
                    {
                        "id": person.id,
                        "display_name": display_name(person),
                        "reason": reason,
                    }
                )
                continue
            await self.history.delete_person(person)
            removed += 1
        summary = dict(draft.summary or {})
        summary["removed"] = int(summary.get("removed", 0)) + removed
        draft.summary = summary
        await self.db.flush()
        return {"removed": removed, "kept": kept}

    async def _why_kept(self, person: HistoricalMember) -> Optional[str]:
        if person.publication_level != PublicationLevel.DRAFT:
            return "Published"
        if person.revision_number != person.import_revision_number:
            return "Edited since the import"
        revisions = await self.db.scalar(
            select(func.count())
            .select_from(HistoryRevision)
            .where(
                HistoryRevision.organization_id == person.organization_id,
                HistoryRevision.record_type == RECORD_MEMBER,
                HistoryRevision.record_id == person.id,
            )
        )
        if int(revisions or 0) > 1:
            return "Reviewed or changed since the import"
        relation = await self.db.scalar(
            select(HistoricalMemberRelation.id).where(
                HistoricalMemberRelation.organization_id == person.organization_id,
                or_(
                    HistoricalMemberRelation.member_id == person.id,
                    HistoricalMemberRelation.related_member_id == person.id,
                ),
            )
        )
        if relation:
            return "Linked to family"
        return None

    # ------------------------------------------------------------------
    # Expiry
    # ------------------------------------------------------------------

    async def expire_drafts(self, organization_id: str) -> int:
        """Delete the rows of drafts nobody has worked on for 30 days.

        Safe to run twice: an expired draft is no longer a draft, so a second
        run finds nothing.
        """
        result = await self.db.execute(
            select(HistoryImport)
            .where(
                HistoryImport.organization_id == str(organization_id),
                HistoryImport.status == HistoryImportStatus.DRAFT,
                HistoryImport.expires_at <= _now(),
            )
            .with_for_update()
        )
        drafts = list(result.scalars().all())
        for draft in drafts:
            await self.db.execute(
                delete(HistoryImportRow).where(HistoryImportRow.import_id == draft.id)
            )
            draft.status = HistoryImportStatus.EXPIRED
            draft.expires_at = None
        await self.db.flush()
        return len(drafts)
