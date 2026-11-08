"""
QuickBooks Online live posting (Finance)

Owner decision, 2026-11-01: a department may connect its QuickBooks Online
company, and each payment then posts as a QuickBooks **Purchase** to its
vendor (decided 2026-10-09, docs/KNOWN_LIMITATIONS.md "Finance -- QuickBooks
Export Gaps"), rather than as a journal entry in the CSV file.

What posts live, and what stays on the CSV export:

- a paid purchase request -- one line, to its vendor;
- an issued check -- one line, to its payee; a reimbursement check carries its
  expense report's lines, as its CSV entry does;
- a paid expense report not paid by a reimbursement check -- its lines, to the
  member who claimed them.

Cash advances, reports that account for an advance (part of such a report is
paid from the advance, and a Purchase is paid from one account), dues, advance
returns and check voids stay on the CSV export. So does a payment made before
the connection's ``post_from`` date, and every payment of a department that is
not connected.

A payment is never in both. The CSV export leaves out any payment with a
queued, retrying or posted posting (``FinanceService.live_posting_clause``),
and a payment the CSV export already stamped is never queued; one stamped
while its posting waited is marked ``superseded`` and not sent.

Accounts are the export's own: ``_resolve_category_accounts`` names the
expense account (the line) and the paid-from account (the Purchase's
``AccountRef``), and they are found in QuickBooks by name, exactly. The
paid-from account must be a QuickBooks Bank account: a cash Purchase paid from
a bank account is the combination Intuit's documentation shows; check and
credit card purchases were not confirmed there, so they are not sent.

Idempotency (CLAUDE.md pitfall #36): the posting row is unique per payment,
the Purchase id QuickBooks returns is stored on it, and every create carries
Intuit's ``requestid`` -- "If our service receives another request with the
same request ID, instead of performing the operation again ... it can
recognize and send the same response for the original request". A posting
keeps its request id across transient failures, so a resend after a lost
response gets the original Purchase back. It gets a new one only after
Intuit refused the request, when nothing was created.

No Finance or Documents row is locked here: payments are only read, and the
posting rows are this feature's own, so the lock order at the top of
documents_service.py is not touched. Deciding which payments to queue takes
the department's ``quickbooks_export`` lock, the one the CSV export takes, so
the two cannot both claim a payment.
"""

from __future__ import annotations

import json
import secrets
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

import httpx
import jwt
from loguru import logger
from sqlalchemy import and_, delete, exists, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.config import settings
from app.models.finance import (
    Budget,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    ExpenseReport,
    ExpenseReportStatus,
    ExportLog,
    PurchaseRequest,
    PurchaseRequestStatus,
    QuickBooksConnection,
    QuickBooksPosting,
)
from app.models.user import User
from app.services import quickbooks_online_client as qbo
from app.services.finance_service import (
    LIVE_POSTING_STATUSES,
    PAYMENT_CHECK,
    PAYMENT_PURCHASE,
    PAYMENT_REPORT,
    QB_EXPORT_IN_PROGRESS_WINDOW,
    FinanceService,
    _qb_amount,
    _resolve_category_accounts,
)
from app.utils.member_names import format_display_name
from app.utils.org_locks import QUICKBOOKS_EXPORT, lock_organization_scope
from app.utils.org_timezone import resolve_scheduling_timezone

STATE_PURPOSE = "quickbooks_connect"
STATE_TTL_SECONDS = 600

# A run's hold on the connection while it talks to Intuit. Longer than a
# run takes; a run a crash abandoned stops blocking after it.
SYNC_LEASE = timedelta(minutes=10)
# Postings sent per run, well inside Intuit's 500 requests a minute per
# company (each takes one call, two when it creates the vendor).
BATCH_LIMIT = 50
# Refresh an access token this close to its expiry (they last an hour).
REFRESH_MARGIN = timedelta(minutes=5)
# Intuit's refresh tokens expire 100 days after they were issued, on a rolling
# basis, and a department may go that long without a payment. A run renews
# the grant when less than this is left, so a quiet spell does not end in
# "reconnect required".
REFRESH_TOKEN_RENEW_MARGIN = timedelta(days=30)
# Waits after the 1st, 2nd, ... transient failure; the last repeats.
RETRY_DELAYS = (
    timedelta(minutes=5),
    timedelta(minutes=15),
    timedelta(hours=1),
    timedelta(hours=4),
    timedelta(hours=12),
)

STATUS_QUEUED = "queued"
STATUS_RETRYING = "retrying"
STATUS_POSTED = "posted"
STATUS_FAILED = "failed"
STATUS_SUPERSEDED = "superseded"

CONNECTED = "connected"
DISCONNECTED = "disconnected"
RECONNECT_REQUIRED = "reconnect_required"

# QuickBooks' own name for the account type a cash Purchase is paid from.
BANK_ACCOUNT_TYPE = "Bank"


class QuickBooksConnectError(Exception):
    """A connect callback was refused; the message is a short reason code
    that goes back to the settings page in the redirect."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _new_request_id() -> str:
    return uuid.uuid4().hex


def _short(text: str, limit: int = 500) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 3] + "..."


def retry_delay(attempts: int) -> timedelta:
    index = max(0, min(attempts - 1, len(RETRY_DELAYS) - 1))
    return RETRY_DELAYS[index]


async def load_connection(
    db: AsyncSession, org_id: str, *, lock: bool = False
) -> Optional[QuickBooksConnection]:
    statement = select(QuickBooksConnection).where(
        QuickBooksConnection.organization_id == org_id
    )
    if lock:
        statement = statement.with_for_update()
    result: Optional[QuickBooksConnection] = (
        await db.execute(statement)
    ).scalar_one_or_none()
    return result


async def _connection_for_update(db: AsyncSession, org_id: str) -> QuickBooksConnection:
    connection = await load_connection(db, org_id, lock=True)
    if connection is None:
        connection = QuickBooksConnection(organization_id=org_id, status=DISCONNECTED)
        db.add(connection)
        try:
            await db.flush()
        except IntegrityError:
            # Another request created it first; use that one.
            await db.rollback()
            connection = await load_connection(db, org_id, lock=True)
            if connection is None:
                raise
    return connection


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


async def connection_status(db: AsyncSession, org_id: str) -> dict[str, Any]:
    credentials = qbo.configured_credentials()
    connection = await load_connection(db, org_id)
    counts = {
        status: 0
        for status in (
            STATUS_QUEUED,
            STATUS_RETRYING,
            STATUS_POSTED,
            STATUS_FAILED,
            STATUS_SUPERSEDED,
        )
    }
    rows = await db.execute(
        select(QuickBooksPosting.status, QuickBooksPosting.id).where(
            QuickBooksPosting.organization_id == org_id
        )
    )
    for status, _ in rows.all():
        counts[status] = counts.get(status, 0) + 1
    connected_by_name = None
    if connection is not None and connection.connected_by:
        user = (
            await db.execute(
                select(User).where(
                    User.id == connection.connected_by,
                    User.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if user is not None:
            connected_by_name = (
                format_display_name(
                    user.first_name, user.last_name, user.preferred_name
                )
                or user.username
            )
    status = connection.status if connection is not None else DISCONNECTED
    environment_mismatch = bool(
        credentials is not None
        and connection is not None
        and connection.status != DISCONNECTED
        and connection.environment
        and connection.environment != credentials.environment
    )
    return {
        "configured": credentials is not None,
        "environment": credentials.environment if credentials else None,
        "status": status,
        "connected_environment": connection.environment if connection else None,
        "environment_mismatch": environment_mismatch,
        "realm_id": connection.realm_id if connection else None,
        "connected_at": connection.connected_at if connection else None,
        "connected_by_name": connected_by_name,
        "post_from": connection.post_from if connection else None,
        "last_sync_at": connection.last_sync_at if connection else None,
        "last_error": connection.last_error if connection else None,
        "counts": counts,
    }


# ---------------------------------------------------------------------------
# Connect and disconnect
# ---------------------------------------------------------------------------


async def begin_connect(db: AsyncSession, org_id: str, user_id: str) -> tuple[str, str]:
    """Start a connect attempt; return (Intuit consent URL, cookie nonce).

    The attempt is bound three ways, as the calendar connects are
    (calendar_oauth_common): a signed ten-minute ``state``, the nonce
    double-submitted through an httpOnly cookie, and the same nonce stored
    encrypted as the connection's one pending attempt, which the callback
    consumes before anything else so a state works once.
    """
    credentials = qbo.require_credentials()
    connection = await _connection_for_update(db, org_id)
    nonce = secrets.token_urlsafe(32)
    expires = int(time.time()) + STATE_TTL_SECONDS
    connection.pending_attempt = json.dumps(
        {"nonce": nonce, "user_id": user_id, "exp": expires}
    )
    state = str(
        jwt.encode(
            {
                "purpose": STATE_PURPOSE,
                "org": org_id,
                "usr": user_id,
                "nonce": nonce,
                "exp": expires,
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )
    )
    await db.commit()
    return qbo.authorization_url(credentials, state), nonce


def _decode_state(state: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            state, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
    except jwt.PyJWTError as exc:
        raise QuickBooksConnectError("invalid_state") from exc
    if not isinstance(payload, dict) or payload.get("purpose") != STATE_PURPOSE:
        raise QuickBooksConnectError("invalid_state")
    return payload


async def _may_still_manage(db: AsyncSession, org_id: str, user_id: str) -> bool:
    """The Treasurer who began the attempt must still hold finance.manage when
    it finishes; ten minutes is long enough to lose it."""
    user = (
        await db.execute(
            select(User)
            .where(
                User.id == user_id,
                User.organization_id == org_id,
                User.deleted_at.is_(None),
            )
            .options(selectinload(User.roles))
        )
    ).scalar_one_or_none()
    return bool(
        user is not None
        and user.is_active
        and user_has_permission(user, "finance.manage")
    )


async def complete_connect(
    db: AsyncSession,
    http: httpx.AsyncClient,
    *,
    state: Optional[str],
    nonce_cookie: Optional[str],
    code: Optional[str],
    realm_id: Optional[str],
    error: Optional[str],
) -> tuple[str, str]:
    """Finish a connect from Intuit's redirect; return (org id, user id).

    Raises ``QuickBooksConnectError(reason)`` when refused.
    """
    if not state:
        raise QuickBooksConnectError(error or "access_denied")
    payload = _decode_state(state)
    nonce = str(payload.get("nonce") or "")
    if not nonce_cookie or not nonce or not secrets.compare_digest(nonce, nonce_cookie):
        raise QuickBooksConnectError("invalid_state")
    org_id = str(payload.get("org") or "")
    user_id = str(payload.get("usr") or "")

    connection = await load_connection(db, org_id, lock=True)
    if connection is None:
        raise QuickBooksConnectError("invalid_state")
    raw = connection.pending_attempt
    # Removed whether or not it matches, so a replayed state finds nothing.
    connection.pending_attempt = None
    await db.commit()
    try:
        pending = json.loads(raw) if raw else None
    except ValueError:
        pending = None
    if not isinstance(pending, dict):
        raise QuickBooksConnectError("invalid_state")
    stored_nonce = str(pending.get("nonce") or "")
    if (
        not stored_nonce
        or not secrets.compare_digest(stored_nonce, nonce)
        or str(pending.get("user_id") or "") != user_id
    ):
        raise QuickBooksConnectError("invalid_state")
    expires = pending.get("exp")
    if not isinstance(expires, int) or expires < int(time.time()):
        raise QuickBooksConnectError("expired_state")

    credentials = qbo.configured_credentials()
    if credentials is None:
        raise QuickBooksConnectError("not_configured")
    if error or not code:
        raise QuickBooksConnectError(error or "access_denied")
    realm = (realm_id or "").strip()
    if not realm or len(realm) > 32 or not realm.isalnum():
        raise QuickBooksConnectError("missing_company")
    if not await _may_still_manage(db, org_id, user_id):
        raise QuickBooksConnectError("not_authorized")

    try:
        tokens = await qbo.exchange_code(http, credentials, code)
    except qbo.QuickBooksError as exc:
        logger.warning(
            "QuickBooks code exchange failed for org {}: {}", org_id, type(exc).__name__
        )
        raise QuickBooksConnectError("token_exchange_failed") from exc

    connection = await _connection_for_update(db, org_id)
    connection.status = CONNECTED
    connection.environment = credentials.environment
    connection.realm_id = realm
    connection.access_token = tokens.access_token
    connection.refresh_token = tokens.refresh_token
    connection.access_token_expires_at = tokens.access_expires_at
    connection.refresh_token_expires_at = tokens.refresh_expires_at
    connection.connected_by = user_id
    connection.connected_at = _now()
    connection.last_error = None
    if connection.post_from is None:
        connection.post_from = connection.connected_at
    await db.commit()
    return org_id, user_id


async def disconnect(db: AsyncSession, http: httpx.AsyncClient, org_id: str) -> bool:
    """Forget the tokens and revoke them at Intuit; True if Intuit confirmed.

    Payments still queued were never sent, so their postings are removed
    and they go back to the CSV export. A posting waiting on a retry may
    already exist in QuickBooks, so it stays: reconnecting to the same
    company resends it with the same request id.
    """
    connection = await load_connection(db, org_id, lock=True)
    if connection is None:
        return True
    token = connection.refresh_token
    connection.status = DISCONNECTED
    connection.access_token = None
    connection.refresh_token = None
    connection.access_token_expires_at = None
    connection.refresh_token_expires_at = None
    connection.pending_attempt = None
    connection.sync_lease_until = None
    await db.execute(
        delete(QuickBooksPosting).where(
            QuickBooksPosting.organization_id == org_id,
            QuickBooksPosting.status == STATUS_QUEUED,
        )
    )
    await db.commit()
    credentials = qbo.configured_credentials()
    if not token or credentials is None:
        return token is None
    return await qbo.revoke_token(http, credentials, token)


async def set_post_from(db: AsyncSession, org_id: str, when: datetime) -> None:
    connection = await load_connection(db, org_id, lock=True)
    if connection is None or connection.status == DISCONNECTED:
        raise ValueError("Connect to QuickBooks first")
    connection.post_from = when
    await db.commit()


# ---------------------------------------------------------------------------
# Queueing
# ---------------------------------------------------------------------------


def _no_posting(payment_type: str, column: Any, org_id: str) -> Any:
    return ~exists().where(
        QuickBooksPosting.organization_id == org_id,
        QuickBooksPosting.payment_type == payment_type,
        QuickBooksPosting.payment_id == column,
    )


def _no_advance(column: Any) -> Any:
    return or_(column.is_(None), column == 0)


async def enqueue(db: AsyncSession, org_id: str, post_from: datetime) -> int:
    """Queue every payment that should post and has no posting yet.

    Under the CSV export's lock, and skipped while an export is being
    prepared: that export chose its payments without seeing these postings.
    """
    await lock_organization_scope(db, org_id, QUICKBOOKS_EXPORT)
    running = await db.scalar(
        select(ExportLog.id)
        .where(
            ExportLog.organization_id == org_id,
            ExportLog.export_type == "transactions",
            ExportLog.status == "pending",
            ExportLog.exported_at >= _now() - QB_EXPORT_IN_PROGRESS_WINDOW,
        )
        .limit(1)
        .with_for_update()
    )
    if running is not None:
        await db.commit()
        return 0

    candidates: list[tuple[str, str, str]] = []
    purchases = await db.execute(
        select(PurchaseRequest.id, PurchaseRequest.request_number).where(
            PurchaseRequest.organization_id == org_id,
            PurchaseRequest.status == PurchaseRequestStatus.PAID,
            PurchaseRequest.paid_at >= post_from,
            PurchaseRequest.qb_exported_at.is_(None),
            _no_posting(PAYMENT_PURCHASE, PurchaseRequest.id, org_id),
        )
    )
    candidates += [(PAYMENT_PURCHASE, pid, num) for pid, num in purchases.all()]

    checks = await db.execute(
        select(CheckRequest.id, CheckRequest.request_number)
        .outerjoin(
            ExpenseReport,
            and_(
                ExpenseReport.id == CheckRequest.expense_report_id,
                ExpenseReport.organization_id == org_id,
            ),
        )
        .where(
            CheckRequest.organization_id == org_id,
            CheckRequest.status == CheckRequestStatus.ISSUED,
            CheckRequest.is_advance.is_(False),
            CheckRequest.check_date >= post_from,
            CheckRequest.qb_exported_at.is_(None),
            CheckRequest.qb_export_entry.is_(None),
            # A reimbursement check settling an advance is paid partly from
            # the advance, which one Purchase cannot express.
            or_(
                CheckRequest.expense_report_id.is_(None),
                _no_advance(ExpenseReport.advance_applied),
            ),
            _no_posting(PAYMENT_CHECK, CheckRequest.id, org_id),
        )
    )
    candidates += [(PAYMENT_CHECK, cid, num) for cid, num in checks.all()]

    reports = await db.execute(
        select(ExpenseReport.id, ExpenseReport.report_number).where(
            ExpenseReport.organization_id == org_id,
            ExpenseReport.status == ExpenseReportStatus.PAID,
            ExpenseReport.paid_at >= post_from,
            ExpenseReport.qb_exported_at.is_(None),
            _no_advance(ExpenseReport.advance_applied),
            # A report a reimbursement check paid posts as that check.
            ~exists().where(
                CheckRequest.organization_id == org_id,
                CheckRequest.expense_report_id == ExpenseReport.id,
                CheckRequest.status == CheckRequestStatus.ISSUED,
            ),
            _no_posting(PAYMENT_REPORT, ExpenseReport.id, org_id),
        )
    )
    candidates += [(PAYMENT_REPORT, rid, num) for rid, num in reports.all()]

    for payment_type, payment_id, number in candidates:
        db.add(
            QuickBooksPosting(
                organization_id=org_id,
                payment_type=payment_type,
                payment_id=payment_id,
                document_number=number,
                status=STATUS_QUEUED,
                request_id=_new_request_id(),
                attempts=0,
            )
        )
    await db.commit()
    return len(candidates)


async def _supersede_exported(db: AsyncSession, org_id: str) -> None:
    """A payment the CSV export stamped while its posting waited went out in
    the file; sending it too would record it twice."""
    for payment_type, model in (
        (PAYMENT_PURCHASE, PurchaseRequest),
        (PAYMENT_CHECK, CheckRequest),
        (PAYMENT_REPORT, ExpenseReport),
    ):
        stamped = select(model.id).where(
            model.organization_id == org_id, model.qb_exported_at.is_not(None)
        )
        await db.execute(
            update(QuickBooksPosting)
            .where(
                QuickBooksPosting.organization_id == org_id,
                QuickBooksPosting.payment_type == payment_type,
                QuickBooksPosting.status.in_((STATUS_QUEUED, STATUS_FAILED)),
                QuickBooksPosting.payment_id.in_(stamped),
            )
            .values(
                status=STATUS_SUPERSEDED,
                last_error="Sent to QuickBooks in a CSV export file instead",
                next_attempt_at=None,
            )
            .execution_options(synchronize_session=False)
        )
    await db.commit()


# ---------------------------------------------------------------------------
# Building a Purchase
# ---------------------------------------------------------------------------


@dataclass
class _Payment:
    vendor: str
    day: str
    document_number: str
    # (budget line id, amount), one per Purchase line.
    lines: list[tuple[Optional[str], Decimal]]


class _NotPostable(ValueError):
    """The payment cannot become a Purchase as it stands; the message says
    what to change. Nothing was sent."""


class _NoLongerDue(Exception):
    """The payment changed since it was queued (voided, sent in a file)."""


@dataclass
class _RunContext:
    org_id: str
    tz: Any
    accounts: Optional[dict[str, dict[str, Any]]] = None
    vendors: Optional[dict[str, dict[str, Any]]] = None
    category_accounts: Optional[dict[str, tuple[str, str, Optional[str]]]] = None
    budget_categories: dict[str, str] = field(default_factory=dict)


def _local_day(value: Optional[datetime], tz: Any) -> str:
    if value is None:
        raise _NotPostable("The payment has no date")
    aware = _aware(value)
    assert aware is not None
    return aware.astimezone(tz).strftime("%Y-%m-%d")


async def _load_payment(
    db: AsyncSession, posting: QuickBooksPosting, tz: Any
) -> _Payment:
    org_id = posting.organization_id
    if posting.payment_type == PAYMENT_PURCHASE:
        pr = (
            await db.execute(
                select(PurchaseRequest).where(
                    PurchaseRequest.id == posting.payment_id,
                    PurchaseRequest.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if pr is None or pr.status != PurchaseRequestStatus.PAID:
            raise _NoLongerDue("The purchase request is no longer paid")
        if pr.qb_exported_at is not None:
            raise _NoLongerDue("Sent in a CSV export file")
        vendor = (pr.vendor or "").strip()
        if not vendor:
            raise _NotPostable(
                f"{pr.request_number} has no vendor; add one, then post it again"
            )
        return _Payment(
            vendor,
            _local_day(pr.paid_at, tz),
            pr.request_number,
            [(pr.budget_id, pr.actual_amount or pr.estimated_amount)],
        )

    if posting.payment_type == PAYMENT_CHECK:
        cr = (
            await db.execute(
                select(CheckRequest).where(
                    CheckRequest.id == posting.payment_id,
                    CheckRequest.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if cr is None or cr.status != CheckRequestStatus.ISSUED:
            raise _NoLongerDue("The check is no longer issued")
        if cr.qb_exported_at is not None:
            raise _NoLongerDue("Sent in a CSV export file")
        lines: list[tuple[Optional[str], Decimal]] = [(cr.budget_id, cr.amount)]
        if cr.expense_report_id:
            report = (
                await db.execute(
                    select(ExpenseReport)
                    .options(selectinload(ExpenseReport.line_items))
                    .where(
                        ExpenseReport.id == cr.expense_report_id,
                        ExpenseReport.organization_id == org_id,
                    )
                )
            ).scalar_one_or_none()
            if report is None:
                raise _NotPostable(f"{cr.request_number}'s expense report is missing")
            if report.advance_applied:
                raise _NotPostable(
                    f"{cr.request_number} settles a cash advance; send it in the "
                    "CSV export"
                )
            lines = [
                (item.budget_id, item.amount)
                for item in sorted(report.line_items, key=lambda i: i.id)
            ]
        return _Payment(
            cr.payee_name.strip(),
            _local_day(cr.check_date, tz),
            cr.request_number,
            lines,
        )

    if posting.payment_type == PAYMENT_REPORT:
        er = (
            await db.execute(
                select(ExpenseReport)
                .options(
                    selectinload(ExpenseReport.line_items),
                    selectinload(ExpenseReport.submitter),
                )
                .where(
                    ExpenseReport.id == posting.payment_id,
                    ExpenseReport.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if er is None or er.status != ExpenseReportStatus.PAID:
            raise _NoLongerDue("The expense report is no longer paid")
        if er.qb_exported_at is not None:
            raise _NoLongerDue("Sent in a CSV export file")
        member = er.submitter
        vendor = (
            format_display_name(
                member.first_name, member.last_name, member.preferred_name
            )
            or member.username
            if member is not None
            else ""
        )
        if not vendor:
            raise _NotPostable(f"{er.report_number} has no member to pay")
        return _Payment(
            vendor,
            _local_day(er.paid_at, tz),
            er.report_number,
            [
                (item.budget_id, item.amount)
                for item in sorted(er.line_items, key=lambda i: i.id)
            ],
        )

    raise _NotPostable(f"Unknown payment type {posting.payment_type!r}")


async def _category_accounts(
    db: AsyncSession, ctx: _RunContext
) -> dict[str, tuple[str, str, Optional[str]]]:
    """Budget line id -> (expense account, paid-from account, problem), by
    the export's own resolver (CLAUDE.md pitfall #29)."""
    if ctx.category_accounts is not None:
        return ctx.category_accounts
    finance = FinanceService(db)
    categories = list(
        (
            await db.execute(
                select(BudgetCategory).where(
                    BudgetCategory.organization_id == ctx.org_id
                )
            )
        ).scalars()
    )
    mappings = await finance._export_mappings_by_category(ctx.org_id)
    # No uploaded chart: the live chart of accounts is checked instead.
    resolved = _resolve_category_accounts(categories, mappings, None)
    lines = await db.execute(
        select(Budget.id, Budget.category_id).where(
            Budget.organization_id == ctx.org_id
        )
    )
    names = {c.id: c.name for c in categories}
    out: dict[str, tuple[str, str, Optional[str]]] = {}
    for budget_id, category_id in lines.all():
        accounts = resolved.get(category_id)
        if accounts is None:
            continue
        ctx.budget_categories[budget_id] = names.get(category_id, "")
        problem = accounts.problem
        # The CSV-only problems: a formula-like name is an import concern.
        if problem == "unsafe_account_name":
            problem = None
        out[budget_id] = (accounts.account, accounts.offset, problem)
    ctx.category_accounts = out
    return out


_PROBLEM_TEXT = {
    "no_account": "has no QuickBooks account",
    "no_offset": "has no paid-from account",
    "duplicate_mappings": "has more than one mapping",
    "payable_receivable": "posts to Accounts Payable or Receivable",
}


def _account_index(accounts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Accounts by name, exactly as the export matches them. A subaccount is
    also found by its ``Parent:Child`` full name when QuickBooks returns one."""
    index: dict[str, dict[str, Any]] = {}
    for account in accounts:
        for key in ("FullyQualifiedName", "Name"):
            name = account.get(key)
            if isinstance(name, str) and name.strip():
                index.setdefault(name.strip(), account)
    return index


async def _purchase_body(
    db: AsyncSession,
    client: qbo.AccountingClient,
    ctx: _RunContext,
    payment: _Payment,
) -> tuple[dict[str, Any], str]:
    """The Purchase to create, and the paid-from account's QuickBooks id."""
    by_line = await _category_accounts(db, ctx)
    if not payment.lines:
        raise _NotPostable(f"{payment.document_number} has no lines")
    resolved: list[tuple[str, str, Decimal]] = []
    for budget_id, amount in payment.lines:
        if budget_id is None or budget_id not in by_line:
            raise _NotPostable(
                f"{payment.document_number} has a line with no budget line"
            )
        account, paid_from, problem = by_line[budget_id]
        if problem:
            category = ctx.budget_categories.get(budget_id, "Its category")
            raise _NotPostable(
                f"'{category}' {_PROBLEM_TEXT.get(problem, 'cannot be posted')}"
            )
        resolved.append((account, paid_from, _qb_amount(amount)))
    paid_from_names = {paid_from for _, paid_from, _ in resolved}
    if len(paid_from_names) != 1:
        raise _NotPostable(
            f"{payment.document_number}'s lines are paid from different accounts; "
            "a QuickBooks purchase is paid from one. Send it in the CSV export"
        )
    if ctx.accounts is None:
        ctx.accounts = _account_index(await client.list_accounts())
    paid_from_name = next(iter(paid_from_names))
    bank = ctx.accounts.get(paid_from_name)
    if bank is None:
        raise _NotPostable(f"QuickBooks has no account named '{paid_from_name}'")
    if bank.get("AccountType") != BANK_ACCOUNT_TYPE:
        raise _NotPostable(
            f"'{paid_from_name}' is not a Bank account in QuickBooks; payments "
            "post live only from bank accounts. Send this one in the CSV export"
        )
    lines: list[dict[str, Any]] = []
    for account, _, amount in resolved:
        target = ctx.accounts.get(account)
        if target is None:
            raise _NotPostable(f"QuickBooks has no account named '{account}'")
        if target.get("Active") is False:
            raise _NotPostable(f"'{account}' is inactive in QuickBooks")
        lines.append(
            {
                "Amount": float(amount),
                "DetailType": "AccountBasedExpenseLineDetail",
                "AccountBasedExpenseLineDetail": {
                    "AccountRef": {"value": str(target["Id"])}
                },
            }
        )
    body = {
        "PaymentType": "Cash",
        "AccountRef": {"value": str(bank["Id"])},
        "TxnDate": payment.day,
        "DocNumber": payment.document_number,
        "Line": lines,
    }
    return body, str(bank["Id"])


async def _vendor_id(
    client: qbo.AccountingClient,
    ctx: _RunContext,
    name: str,
    request_id: str,
) -> str:
    """Find the vendor by display name, or create it."""
    if ctx.vendors is None:
        ctx.vendors = {}
        for vendor in await client.list_vendors():
            display = vendor.get("DisplayName")
            if isinstance(display, str) and display.strip():
                ctx.vendors.setdefault(display.strip().casefold(), vendor)
    key = name.strip().casefold()
    found = ctx.vendors.get(key)
    if found is not None:
        if found.get("Active") is False:
            raise _NotPostable(
                f"The vendor '{name}' is inactive in QuickBooks; make it active, "
                "then post again"
            )
        return str(found["Id"])
    try:
        created = await client.create_vendor(name.strip(), f"{request_id}-v")
    except qbo.QuickBooksRejected as exc:
        if exc.code == "6240":
            raise _NotPostable(
                f"QuickBooks already has a customer or employee named '{name}'; "
                "a vendor needs a name of its own"
            ) from exc
        raise
    ctx.vendors[key] = created
    return str(created["Id"])


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------


async def _acquire_lease(db: AsyncSession, connection_id: str) -> bool:
    now = _now()
    result = await db.execute(
        update(QuickBooksConnection)
        .where(
            QuickBooksConnection.id == connection_id,
            or_(
                QuickBooksConnection.sync_lease_until.is_(None),
                QuickBooksConnection.sync_lease_until < now,
            ),
        )
        .values(sync_lease_until=now + SYNC_LEASE)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return bool(getattr(result, "rowcount", 0))


async def _release_lease(db: AsyncSession, org_id: str, error: Optional[str]) -> None:
    await db.execute(
        update(QuickBooksConnection)
        .where(QuickBooksConnection.organization_id == org_id)
        .values(sync_lease_until=None, last_sync_at=_now(), last_error=error)
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def _access_token(
    db: AsyncSession,
    http: httpx.AsyncClient,
    credentials: qbo.Credentials,
    org_id: str,
    *,
    force: bool = False,
) -> str:
    connection = await load_connection(db, org_id, lock=True)
    if connection is None or connection.status != CONNECTED:
        await db.commit()
        raise qbo.QuickBooksAuthError("QuickBooks is not connected")
    expires = _aware(connection.access_token_expires_at)
    token = connection.access_token
    if (
        token
        and not force
        and expires is not None
        and expires - _now() > REFRESH_MARGIN
    ):
        await db.commit()
        return token
    refresh = connection.refresh_token
    await db.commit()
    if not refresh:
        raise qbo.QuickBooksAuthError("QuickBooks is not connected")
    tokens = await qbo.refresh_tokens(http, credentials, refresh)
    connection = await load_connection(db, org_id, lock=True)
    if connection is None:
        raise qbo.QuickBooksAuthError("QuickBooks is not connected")
    connection.access_token = tokens.access_token
    connection.refresh_token = tokens.refresh_token
    connection.access_token_expires_at = tokens.access_expires_at
    connection.refresh_token_expires_at = tokens.refresh_expires_at
    await db.commit()
    return tokens.access_token


async def _keep_alive(
    db: AsyncSession,
    http: httpx.AsyncClient,
    credentials: qbo.Credentials,
    org_id: str,
) -> Optional[str]:
    """Renew the grant when its refresh token is near its expiry."""
    connection = await load_connection(db, org_id)
    expires = _aware(connection.refresh_token_expires_at) if connection else None
    await db.commit()
    if expires is None or expires - _now() > REFRESH_TOKEN_RENEW_MARGIN:
        return None
    try:
        await _access_token(db, http, credentials, org_id, force=True)
    except qbo.QuickBooksAuthError as exc:
        await _mark_reconnect(db, org_id, str(exc))
        return str(exc)
    except qbo.QuickBooksError as exc:
        return str(exc)
    return None


async def _mark_reconnect(db: AsyncSession, org_id: str, message: str) -> None:
    await db.execute(
        update(QuickBooksConnection)
        .where(
            QuickBooksConnection.organization_id == org_id,
            QuickBooksConnection.status == CONNECTED,
        )
        .values(status=RECONNECT_REQUIRED, last_error=_short(message))
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def _record(
    db: AsyncSession,
    posting_id: str,
    org_id: str,
    **values: Any,
) -> None:
    await db.execute(
        update(QuickBooksPosting)
        .where(
            QuickBooksPosting.id == posting_id,
            QuickBooksPosting.organization_id == org_id,
        )
        .values(**values)
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def run_for_organization(
    db: AsyncSession,
    org_id: str,
    *,
    http: Optional[httpx.AsyncClient] = None,
) -> dict[str, Any]:
    """Queue and send this department's due payments. Safe to run twice:
    the lease keeps two runs apart, and each payment posts once whatever
    happens to a run (see the module docstring)."""
    credentials = qbo.configured_credentials()
    if credentials is None:
        return {"skipped": "not_configured"}
    connection = await load_connection(db, org_id)
    if connection is None or connection.status != CONNECTED:
        return {"skipped": "not_connected"}
    if connection.environment != credentials.environment:
        await _mark_reconnect(
            db,
            org_id,
            "QBO_ENVIRONMENT changed since this connection was made; connect again",
        )
        return {"skipped": "environment_changed"}
    post_from = _aware(connection.post_from) or _now()
    if not await _acquire_lease(db, connection.id):
        return {"skipped": "busy"}

    owns_http = http is None
    client_http = http or httpx.AsyncClient()
    counts = {"queued": 0, "posted": 0, "failed": 0, "retrying": 0}
    error: Optional[str] = None
    try:
        counts["queued"] = await enqueue(db, org_id, post_from)
        await _supersede_exported(db, org_id)
        error = await _send_due(db, client_http, credentials, org_id, counts)
    except Exception:
        await db.rollback()
        logger.opt(exception=True).warning("QuickBooks sync failed for org {}", org_id)
        error = "The last run stopped with an unexpected error; it will run again"
        raise
    finally:
        try:
            await _release_lease(db, org_id, error)
        finally:
            if owns_http:
                await client_http.aclose()
    return counts


async def _send_due(
    db: AsyncSession,
    http: httpx.AsyncClient,
    credentials: qbo.Credentials,
    org_id: str,
    counts: dict[str, int],
) -> Optional[str]:
    """Send the postings that are due; return a connection-level error."""
    now = _now()
    due = list(
        (
            await db.execute(
                select(QuickBooksPosting)
                .where(
                    QuickBooksPosting.organization_id == org_id,
                    QuickBooksPosting.status.in_((STATUS_QUEUED, STATUS_RETRYING)),
                    or_(
                        QuickBooksPosting.next_attempt_at.is_(None),
                        QuickBooksPosting.next_attempt_at <= now,
                    ),
                )
                .order_by(QuickBooksPosting.created_at, QuickBooksPosting.id)
                .limit(BATCH_LIMIT)
            )
        ).scalars()
    )
    # Plain values: a commit expires the instances.
    work = [
        (p.id, p.payment_type, p.payment_id, p.request_id, p.attempts, p.status)
        for p in due
    ]
    await db.commit()
    if not work:
        return await _keep_alive(db, http, credentials, org_id)

    connection = await load_connection(db, org_id)
    realm = connection.realm_id if connection else None
    environment = connection.environment if connection else None
    if not realm or not environment:
        return "QuickBooks is not connected"
    try:
        token = await _access_token(db, http, credentials, org_id)
    except qbo.QuickBooksAuthError as exc:
        await _mark_reconnect(db, org_id, str(exc))
        return str(exc)
    except qbo.QuickBooksError as exc:
        return str(exc)

    ctx = _RunContext(org_id=org_id, tz=await resolve_scheduling_timezone(db, org_id))
    refreshed = False
    for posting_id, payment_type, payment_id, request_id, attempts, status in work:
        posting = (
            await db.execute(
                select(QuickBooksPosting).where(
                    QuickBooksPosting.id == posting_id,
                    QuickBooksPosting.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if posting is None or posting.status not in (STATUS_QUEUED, STATUS_RETRYING):
            await db.commit()
            continue
        try:
            payment = await _load_payment(db, posting, ctx.tz)
        except _NoLongerDue as exc:
            await _record(
                db,
                posting_id,
                org_id,
                status=STATUS_SUPERSEDED,
                last_error=_short(str(exc)),
                next_attempt_at=None,
            )
            continue
        except _NotPostable as exc:
            counts["failed"] += 1
            await _record(
                db,
                posting_id,
                org_id,
                status=STATUS_FAILED,
                last_error=_short(str(exc)),
                next_attempt_at=None,
            )
            continue
        posting.vendor_name = payment.vendor[:300]
        posting.amount = sum((amount for _, amount in payment.lines), Decimal("0"))
        await db.commit()

        while True:
            client = qbo.AccountingClient(
                http, environment=environment, realm_id=realm, access_token=token
            )
            try:
                body, _ = await _purchase_body(db, client, ctx, payment)
                vendor_id = await _vendor_id(client, ctx, payment.vendor, request_id)
                body["EntityRef"] = {"value": vendor_id, "type": "Vendor"}
                created = await client.create_purchase(body, request_id)
            except qbo.QuickBooksAuthError as exc:
                if refreshed:
                    await _mark_reconnect(db, org_id, str(exc))
                    return str(exc)
                refreshed = True
                try:
                    token = await _access_token(
                        db, http, credentials, org_id, force=True
                    )
                except qbo.QuickBooksAuthError as refresh_exc:
                    await _mark_reconnect(db, org_id, str(refresh_exc))
                    return str(refresh_exc)
                except qbo.QuickBooksError as refresh_exc:
                    return str(refresh_exc)
                continue
            except qbo.QuickBooksRateLimited as exc:
                counts["retrying"] += 1
                await _record(
                    db,
                    posting_id,
                    org_id,
                    status=STATUS_RETRYING,
                    attempts=attempts + 1,
                    next_attempt_at=_now() + qbo.RATE_LIMIT_WAIT,
                    last_error=_short(str(exc)),
                )
                # Anything else sent now would be throttled too.
                return None
            except qbo.QuickBooksTransient as exc:
                counts["retrying"] += 1
                await _record(
                    db,
                    posting_id,
                    org_id,
                    status=STATUS_RETRYING,
                    attempts=attempts + 1,
                    next_attempt_at=_now() + retry_delay(attempts + 1),
                    last_error=_short(str(exc)),
                )
                break
            except (qbo.QuickBooksRejected, _NotPostable) as exc:
                # Refused, so nothing was created: a later attempt is a new
                # request and gets a new id. A resend under this one could be
                # answered with this refusal again.
                counts["failed"] += 1
                await _record(
                    db,
                    posting_id,
                    org_id,
                    status=STATUS_FAILED,
                    attempts=attempts + 1,
                    request_id=_new_request_id(),
                    next_attempt_at=None,
                    last_error=_short(str(exc)),
                )
                break
            counts["posted"] += 1
            await _record(
                db,
                posting_id,
                org_id,
                status=STATUS_POSTED,
                attempts=attempts + 1,
                realm_id=realm,
                qb_purchase_id=str(created["Id"]),
                qb_vendor_id=vendor_id,
                posted_at=_now(),
                next_attempt_at=None,
                last_error=None,
            )
            break
    return None


async def retry_posting(db: AsyncSession, org_id: str, posting_id: str) -> None:
    """Send a refused posting again, under a new request id."""
    posting = (
        await db.execute(
            select(QuickBooksPosting)
            .where(
                QuickBooksPosting.id == posting_id,
                QuickBooksPosting.organization_id == org_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if posting is None:
        raise LookupError("Posting not found")
    if posting.status != STATUS_FAILED:
        raise ValueError("Only a posting QuickBooks refused can be sent again")
    posting.status = STATUS_QUEUED
    posting.request_id = _new_request_id()
    posting.next_attempt_at = None
    await db.commit()


async def list_postings(
    db: AsyncSession,
    org_id: str,
    *,
    status: Optional[str] = None,
    payment_type: Optional[str] = None,
    payment_id: Optional[str] = None,
    limit: int = 200,
) -> list[QuickBooksPosting]:
    statement = select(QuickBooksPosting).where(
        QuickBooksPosting.organization_id == org_id
    )
    if status:
        statement = statement.where(QuickBooksPosting.status == status)
    if payment_type:
        statement = statement.where(QuickBooksPosting.payment_type == payment_type)
    if payment_id:
        statement = statement.where(QuickBooksPosting.payment_id == payment_id)
    statement = statement.order_by(
        QuickBooksPosting.created_at.desc(), QuickBooksPosting.id
    ).limit(limit)
    return list((await db.execute(statement)).scalars())


__all__ = [
    "LIVE_POSTING_STATUSES",
    "QuickBooksConnectError",
    "begin_connect",
    "complete_connect",
    "connection_status",
    "disconnect",
    "enqueue",
    "list_postings",
    "load_connection",
    "retry_posting",
    "run_for_organization",
    "set_post_from",
]
