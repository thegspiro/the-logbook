"""Severe-weather alerts from the department's NWS Weather Alerts integration.

Owner decisions 2026-10-29 (KNOWN_LIMITATIONS, "Integrations — Weather Alerts
and Generic Webhooks Do Nothing After Their Test"):

- the zone is polled every 15 minutes (``run_weather_alert_poll``);
- only Severe and Extreme alerts count, which is warnings such as tornado,
  severe thunderstorm and flash flood rather than advisories and statements;
- each department chooses how members hear: a dashboard banner while the alert
  is active, a bell notice when it is issued, an email when it is issued, or any
  mix (``NWSWeatherConfig.notify_*``).

A member is told about each alert once. The ``(organization_id, nws_id)``
unique key on ``weather_alerts`` makes a later poll of the same alert a no-op,
and the row is committed before anyone is notified: a crash between the two
loses that alert's notice rather than repeating it to the whole department on
the next poll (CLAUDE.md pitfall #36, at most once). The banner reads the
stored rows, so it still shows the alert either way.
"""

import html
from datetime import datetime, timezone
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import Integration, WeatherAlert
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.services.integration_health import record_integration_run

INTEGRATION_TYPE = "nws-weather"
QUALIFYING_SEVERITIES = frozenset({"Severe", "Extreme"})
BELL_CATEGORY = "weather_alert"


def _parse_time(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def qualifies(alert: dict[str, Any]) -> bool:
    """A real Severe or Extreme alert with an id to key it on."""
    status = alert.get("status") or "Actual"
    return (
        bool(alert.get("id"))
        and status == "Actual"
        and alert.get("severity") in QUALIFYING_SEVERITIES
    )


async def weather_integration(
    db: AsyncSession, organization_id: str
) -> Optional[Integration]:
    """The department's enabled NWS Weather Alerts integration, if any."""
    return (
        await db.execute(
            select(Integration).where(
                Integration.organization_id == str(organization_id),
                Integration.integration_type == INTEGRATION_TYPE,
                Integration.enabled.is_(True),
            )
        )
    ).scalar_one_or_none()


def channels(integration: Integration) -> dict[str, bool]:
    """How members hear, as the department chose; defaults match the schema."""
    config = integration.config or {}
    return {
        "banner": config.get("notify_banner", True) is not False,
        "bell": config.get("notify_bell", True) is not False,
        "email": config.get("notify_email", False) is True,
    }


async def active_alerts(
    db: AsyncSession, organization_id: str, now: Optional[datetime] = None
) -> list[WeatherAlert]:
    """Stored alerts that have neither ended nor expired, most severe first."""
    now = now or datetime.now(timezone.utc)
    rows = (
        (
            await db.execute(
                select(WeatherAlert)
                .where(
                    WeatherAlert.organization_id == str(organization_id),
                    WeatherAlert.ended_at.is_(None),
                )
                .order_by(WeatherAlert.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    def still_on(row: WeatherAlert) -> bool:
        expires = row.expires
        if expires is not None and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        return expires is None or expires > now

    live = [row for row in rows if still_on(row)]
    return sorted(live, key=lambda row: row.severity != "Extreme")


async def poll_zone(
    db: AsyncSession,
    organization: Organization,
    alerts: list[dict[str, Any]],
    now: Optional[datetime] = None,
) -> list[WeatherAlert]:
    """Record this poll's qualifying ``alerts``; return the ones first seen now.

    An alert that has dropped out of the zone's active list before it expired
    (NWS cancelled or replaced it) is marked ended; one that comes back is
    reopened without being announced again. Commits.
    """
    now = now or datetime.now(timezone.utc)
    org_id = str(organization.id)
    current = {a["id"]: a for a in alerts if qualifies(a)}

    stored = {
        row.nws_id: row
        for row in (
            await db.execute(
                select(WeatherAlert).where(WeatherAlert.organization_id == org_id)
            )
        )
        .scalars()
        .all()
    }

    fresh: list[WeatherAlert] = []
    for nws_id, alert in current.items():
        row = stored.get(nws_id)
        if row is not None:
            row.ended_at = None
            continue
        row = WeatherAlert(
            organization_id=org_id,
            nws_id=nws_id[:255],
            event=(alert.get("event") or "Weather alert")[:255],
            severity=alert.get("severity") or "",
            urgency=(alert.get("urgency") or None),
            headline=(alert.get("headline") or "")[:500] or None,
            description=alert.get("description") or None,
            instruction=alert.get("instruction") or None,
            area_desc=alert.get("area_desc") or None,
            onset=_parse_time(alert.get("onset")),
            expires=_parse_time(alert.get("expires")),
        )
        db.add(row)
        fresh.append(row)

    for nws_id, row in stored.items():
        if nws_id not in current and row.ended_at is None:
            row.ended_at = now

    try:
        await db.commit()
    except IntegrityError:
        # Another worker recorded the same alert first; it announces it.
        await db.rollback()
        logger.info("Weather poll for org {} lost a race; skipping notices", org_id)
        return []
    return fresh


async def _members(db: AsyncSession, organization_id: str) -> list[User]:
    return list(
        (
            await db.execute(
                select(User).where(
                    User.organization_id == str(organization_id),
                    User.status.in_(ACTIVE_ACCOUNT_STATUSES),
                    User.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )


def _summary(alert: WeatherAlert) -> str:
    return alert.headline or f"{alert.event} for {alert.area_desc or 'your area'}"


async def announce(
    db: AsyncSession,
    organization: Organization,
    alerts: list[WeatherAlert],
    chosen: dict[str, bool],
) -> int:
    """Bell and email each new alert to every current member, as chosen.

    Returns how many emails were accepted. Never raises: the alerts are already
    recorded, and the banner shows them whatever happens here.
    """
    if not alerts or not (chosen["bell"] or chosen["email"]):
        return 0
    try:
        members = await _members(db, str(organization.id))
    except Exception as exc:
        logger.warning(
            "Weather alert recipients for {} failed: {}", organization.id, exc
        )
        return 0

    if chosen["bell"]:
        from app.services.officer_alert_copies import add_in_app_copies

        try:
            for alert in alerts:
                await add_in_app_copies(
                    db,
                    organization_id=str(organization.id),
                    recipient_ids=[str(m.id) for m in members],
                    category=BELL_CATEGORY,
                    subject=f"{alert.event} — {alert.severity}",
                    message=_summary(alert),
                    action_url="/dashboard",
                    metadata={"weather_alert_id": str(alert.id)},
                )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.warning("Weather alert bell for {} failed: {}", organization.id, exc)

    if not chosen["email"]:
        return 0
    return await _email(db, organization, alerts, members)


async def _email(
    db: AsyncSession,
    organization: Organization,
    alerts: list[WeatherAlert],
    members: list[User],
) -> int:
    from app.services.email_policy import (
        EmailKind,
        department_required_kinds,
        recipients_for,
    )
    from app.services.email_service import EmailService, wrap_email_body
    from app.utils.org_timezone import format_in_org_timezone

    recipients = recipients_for(
        [m for m in members if m.email],
        EmailKind.WEATHER_ALERTS,
        department_required_kinds(organization),
    )
    if not recipients:
        return 0
    accepted = 0
    service = EmailService(organization)
    for alert in alerts:
        parts = [f"<p><strong>{html.escape(_summary(alert))}</strong></p>"]
        if alert.area_desc:
            parts.append(f"<p>Area: {html.escape(alert.area_desc)}</p>")
        if alert.expires:
            until = format_in_org_timezone(
                alert.expires, organization, "%B %d, %Y %I:%M %p"
            )
            parts.append(f"<p>Until {html.escape(until)}</p>")
        if alert.instruction:
            parts.append(
                '<p style="white-space:pre-line;">'
                f"{html.escape(alert.instruction)}</p>"
            )
        parts.append(
            "<p>From the National Weather Service. Always follow official "
            "instructions.</p>"
        )
        body = wrap_email_body(
            organization, f"{alert.event} — {alert.severity}", "".join(parts)
        )
        subject = f"Weather alert: {alert.event}"[:200]
        # One message per member, so the department's addresses are not
        # disclosed to one another.
        for member in recipients:
            try:
                sent, _ = await service.send_email(
                    to_emails=[member.email],
                    subject=subject,
                    html_body=body,
                    text_body=_summary(alert),
                    db=db,
                    template_type="weather_alert",
                )
                accepted += sent
            except Exception as exc:
                logger.warning(
                    "Weather alert email to member {} failed: {}",
                    member.id,
                    type(exc).__name__,
                )
    return accepted


async def poll_department(db: AsyncSession, organization: Organization) -> int:
    """Poll one department's zone and announce new alerts. Returns how many."""
    from app.services.integration_services.weather_service import (
        fetch_active_alerts,
    )

    integration = await weather_integration(db, str(organization.id))
    if integration is None:
        return 0
    zone_id = (integration.config or {}).get("zone_id")
    if not zone_id:
        return 0
    chosen = channels(integration)
    try:
        alerts = await fetch_active_alerts(zone_id)
    except Exception as exc:
        await record_integration_run(
            db,
            integration,
            operation="weather_poll",
            trigger="schedule",
            success=False,
            error=exc,
        )
        await db.commit()
        return 0
    await record_integration_run(
        db, integration, operation="weather_poll", trigger="schedule", success=True
    )
    fresh = await poll_zone(db, organization, alerts)
    await announce(db, organization, fresh, chosen)
    return len(fresh)
