"""
The finalized evaluation's PDF: built once, stored, and served as that file.

``ensure_document`` is called when an evaluation finalizes and again when its
PDF is downloaded. The first call renders and stores the file and records it
in ``evaluation_documents``; every later call finds that row and does
nothing, so a layout or logo change afterwards never alters a signed record
(owner decision 2026-11-02). The download path calling it too means a PDF
that failed to build at finalization is built on first request instead of
leaving a finalized evaluation without its document.

The unique key on (evaluation, revision, includes_response) settles two first
requests racing: the loser's file is removed and the winner's row is used
(CLAUDE.md pitfall #36).

A member's written response is printed in a second document for the same
revision, built the same way once the response is submitted; the first stays
as it was signed (owner decision 2026-11-02).
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import Response
from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.evaluation import (
    Evaluation,
    EvaluationDocument,
    EvaluationPartKind,
    EvaluationPartStatus,
    EvaluationSignature,
    EvaluationStatus,
    EvaluationStepStatus,
    EvaluationStepType,
)
from app.models.user import Organization, User
from app.schemas.evaluation import (
    OVERALL_LEVELS,
    EvaluationTool,
    PartContent,
    TemplateItem,
)
from app.services import file_storage_service as file_storage
from app.services.evaluation_data_sources import DATA_SOURCES
from app.services.evaluation_grading import describe_calculated, grade_content
from app.services.evaluation_service import (
    EvaluationService,
    content_hash,
    form_items,
    weighted_overall,
)
from app.services.file_storage_service import (
    FileRules,
    FileStorageService,
    StorageArea,
)
from app.utils.evaluation_pdf import render_evaluation_pdf
from app.utils.org_timezone import resolve_scheduling_timezone

PDF_RULES = FileRules(
    allowed_types={"application/pdf": ".pdf"},
    # A long annual form with every comment filled runs to a few hundred KB.
    max_bytes=10 * 1024 * 1024,
    description="PDF",
)

_DISPOSITIONS = {
    "signed": "Signed",
    "acknowledged": "Acknowledged receipt",
    "refused": "Refused to sign",
}


def format_figure(entry: Optional[Dict[str, Any]], unit: str) -> str:
    """A measured figure as text, as the evaluation screens show it."""
    if not entry:
        return "Not measured"
    if not entry.get("available"):
        return str(entry.get("note") or "Not available")
    value = entry.get("value")
    if isinstance(value, list):
        if not value:
            return "None"
        return ", ".join(
            (
                f"{v.get('label')} (expires {v['expires_on']})"
                if v.get("expires_on")
                else str(v.get("label"))
            )
            for v in value
        )
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "Not available"
    if unit == "percent":
        return f"{value:g}%"
    if unit == "hours":
        return f"{value:g} h"
    if unit == "rating":
        return f"{value:g} / 5"
    return f"{value:g}"


def _plural(count: float, one: str, many: str) -> str:
    return f"{count:g} {one if count == 1 else many}"


def figure_detail(key: str, entry: Optional[Dict[str, Any]]) -> Optional[str]:
    """The counts behind a measured figure, in words, or None.

    The headline value alone hides what an evaluator and member need to
    weigh it: 75% of four meetings is not 75% of twenty, and a waiver count
    says nothing of what became of the requests. Read from the extras each
    source already stores beside its value, so an older snapshot without
    them simply shows no detail. The evaluation screens word the same
    details in ``figureDetail`` (frontend ``utils/evaluationRecord.ts``);
    change both together.
    """
    if not entry or not entry.get("available"):
        return None

    def num(field: str) -> Optional[float]:
        value = entry.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return float(value)

    if key == "training.requirements_met_pct":
        met, total = num("met"), num("total")
        if met is not None and total is not None:
            return f"{met:g} of {_plural(total, 'requirement', 'requirements')} met"
    if key == "training.session_attendance_pct":
        attended, held = num("attended"), num("held")
        excused = num("excused") or 0.0
        if attended is not None and held is not None:
            charged = _plural(held - excused, "session", "sessions")
            text = f"{attended:g} of {charged} attended"
            if excused:
                text += f" ({excused:g} excused)"
            requirement = entry.get("requirement")
            if requirement:
                text += f"; {requirement} requires {num('required_pct') or 0:g}%"
            return text
    if key == "events.meeting_attendance_pct":
        attended, held = num("attended"), num("held")
        if attended is not None and held is not None:
            return f"{attended:g} of {_plural(held, 'meeting', 'meetings')} attended"
    if key == "calls.response_pct":
        responses, calls = num("responses"), num("department_calls")
        if responses is not None and calls is not None:
            text = (
                f"{_plural(responses, 'response', 'responses')} to "
                f"{_plural(calls, 'department call', 'department calls')}"
            )
            if entry.get("capped") is True:
                text += (
                    "; shown as 100% because shift call credit exceeds the "
                    "department's call log"
                )
            return text
    if key == "shifts.hours":
        external = num("external_hours")
        if external:
            return f"Not included: {external:g} h for other agencies"
    if key == "shifts.count":
        external = num("external_shifts")
        if external:
            return (
                "Not included: "
                f"{_plural(external, 'shift', 'shifts')} for other agencies"
            )
    breakdown = entry.get("breakdown")
    if isinstance(breakdown, str) and breakdown:
        return breakdown
    return None


def _answer(
    item: TemplateItem, content: PartContent, evaluator: bool
) -> Optional[Dict[str, Any]]:
    answer = content.answers.get(item.key)
    if answer is None:
        return None
    notes: List[Tuple[str, str]] = []
    if item.tool in (EvaluationTool.NARRATIVE, EvaluationTool.GOALS):
        text = answer.text or "—"
    elif item.tool == EvaluationTool.CHECKLIST:
        text = ", ".join(answer.checked) if answer.checked else "None checked"
    elif answer.na:
        text = "Not applicable"
    else:
        levels = (
            {1: "Meets", 0: "Does not meet"}
            if item.tool == EvaluationTool.MEETS
            else {level.value: level.label for level in item.levels}
        )
        text = (
            levels.get(answer.rating, "Not rated")
            if answer.rating is not None
            else "Not rated"
        )
    if answer.comment:
        notes.append(("Comment", answer.comment))
    if answer.example:
        notes.append(("Example", answer.example))
    if evaluator and answer.justification:
        notes.append(("Why the rating differs from the figures", answer.justification))
    return {"answer": text, "notes": notes}


class EvaluationDocumentService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.evaluations = EvaluationService(db)

    async def _document(
        self, evaluation: Evaluation, with_response: bool = False
    ) -> Optional[EvaluationDocument]:
        return (
            await self.db.execute(
                select(EvaluationDocument).where(
                    EvaluationDocument.evaluation_id == evaluation.id,
                    EvaluationDocument.organization_id == evaluation.organization_id,
                    EvaluationDocument.revision == evaluation.revision,
                    EvaluationDocument.includes_response.is_(with_response),
                )
            )
        ).scalar_one_or_none()

    async def ensure_document(
        self,
        organization_id: str,
        evaluation_id: str,
        actor: User,
        *,
        with_response: bool = False,
    ) -> Optional[EvaluationDocument]:
        """The revision's frozen PDF, building it on first call. None when
        the evaluation does not exist or is not finalized, or, for the
        response PDF, when no response has been submitted."""
        evaluation = await self.evaluations._evaluation(organization_id, evaluation_id)
        if evaluation is None or evaluation.status != EvaluationStatus.FINALIZED.value:
            return None
        existing = await self._document(evaluation, with_response)
        if existing is not None:
            return existing

        parts = await self.evaluations._parts(evaluation)
        response = parts.get(EvaluationPartKind.MEMBER_RESPONSE.value)
        submitted_response = (
            response
            if response is not None
            and response.status == EvaluationPartStatus.SUBMITTED.value
            else None
        )
        if with_response and submitted_response is None:
            return None
        record = await self._record(
            evaluation, parts, submitted_response if with_response else None
        )
        pdf = render_evaluation_pdf(record)
        stored = await FileStorageService(self.db).store_bytes(
            pdf,
            original_name="evaluation.pdf",
            organization_id=organization_id,
            area=StorageArea.EVALUATIONS,
            rules=PDF_RULES,
            user=actor,
            record_id=evaluation.id,
        )
        document = EvaluationDocument(
            organization_id=organization_id,
            evaluation_id=evaluation.id,
            revision=evaluation.revision,
            file_path=stored.path,
            file_sha256=hashlib.sha256(pdf).hexdigest(),
            content_hash=record["content_hash"],
            size_bytes=len(pdf),
            includes_response=with_response,
        )
        try:
            async with self.db.begin_nested():
                self.db.add(document)
            await self.db.commit()
        except IntegrityError:
            # Another request stored it first; keep theirs, drop this copy.
            await file_storage.delete_quietly(stored.path)
            return await self._document(evaluation, with_response)
        logger.info(
            "Stored evaluation document for evaluation {} revision {} (response: {})",
            evaluation.id,
            evaluation.revision,
            with_response,
        )
        return document

    async def response(
        self, organization_id: str, evaluation: Evaluation, document: EvaluationDocument
    ) -> Response:
        path = file_storage.resolve(
            document.file_path, organization_id, StorageArea.EVALUATIONS
        )
        if path is None or not await file_storage.exists(path):
            logger.error("Evaluation document {} is missing from storage", document.id)
            raise FileNotFoundError("The evaluation's PDF is missing from storage.")
        return await file_storage.file_response(
            path,
            filename=(
                f"evaluation-{evaluation.period_end.isoformat()}"
                f"{'-with-response' if document.includes_response else ''}.pdf"
            ),
            media_type="application/pdf",
        )

    async def _record(
        self,
        evaluation: Evaluation,
        parts: Dict[str, Any],
        response: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Everything the PDF prints, already in words."""
        org_id = evaluation.organization_id
        tz = await resolve_scheduling_timezone(self.db, org_id)
        organization = await self.db.get(Organization, org_id)
        people = await self.evaluations._people(
            org_id, [evaluation.member_id, evaluation.evaluator_id]
        )
        member = people.get(evaluation.member_id)
        evaluator = people.get(evaluation.evaluator_id or "")
        definition = self.evaluations._definition(evaluation)
        workflow = self.evaluations._workflow(evaluation)
        steps = await self.evaluations._steps(evaluation)
        labels = {ws.key: ws.label for ws in workflow.steps}

        def submitted(kind: str) -> Optional[PartContent]:
            part = parts.get(kind)
            if part is None or part.status != EvaluationPartStatus.SUBMITTED.value:
                return None
            return PartContent.model_validate(part.content)

        evaluator_content = (
            submitted(EvaluationPartKind.EVALUATOR.value) or PartContent()
        )
        self_content = submitted(EvaluationPartKind.SELF_EVALUATION.value)
        self_keys = set(
            form_items(definition, EvaluationPartKind.SELF_EVALUATION.value)
        )

        grades = grade_content(definition, evaluator_content)
        grade_by_key = {g["key"]: g for g in (grades or {}).get("sections", [])}
        sections = []
        for block in definition.sections:
            items = []
            for item in block.items:
                items.append(
                    {
                        "label": item.label,
                        "evaluator": _answer(item, evaluator_content, True),
                        "self": (
                            _answer(item, self_content, False)
                            if self_content is not None and item.key in self_keys
                            else None
                        ),
                    }
                )
            sections.append(
                {
                    "title": block.title,
                    "items": items,
                    "grade": _grade_lines(grade_by_key.get(block.key)),
                }
            )

        overall: Optional[str] = None
        overall_override: Optional[Dict[str, str]] = None
        grade_rows: List[Tuple[str, str, str]] = []
        if grades is not None:
            overall = describe_calculated(grades["overall"])
            if grades["overall"]["override_level"] is not None:
                overall_override = {
                    "label": grades["overall"]["override_label"],
                    "reason": grades["overall"]["reason"] or "",
                }
            grade_rows = [
                (g["title"], f"{g['weight']}%", _standing(g))
                for g in grades["sections"]
            ]
        elif definition.overall_mode == "weighted":
            pct = weighted_overall(
                evaluator_content,
                form_items(definition, EvaluationPartKind.EVALUATOR.value),
            )
            overall = f"{pct:g}% (weighted)" if pct is not None else None
        elif (
            definition.overall_mode == "evaluator" and evaluator_content.overall_rating
        ):
            overall = next(
                (
                    lv.label
                    for lv in OVERALL_LEVELS
                    if lv.value == evaluator_content.overall_rating
                ),
                None,
            )

        self_step = next(
            (
                s
                for s in steps
                if s.step_type == EvaluationStepType.SELF_EVALUATION.value
            ),
            None,
        )
        if self_step is None:
            self_status = "Not part of this form"
        elif self_content is not None:
            self_status = "Submitted"
        elif self_step.status == EvaluationStepStatus.SKIPPED.value:
            self_status = "Not submitted by its due date"
        else:
            self_status = "Not submitted"

        snapshot = evaluation.data_snapshot or {}
        values = snapshot.get("values") or {}
        figures = []
        for source in DATA_SOURCES:
            if source.key not in values:
                continue
            text = format_figure(values.get(source.key), source.unit)
            detail = figure_detail(source.key, values.get(source.key))
            figures.append((source.label, f"{text} · {detail}" if detail else text))
        signatures = (
            (
                await self.db.execute(
                    select(EvaluationSignature)
                    .where(
                        EvaluationSignature.evaluation_id == evaluation.id,
                        EvaluationSignature.organization_id == org_id,
                        EvaluationSignature.revision == evaluation.revision,
                    )
                    .order_by(EvaluationSignature.signed_at)
                )
            )
            .scalars()
            .all()
        )

        return {
            "org_name": organization.name if organization else None,
            "logo": organization.logo if organization else None,
            "title": evaluation.template_version.template.name,
            "member_name": member.full_name if member else "Former member",
            "evaluator_name": evaluator.full_name if evaluator else None,
            "period": (
                f"{evaluation.period.name + ' · ' if evaluation.period else ''}"
                f"{_day(evaluation.period_start)} – {_day(evaluation.period_end)}"
            ),
            "coverage": (
                f"{_day(evaluation.coverage_start)} – {_day(evaluation.coverage_end)}"
                if evaluation.coverage_start and evaluation.coverage_end
                else None
            ),
            "excluded": [
                f"{'Leave of absence' if r.get('reason') == 'leave' else 'Not a member'}, "
                f"{r.get('start')} – {r.get('end')}"
                for r in evaluation.excluded_ranges or []
            ],
            "figures": figures,
            "sections": sections,
            "overall": overall,
            "overall_override": overall_override,
            "grade_rows": grade_rows,
            "overall_comment": evaluator_content.overall_comment,
            "self_status": self_status,
            "self_comment": self_content.overall_comment if self_content else None,
            "signatures": [
                {
                    "label": labels.get(sig.step_key, sig.step_key),
                    "name": sig.signed_name,
                    "disposition": _DISPOSITIONS.get(sig.disposition, sig.disposition),
                    "comment": sig.comment,
                    "signed_at": _moment(sig.signed_at, tz),
                }
                for sig in signatures
            ],
            "amendments": [
                {
                    "revision": a["to_revision"],
                    "by": a["amended_by_name"],
                    "at": _moment(a["amended_at"], tz),
                    "reason": a["reason"],
                }
                for a in await self.evaluations._amendments(evaluation)
            ],
            "content_hash": content_hash(evaluation, parts),
            "response": (
                {
                    "text": PartContent.model_validate(
                        response.content
                    ).overall_comment,
                    "submitted_at": _moment(response.submitted_at, tz),
                }
                if response is not None
                else None
            ),
            "generated_at": _moment(datetime.now(timezone.utc), tz),
        }


def _standing(grade: Dict[str, Any]) -> str:
    """A section's grade for the summary table: the one that stands, and the
    calculated one beside it when the evaluator changed it."""
    if grade["override_level"] is not None:
        return (
            f"{grade['override_label']} (evaluator's grade; calculated "
            f"{describe_calculated(grade)})"
        )
    return describe_calculated(grade)


def _grade_lines(grade: Optional[Dict[str, Any]]) -> Optional[Dict[str, str]]:
    """What the PDF prints under a graded section."""
    if grade is None:
        return None
    lines = {"calculated": describe_calculated(grade)}
    if grade["override_level"] is not None:
        lines["override"] = grade["override_label"]
        lines["reason"] = grade["reason"] or ""
    return lines


def _day(value: Any) -> str:
    return value.strftime("%b %d, %Y").replace(" 0", " ") if value else "—"


def _moment(value: Optional[datetime], tz: ZoneInfo) -> str:
    if value is None:
        return "—"
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(tz).strftime("%b %d, %Y %I:%M %p %Z").replace(" 0", " ")
