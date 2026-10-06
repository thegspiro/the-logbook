"""Bulk entry of qualifications a department's members already hold.

A department adopting the system arrives with members who have held an EMT
card or a Paramedic licence for years. The only other writer of
``member_qualifications`` is a completed training record, so without this a
licence could be recorded only by inventing a course completion to match it.

Every row is validated before anything is written, and a row that fails is
reported by its line number rather than silently dropped: a missing row here
is a member the scheduler will not clear for a seat they are certified for.
Rows that pass are written through ``QualificationService.grant`` — the same
writer the profile panel uses, and the table shift eligibility reads.
"""

import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.qualification import MemberQualification
from app.models.user import User
from app.services.qualification_service import QUALIFICATIONS, QualificationService

#: Large enough for any department's roster several times over, small enough
#: that one request cannot turn into an unbounded write.
MAX_IMPORT_ROWS = 5000

_MEMBERSHIP_HEADERS = ("membership_number", "badge_number", "badge", "member_id")
_EMAIL_HEADERS = ("email", "member_email", "e-mail")
_QUALIFICATION_HEADERS = ("qualification", "qualification_code", "certification")
_GRANTED_HEADERS = ("granted_on", "granted", "issued_on", "issued", "issue_date")
_EXPIRES_HEADERS = (
    "expires_on",
    "expires",
    "expiration_date",
    "expiry",
    "expiry_date",
)
_NOTES_HEADERS = ("notes", "note", "comments")

# ISO first. US month-first is accepted because that is what a spreadsheet
# exported on a US machine writes; day-first is not, because 03/04/2027 would
# then be ambiguous and a licence silently dated a month out is worse than a
# rejected row.
_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y")


@dataclass
class ImportRowError:
    row: int
    message: str


@dataclass
class ImportRow:
    row: int
    user_id: str
    member_name: str
    qualification_code: str
    granted_on: Optional[date]
    expires_on: Optional[date]
    notes: Optional[str]
    action: str  # "create" or "update"


@dataclass
class ImportResult:
    total_rows: int
    rows: List[ImportRow] = field(default_factory=list)
    errors: List[ImportRowError] = field(default_factory=list)
    imported: int = 0


def _parse_date(raw: str) -> Optional[date]:
    value = raw.strip()
    if not value:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"'{value}' is not a date (use YYYY-MM-DD)")


def _resolve_code(raw: str) -> Optional[str]:
    """Accept a code ("emt") or its label ("Driver / Operator"), any case."""
    value = raw.strip().lower()
    if value in QUALIFICATIONS:
        return value
    for code, entry in QUALIFICATIONS.items():
        if entry["label"].lower() == value:
            return code
    return None


class QualificationImportService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def import_csv(
        self,
        text: str,
        organization_id: str,
        *,
        dry_run: bool,
    ) -> ImportResult:
        """Validate every row, then (unless ``dry_run``) write the valid ones."""
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise ValueError("The CSV file has no header row")
        header_map = {
            h.strip().lower().replace(" ", "_"): h for h in reader.fieldnames if h
        }

        def find(candidates: Tuple[str, ...]) -> Optional[str]:
            for candidate in candidates:
                if candidate in header_map:
                    return header_map[candidate]
            return None

        col_membership = find(_MEMBERSHIP_HEADERS)
        col_email = find(_EMAIL_HEADERS)
        col_code = find(_QUALIFICATION_HEADERS)
        col_granted = find(_GRANTED_HEADERS)
        col_expires = find(_EXPIRES_HEADERS)
        col_notes = find(_NOTES_HEADERS)
        if not col_code:
            raise ValueError("The CSV needs a 'qualification' column")
        if not col_membership and not col_email:
            raise ValueError(
                "The CSV needs a 'membership_number' or an 'email' column to "
                "identify each member"
            )

        by_membership, by_email = await self._member_lookup(organization_id)
        held = await self._held_pairs(organization_id)

        result = ImportResult(total_rows=0)
        seen: Dict[Tuple[str, str], int] = {}
        # Line 1 is the header, so the first data row is line 2 — the number
        # the officer sees in their spreadsheet.
        for line, raw in enumerate(reader, start=2):
            result.total_rows += 1
            if result.total_rows > MAX_IMPORT_ROWS:
                raise ValueError(
                    f"The file has more than {MAX_IMPORT_ROWS} rows; split it"
                )
            row = {k: (v or "") for k, v in raw.items() if k is not None}
            if not any(value.strip() for value in row.values()):
                result.total_rows -= 1
                continue

            problems: List[str] = []
            member = self._match_member(
                row, col_membership, col_email, by_membership, by_email, problems
            )

            raw_code = row.get(col_code, "")
            code = _resolve_code(raw_code)
            if not raw_code.strip():
                problems.append("qualification is blank")
            elif code is None:
                problems.append(
                    f"unknown qualification '{raw_code.strip()}' (known: "
                    f"{', '.join(sorted(QUALIFICATIONS))})"
                )

            granted_on = expires_on = None
            try:
                granted_on = _parse_date(
                    row.get(col_granted, "") if col_granted else ""
                )
            except ValueError as exc:
                problems.append(f"granted date {exc}")
            try:
                expires_on = _parse_date(
                    row.get(col_expires, "") if col_expires else ""
                )
            except ValueError as exc:
                problems.append(f"expiry date {exc}")
            if granted_on and expires_on and expires_on < granted_on:
                problems.append("expiry date is before the granted date")

            if member is not None and code is not None:
                key = (str(member.id), code)
                if key in seen:
                    problems.append(
                        f"duplicates line {seen[key]} (one row per member per "
                        "qualification)"
                    )
                else:
                    seen[key] = line

            if problems or member is None or code is None:
                result.errors.append(ImportRowError(line, "; ".join(problems)))
                continue

            notes = (row.get(col_notes, "") if col_notes else "").strip() or None
            result.rows.append(
                ImportRow(
                    row=line,
                    user_id=str(member.id),
                    member_name=member.full_name,
                    qualification_code=code,
                    granted_on=granted_on,
                    expires_on=expires_on,
                    notes=notes,
                    action="update" if (str(member.id), code) in held else "create",
                )
            )

        if not dry_run:
            service = QualificationService(self.db)
            for item in result.rows:
                await service.grant_manual(
                    user_id=item.user_id,
                    organization_id=organization_id,
                    qualification_code=item.qualification_code,
                    granted_on=item.granted_on,
                    expires_on=item.expires_on,
                    notes=item.notes,
                )
            result.imported = len(result.rows)
        return result

    @staticmethod
    def _match_member(
        row: Dict[str, str],
        col_membership: Optional[str],
        col_email: Optional[str],
        by_membership: Dict[str, User],
        by_email: Dict[str, User],
        problems: List[str],
    ) -> Optional[User]:
        membership = (row.get(col_membership, "") if col_membership else "").strip()
        email = (row.get(col_email, "") if col_email else "").strip()
        if not membership and not email:
            problems.append("no membership number or email to identify the member")
            return None
        member = None
        if membership:
            member = by_membership.get(membership.lower())
        if member is None and email:
            member = by_email.get(email.lower())
        if member is None:
            ident = membership or email
            problems.append(f"no member of this department matches '{ident}'")
        return member

    async def _member_lookup(
        self, organization_id: str
    ) -> Tuple[Dict[str, User], Dict[str, User]]:
        """This department's members only — a row naming anyone else fails."""
        result = await self.db.execute(
            select(User).where(
                User.organization_id == str(organization_id),
                User.deleted_at.is_(None),
            )
        )
        by_membership: Dict[str, User] = {}
        by_email: Dict[str, User] = {}
        for user in result.scalars().all():
            if user.membership_number:
                by_membership[user.membership_number.strip().lower()] = user
            if user.email:
                by_email[user.email.strip().lower()] = user
        return by_membership, by_email

    async def _held_pairs(self, organization_id: str) -> Set[Tuple[str, str]]:
        result = await self.db.execute(
            select(
                MemberQualification.user_id, MemberQualification.qualification_code
            ).where(MemberQualification.organization_id == str(organization_id))
        )
        return {(str(user_id), code) for user_id, code in result.all()}
