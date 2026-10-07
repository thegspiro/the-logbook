"""
External Training Sync Service

Business logic for syncing training records from external providers
like Vector Solutions, Target Solutions, Lexipol, etc.
"""

import csv
import html
import io
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
from cryptography.fernet import InvalidToken
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import install_httpx_url_redaction, redact_url_secrets
from app.core.security import decrypt_data
from app.models.training import (
    ExternalCategoryMapping,
    ExternalProviderType,
    ExternalTrainingImport,
    ExternalTrainingProvider,
    ExternalTrainingSyncLog,
    ExternalUserMapping,
    SyncStatus,
    TrainingCategory,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import User
from app.services.external_course_mapping import (
    course_category_id,
    find_or_create_course_mapping,
    mapped_course_id,
    notify_new_course_matches,
)
from app.utils.org_timezone import resolve_scheduling_timezone
from app.utils.ssrf_transport import SSRFSafeAsyncTransport, join_endpoint

# Target Solutions puts credentials in the request URL; make sure httpx's
# request log is redacted even in a worker that never ran setup_logging().
install_httpx_url_redaction()

# Scheduled syncs come in two sizes. The frequent pull (every
# sync_interval_hours) asks only for completions since the last sync, so a
# finished class shows up under Imports within the hour. Once a day, at the
# provider's review time, a review re-requests a wider window: Target
# Solutions lets a completion be recorded for a past date, which a pull that
# only looks forward from the last sync never sees. Re-fetched rows update in
# place by Transcript ID, so the overlap never duplicates.
REVIEW_SYNC_TYPE = "review"
# A report an officer uploaded by hand, recorded in the same sync history.
UPLOAD_SYNC_TYPE = "upload"
TS_ASSIGNMENT_TYPE_COLUMN = "Assignment Type"
TS_ADMIN_ASSIGNMENT_TYPE = "admin"
REVIEW_LOOKBACK_DAYS = 30
QUICK_PULL_MIN_LOOKBACK_DAYS = 1
DEFAULT_TS_REVIEW_TIME = time(2, 0)

# Providers whose synced completions become training records without an
# officer's review, once the member is matched.
# Target Solutions only, for now: it is the one provider proven against a
# real department's data. Each other provider joins after its own review
# against real records (owner decision, 2026-10-07).
AUTO_CREDIT_PROVIDERS = frozenset({ExternalProviderType.TARGET_SOLUTIONS})


def _is_blank(value: Any) -> bool:
    return value is None or str(value).strip() in ("", "None")


# Providers whose user id is the department's own employee number, so a member
# can be matched on membership_number when the email does not match. Target
# Solutions reports it as "Employee ID".
MEMBERSHIP_NUMBER_PROVIDERS = frozenset({ExternalProviderType.TARGET_SOLUTIONS})


def parse_review_time(value: Any) -> Optional[time]:
    """Stored ``config.review_time`` ("HH:MM") as a ``time``, or None.

    ``config`` is unvalidated JSON once stored, so anything malformed is
    treated as unset rather than raising inside the scheduler loop.
    """
    if not isinstance(value, str):
        return None
    try:
        hour, minute = value.strip().split(":")
        return time(int(hour), int(minute))
    except (ValueError, TypeError):
        return None


def credited_hours(import_record: ExternalTrainingImport) -> float:
    """Hours a staged completion credits to the member's training record.

    The provider's credit hours win: for Target Solutions that is the
    report's "Duration (hours)", the hours the course is accredited for, and
    never "Time Spent In Course", which counts however long the member had it
    open. Minutes are the fallback for providers that report only a duration.
    Every import path uses this, so a manual import credits what the
    automatic one would.
    """
    credit = import_record.credit_hours
    if credit and credit > 0:
        return round(float(credit), 2)
    return round(float(import_record.duration_minutes or 0) / 60.0, 2)


def review_time_for(provider: ExternalTrainingProvider) -> Optional[time]:
    """The provider's daily review time; Target Solutions always has one."""
    configured = parse_review_time((provider.config or {}).get("review_time"))
    if configured is not None:
        return configured
    if provider.provider_type == ExternalProviderType.TARGET_SOLUTIONS:
        return DEFAULT_TS_REVIEW_TIME
    return None


def next_review_slot(review_time: time, tz: ZoneInfo, after: datetime) -> datetime:
    """The first ``review_time`` (wall clock in ``tz``) strictly after ``after``.

    Built per calendar date so a DST change moves the UTC instant, not the
    local time the department chose. Returned in UTC.
    """
    local_after = after.astimezone(tz)
    for day_offset in range(2):
        candidate = datetime.combine(
            local_after.date() + timedelta(days=day_offset), review_time, tzinfo=tz
        )
        if candidate > local_after:
            return candidate.astimezone(timezone.utc)
    raise AssertionError("a daily time always recurs within two days")


def latest_review_slot(review_time: time, tz: ZoneInfo, now: datetime) -> datetime:
    """The most recent ``review_time`` at or before ``now``, in UTC."""
    local_now = now.astimezone(tz)
    for day_offset in range(2):
        candidate = datetime.combine(
            local_now.date() - timedelta(days=day_offset), review_time, tzinfo=tz
        )
        if candidate <= local_now:
            return candidate.astimezone(timezone.utc)
    raise AssertionError("a daily time always recurs within two days")


def compute_next_sync_at(
    provider: ExternalTrainingProvider, tz: ZoneInfo, now: datetime
) -> datetime:
    """The next frequent pull, or the next daily review if that comes first."""
    quick = now + timedelta(hours=provider.sync_interval_hours or 24)
    review_time = review_time_for(provider)
    if review_time is None:
        return quick
    return min(quick, next_review_slot(review_time, tz, now))


class ExternalTrainingSyncService:
    """Service for syncing training records from external providers"""

    def __init__(self, db: AsyncSession):
        self.db = db
        # Course mappings this run created, for the officer email sent once
        # the run commits.
        self.new_course_mapping_ids: List[str] = []
        self.http_client = httpx.AsyncClient(
            timeout=30.0,
            transport=SSRFSafeAsyncTransport(),
            follow_redirects=False,
            trust_env=False,
        )

    async def close(self):
        """Close HTTP client connections"""
        await self.http_client.aclose()

    @staticmethod
    def _validate_provider_url(provider: ExternalTrainingProvider) -> None:
        """Require a base URL; the transport validates each composed URL."""
        if not provider.api_base_url:
            raise ValueError("Provider API base URL is not configured")

    # ==========================================
    # Connection Testing
    # ==========================================

    async def test_connection(
        self, provider: ExternalTrainingProvider
    ) -> Tuple[bool, str]:
        """
        Test connection to an external training provider.

        Returns:
            Tuple of (success, message)
        """
        try:
            self._validate_provider_url(provider)
            if provider.provider_type == ExternalProviderType.VECTOR_SOLUTIONS:
                return await self._test_vector_solutions_connection(provider)
            elif provider.provider_type == ExternalProviderType.TARGET_SOLUTIONS:
                return await self._test_target_solutions_connection(provider)
            elif provider.provider_type == ExternalProviderType.LEXIPOL:
                return await self._test_lexipol_connection(provider)
            elif provider.provider_type == ExternalProviderType.I_AM_RESPONDING:
                return await self._test_iar_connection(provider)
            elif provider.provider_type == ExternalProviderType.CUSTOM_API:
                return await self._test_custom_api_connection(provider)
            else:
                return False, f"Unsupported provider type: {provider.provider_type}"
        except httpx.TimeoutException:
            return False, "Connection timed out"
        except httpx.ConnectError as e:
            return False, f"Failed to connect: {redact_url_secrets(str(e))}"
        except Exception as e:
            logger.exception(f"Error testing connection for provider {provider.id}")
            return False, f"Connection test failed: {redact_url_secrets(str(e))}"

    async def _test_vector_solutions_connection(
        self, provider: ExternalTrainingProvider
    ) -> Tuple[bool, str]:
        """
        Test Vector Solutions (TargetSolutions) API connection.

        Vector Solutions API uses:
        - Base URL: e.g. https://app.targetsolutions.com/v1
        - Auth: AccessToken header with customer-specific token
        - Site-scoped endpoints: /v1/sites (list sites to verify access)
        - config.site_id: required for data endpoints
        """
        if not provider.api_base_url or not provider.api_key:
            return False, "API base URL and AccessToken are required"

        headers = self._get_auth_headers(provider)
        config = provider.config or {}

        # GET /sites is the simplest authenticated endpoint to verify the token
        test_url = join_endpoint(provider.api_base_url, "/sites")

        response = await self.http_client.get(test_url, headers=headers)

        if response.status_code == 200:
            data = response.json()
            sites = (
                data
                if isinstance(data, list)
                else data.get("sites", data.get("data", []))
            )
            site_id = config.get("site_id")

            if site_id:
                # Verify the configured site_id is accessible
                site_ids = (
                    [str(s.get("id", s.get("siteId", ""))) for s in sites]
                    if isinstance(sites, list)
                    else []
                )
                if site_ids and site_id not in site_ids:
                    return (
                        False,
                        f"Connection successful but site_id '{site_id}' not found in accessible sites: {', '.join(site_ids)}",
                    )
                return True, f"Connection successful - site '{site_id}' verified"
            else:
                # No site_id configured yet - report available sites
                site_count = len(sites) if isinstance(sites, list) else 0
                return (
                    True,
                    f"Connection successful - {site_count} site(s) accessible. Configure site_id in provider settings to enable sync.",
                )
        elif response.status_code == 401:
            return False, "Authentication failed - check your AccessToken"
        elif response.status_code == 403:
            return (
                False,
                "Access denied - your token may not have sufficient permissions",
            )
        else:
            return False, f"Unexpected response: {response.status_code}"

    async def _test_lexipol_connection(
        self, provider: ExternalTrainingProvider
    ) -> Tuple[bool, str]:
        """Test Lexipol API connection"""
        if not provider.api_base_url:
            return False, "API base URL is required"

        headers = self._get_auth_headers(provider)
        test_url = join_endpoint(provider.api_base_url, "/api/v1/status")

        response = await self.http_client.get(test_url, headers=headers)

        if response.status_code == 200:
            return True, "Connection successful"
        elif response.status_code == 401:
            return False, "Authentication failed"
        else:
            return False, f"Unexpected response: {response.status_code}"

    async def _test_iar_connection(
        self, provider: ExternalTrainingProvider
    ) -> Tuple[bool, str]:
        """Test I Am Responding API connection"""
        if not provider.api_base_url or not provider.api_key:
            return False, "API base URL and API key are required"

        headers = self._get_auth_headers(provider)
        test_url = join_endpoint(provider.api_base_url, "/api/v1/account")

        response = await self.http_client.get(test_url, headers=headers)

        if response.status_code == 200:
            return True, "Connection successful"
        elif response.status_code == 401:
            return False, "Authentication failed - check API key"
        else:
            return False, f"Unexpected response: {response.status_code}"

    async def _test_custom_api_connection(
        self, provider: ExternalTrainingProvider
    ) -> Tuple[bool, str]:
        """Test custom API connection using configured test endpoint"""
        if not provider.api_base_url:
            return False, "API base URL is required"

        config = provider.config or {}
        test_endpoint = config.get("test_endpoint", "/health")

        headers = self._get_auth_headers(provider)
        test_url = join_endpoint(provider.api_base_url, test_endpoint)

        response = await self.http_client.get(test_url, headers=headers)

        if response.status_code == 200:
            return True, "Connection successful"
        elif response.status_code == 401:
            return False, "Authentication failed"
        else:
            return False, f"Unexpected response: {response.status_code}"

    def _decrypt_field(self, value: Optional[str]) -> Optional[str]:
        """Decrypt an encrypted credential field, returning None if empty."""
        if not value:
            return None
        try:
            return decrypt_data(value)
        except InvalidToken:
            # TR-6: fail closed. Only a legacy pre-encryption plaintext value
            # (InvalidToken) is returned as-is for backward compatibility. A
            # genuine GCM authentication failure (InvalidTag — tampered
            # ciphertext or the wrong key) is NOT swallowed: it propagates
            # rather than handing an unverified value to an external provider as
            # a live API credential. This matches the EncryptedText contract.
            return value

    def _get_auth_headers(self, provider: ExternalTrainingProvider) -> Dict[str, str]:
        """Get authentication headers based on provider type and auth type"""
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

        # Decrypt credentials for use in headers
        api_key = self._decrypt_field(provider.api_key)
        api_secret = self._decrypt_field(provider.api_secret)

        # Vector Solutions uses a custom AccessToken header. (TargetSolutions'
        # Training Records API authenticates in the query string instead and
        # does not use these headers — see _target_solutions_report.)
        if provider.provider_type == ExternalProviderType.VECTOR_SOLUTIONS:
            if api_key:
                headers["AccessToken"] = api_key
        elif provider.auth_type == "api_key":
            if api_key:
                headers["X-API-Key"] = api_key
                headers["Authorization"] = f"Bearer {api_key}"
        elif provider.auth_type == "basic":
            import base64

            if api_key and api_secret:
                credentials = base64.b64encode(
                    f"{api_key}:{api_secret}".encode()
                ).decode()
                headers["Authorization"] = f"Basic {credentials}"
        elif provider.auth_type == "oauth2":
            # OAuth2 would require token refresh logic
            if api_key:  # Using api_key to store access token
                headers["Authorization"] = f"Bearer {api_key}"

        # Add any custom headers from config
        if provider.config and "headers" in provider.config:
            headers.update(provider.config["headers"])

        return headers

    # ==========================================
    # Sync Operations
    # ==========================================

    async def sync_training_records(
        self,
        provider: ExternalTrainingProvider,
        sync_type: str = "incremental",
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        user_id: Optional[str] = None,  # Who initiated the sync
    ) -> ExternalTrainingSyncLog:
        """
        Sync training records from an external provider.

        Args:
            provider: The external provider configuration
            sync_type: "full", "incremental", or "manual"
            from_date: Start date for records to fetch
            to_date: End date for records to fetch
            user_id: ID of user who initiated the sync (null for auto-sync)

        Returns:
            Sync log with results
        """
        # Create sync log
        sync_log = ExternalTrainingSyncLog(
            provider_id=provider.id,
            organization_id=provider.organization_id,
            sync_type=sync_type,
            status=SyncStatus.IN_PROGRESS,
            started_at=datetime.now(timezone.utc),
            sync_from_date=from_date,
            sync_to_date=to_date,
            initiated_by=user_id,
        )
        self.db.add(sync_log)
        await self.db.flush()

        try:
            # Determine date range
            if sync_type == "incremental" and not from_date:
                # Use last sync date or default to 30 days ago
                from_date = (
                    provider.last_sync_at
                    or datetime.now(timezone.utc) - timedelta(days=30)
                ).date()
                if review_time_for(provider) is not None:
                    # A frequent pull: at least yesterday too, so a class
                    # finished just before midnight is not skipped.
                    from_date = min(
                        from_date,
                        date.today() - timedelta(days=QUICK_PULL_MIN_LOOKBACK_DAYS),
                    )
            elif sync_type == REVIEW_SYNC_TYPE and not from_date:
                from_date = date.today() - timedelta(days=REVIEW_LOOKBACK_DAYS)
            elif sync_type == "full" and not from_date:
                # Full sync: get all records from a year ago
                from_date = (datetime.now(timezone.utc) - timedelta(days=365)).date()

            if not to_date:
                to_date = date.today()

            sync_log.sync_from_date = from_date
            sync_log.sync_to_date = to_date

            # Fetch records from external provider
            records = await self._fetch_external_records(provider, from_date, to_date)
            sync_log.records_fetched = len(records)

            await self._stage_records(provider, sync_log, records)
            # Completions from AUTO_CREDIT_PROVIDERS are credited as they
            # arrive: each is keyed by its record id, so nothing is credited
            # twice. Every other provider keeps the officer's review step.
            if provider.provider_type in AUTO_CREDIT_PROVIDERS:
                created, awaiting = await self.credit_matched_members(
                    provider, sync_log
                )
                logger.info(
                    f"Sync {sync_log.id}: {created} training record(s) credited, "
                    f"{awaiting} completion(s) waiting for a member"
                )
            sync_log.completed_at = datetime.now(timezone.utc)

            # Update provider sync timestamps
            provider.last_sync_at = datetime.now(timezone.utc)
            if provider.auto_sync_enabled:
                tz = await resolve_scheduling_timezone(
                    self.db, provider.organization_id
                )
                provider.next_sync_at = compute_next_sync_at(
                    provider, tz, provider.last_sync_at
                )

            await self.db.commit()
            await self.notify_course_matches(provider)

        except Exception as e:
            logger.exception(f"Sync failed for provider {provider.id}")
            sync_log.status = SyncStatus.FAILED
            # Shown to officers; never let a credential-bearing URL through.
            sync_log.error_message = redact_url_secrets(str(e))
            sync_log.completed_at = datetime.now(timezone.utc)
            await self.db.commit()

        return sync_log

    async def notify_course_matches(self, provider: ExternalTrainingProvider) -> None:
        """Email officers about this run's new courses that match the library.

        Runs after the staging commit and never undoes it: a mail failure is
        logged, and the courses are still listed under Mappings.
        """
        ids, self.new_course_mapping_ids = self.new_course_mapping_ids, []
        if not ids:
            return
        try:
            await notify_new_course_matches(self.db, provider, ids)
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            logger.exception(f"Course-match email failed for provider {provider.id}")

    async def _lock_provider(self, provider: ExternalTrainingProvider) -> None:
        """Hold the provider row until this transaction commits.

        A sync and a manual upload for the same provider stage the same
        completions; taking turns on this row means the second one sees the
        rows the first one wrote instead of inserting them again. The unique
        index on (provider_id, external_record_id) is the backstop.
        """
        await self.db.execute(
            select(ExternalTrainingProvider.id)
            .where(ExternalTrainingProvider.id == provider.id)
            .with_for_update()
        )

    async def _stage_records(
        self,
        provider: ExternalTrainingProvider,
        sync_log: ExternalTrainingSyncLog,
        records: List[Dict[str, Any]],
    ) -> None:
        """Stage fetched or uploaded records and total them on the sync log.

        Takes the provider lock only now, after any network fetch, so a slow
        provider never holds it.
        """
        await self._lock_provider(provider)
        counts = {"imported": 0, "updated": 0, "skipped": 0}
        failed = 0
        for record_data in records:
            try:
                result = await self._process_external_record(
                    provider, sync_log.id, record_data
                )
                if result in counts:
                    counts[result] += 1
            except Exception as e:
                logger.error(f"Error processing record: {e}")
                failed += 1

        sync_log.records_fetched = len(records)
        sync_log.records_imported = counts["imported"]
        sync_log.records_updated = counts["updated"]
        sync_log.records_skipped = counts["skipped"]
        sync_log.records_failed = failed
        sync_log.status = SyncStatus.COMPLETED if failed == 0 else SyncStatus.PARTIAL

    async def run_scheduled_sync(
        self, provider: ExternalTrainingProvider
    ) -> ExternalTrainingSyncLog:
        """One scheduled run: the daily review if one is owed, else a quick pull.

        A review is owed when none has succeeded since the most recent review
        time, which also means a provider that has never been reviewed starts
        with a full-window backfill.
        """
        sync_type = "incremental"
        review_time = review_time_for(provider)
        if review_time is not None:
            tz = await resolve_scheduling_timezone(self.db, provider.organization_id)
            due_since = latest_review_slot(review_time, tz, datetime.now(timezone.utc))
            last_review = await self._last_successful_review_at(provider)
            if last_review is None or last_review < due_since:
                sync_type = REVIEW_SYNC_TYPE
        return await self.sync_training_records(provider, sync_type=sync_type)

    async def _last_successful_review_at(
        self, provider: ExternalTrainingProvider
    ) -> Optional[datetime]:
        result = await self.db.execute(
            select(ExternalTrainingSyncLog.started_at)
            .where(ExternalTrainingSyncLog.provider_id == provider.id)
            .where(ExternalTrainingSyncLog.sync_type == REVIEW_SYNC_TYPE)
            .where(
                ExternalTrainingSyncLog.status.in_(
                    [SyncStatus.COMPLETED, SyncStatus.PARTIAL]
                )
            )
            .order_by(ExternalTrainingSyncLog.started_at.desc())
            .limit(1)
        )
        started_at = result.scalar_one_or_none()
        if started_at is not None and started_at.tzinfo is None:
            # MySQL hands DateTime(timezone=True) back naive; it is stored UTC.
            started_at = started_at.replace(tzinfo=timezone.utc)
        return started_at

    async def _fetch_external_records(
        self,
        provider: ExternalTrainingProvider,
        from_date: date,
        to_date: date,
    ) -> List[Dict[str, Any]]:
        """Fetch training records from external provider"""
        self._validate_provider_url(provider)
        if provider.provider_type == ExternalProviderType.VECTOR_SOLUTIONS:
            return await self._fetch_vector_solutions_records(
                provider, from_date, to_date
            )
        elif provider.provider_type == ExternalProviderType.TARGET_SOLUTIONS:
            return await self._fetch_target_solutions_records(
                provider, from_date, to_date
            )
        elif provider.provider_type == ExternalProviderType.LEXIPOL:
            return await self._fetch_lexipol_records(provider, from_date, to_date)
        elif provider.provider_type == ExternalProviderType.I_AM_RESPONDING:
            return await self._fetch_iar_records(provider, from_date, to_date)
        elif provider.provider_type == ExternalProviderType.CUSTOM_API:
            return await self._fetch_custom_api_records(provider, from_date, to_date)
        else:
            raise ValueError(f"Unsupported provider type: {provider.provider_type}")

    def _get_vector_site_id(self, provider: ExternalTrainingProvider) -> str:
        """Get the Vector Solutions site_id from provider config"""
        config = provider.config or {}
        site_id = config.get("site_id")
        if not site_id:
            raise ValueError(
                "Vector Solutions site_id is required. "
                "Run a connection test to discover available sites, "
                "then set site_id in the provider config."
            )
        return site_id

    async def _vs_request(
        self,
        provider: ExternalTrainingProvider,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """Execute an HTTP request against the Vector Solutions API.

        Handles 429 rate-limit responses with exponential backoff
        (up to 3 retries: 2s, 4s, 8s).
        """
        import asyncio

        max_retries = 3
        for attempt in range(max_retries + 1):
            response = await self.http_client.request(method, url, **kwargs)
            if response.status_code != 429:
                return response
            if attempt == max_retries:
                return response
            # Respect Retry-After header if present, else exponential backoff
            retry_after = response.headers.get("Retry-After")
            if retry_after and retry_after.isdigit():
                wait = min(int(retry_after), 30)
            else:
                wait = 2 ** (attempt + 1)
            logger.info(
                "Vector Solutions rate limited (429) — retrying in {}s",
                wait,
            )
            await asyncio.sleep(wait)
        return response  # type: ignore[possibly-undefined]

    async def fetch_vector_solutions_categories(
        self,
        provider: ExternalTrainingProvider,
    ) -> List[Dict[str, Any]]:
        """
        Fetch the full training category catalog from Vector Solutions.

        Calls GET /sites/{siteId}/categories to retrieve all categories
        so they can be mapped to Logbook training categories before
        syncing records.

        Returns:
            List of dicts with external_category_id and external_category_name.
        """
        self._validate_provider_url(provider)
        headers = self._get_auth_headers(provider)
        site_id = self._get_vector_site_id(provider)
        url = join_endpoint(provider.api_base_url, f"/sites/{site_id}/categories")

        response = await self._vs_request(provider, "GET", url, headers=headers)
        response.raise_for_status()

        data = response.json()
        raw_categories = (
            data
            if isinstance(data, list)
            else data.get("categories", data.get("data", data.get("records", [])))
        )

        categories: List[Dict[str, Any]] = []
        for cat in raw_categories:
            cat_id = str(cat.get("id", cat.get("categoryId", cat.get("catId", ""))))
            cat_name = cat.get("name", cat.get("categoryName", cat.get("title", "")))
            if not cat_id:
                continue
            categories.append(
                {
                    "external_category_id": cat_id,
                    "external_category_name": cat_name,
                    "description": cat.get("description", ""),
                    "parent_id": str(
                        cat.get("parentCategoryId", cat.get("parentId", ""))
                    )
                    or None,
                }
            )

        return categories

    async def sync_vector_solutions_categories(
        self,
        provider: ExternalTrainingProvider,
    ) -> Dict[str, int]:
        """
        Fetch categories from Vector Solutions and create/update mappings.

        Returns counts of new and existing mappings.
        """
        categories = await self.fetch_vector_solutions_categories(provider)

        created = 0
        existing = 0
        for cat in categories:
            ext_id = cat["external_category_id"]
            result = await self.db.execute(
                select(ExternalCategoryMapping)
                .where(ExternalCategoryMapping.provider_id == provider.id)
                .where(ExternalCategoryMapping.external_category_id == ext_id)
            )
            mapping = result.scalar_one_or_none()
            if mapping:
                # Update name if it changed
                if mapping.external_category_name != cat["external_category_name"]:
                    mapping.external_category_name = cat["external_category_name"]
                existing += 1
            else:
                new_mapping = ExternalCategoryMapping(
                    provider_id=provider.id,
                    organization_id=provider.organization_id,
                    external_category_id=ext_id,
                    external_category_name=cat["external_category_name"],
                    is_mapped=False,
                )
                self.db.add(new_mapping)

                # Try auto-mapping by name match
                cat_result = await self.db.execute(
                    select(TrainingCategory)
                    .where(TrainingCategory.organization_id == provider.organization_id)
                    .where(TrainingCategory.name == cat["external_category_name"])
                )
                internal_cat = cat_result.scalar_one_or_none()
                if internal_cat:
                    new_mapping.internal_category_id = internal_cat.id
                    new_mapping.is_mapped = True
                    new_mapping.auto_mapped = True

                created += 1

        await self.db.flush()
        return {"created": created, "existing": existing}

    async def _fetch_vector_solutions_records(
        self,
        provider: ExternalTrainingProvider,
        from_date: date,
        to_date: date,
    ) -> List[Dict[str, Any]]:
        """
        Fetch training records from Vector Solutions (TargetSolutions) API.

        API details:
        - Auth: AccessToken header
        - Endpoints are site-scoped: /sites/{siteId}/...
        - Pagination: startrow & count params (max 1000 per page)
        - Date filtering via query params
        - Response is JSON
        """
        headers = self._get_auth_headers(provider)
        config = provider.config or {}
        site_id = self._get_vector_site_id(provider)

        # Use configured endpoint or default to credentials (training completions)
        records_endpoint = config.get(
            "records_endpoint", f"/sites/{site_id}/credentials"
        )
        # If the endpoint doesn't already include the site_id, prepend it
        if "{siteId}" in records_endpoint:
            records_endpoint = records_endpoint.replace("{siteId}", site_id)
        elif not records_endpoint.startswith(f"/sites/{site_id}"):
            records_endpoint = f"/sites/{site_id}/{records_endpoint.lstrip('/')}"

        url = join_endpoint(provider.api_base_url, records_endpoint)

        # Vector Solutions uses startrow/count pagination (max 1000)
        page_size = min(int(config.get("page_size", 1000)), 1000)

        params: Dict[str, Any] = {
            "count": page_size,
        }

        # Add date filtering — prefer dedicated startDate/endDate params,
        # fall back to JSON search query for older API versions.
        date_filter = config.get("date_filter_param")
        if date_filter:
            params[date_filter] = from_date.isoformat()
        else:
            params["startDate"] = from_date.isoformat()
            params["endDate"] = to_date.isoformat()

        all_records = []
        startrow = 0
        total_count: Optional[int] = None

        while True:
            params["startrow"] = startrow
            response = await self._vs_request(
                provider, "GET", url, headers=headers, params=params
            )
            response.raise_for_status()

            data = response.json()
            records = (
                data
                if isinstance(data, list)
                else data.get("data", data.get("credentials", data.get("records", [])))
            )

            # Read total count from response envelope if available
            if total_count is None and isinstance(data, dict):
                total_count = data.get(
                    "totalCount", data.get("total", data.get("count"))
                )

            if not records:
                break

            for record in records:
                all_records.append(self._normalize_vector_solutions_record(record))

            # Stop when we've fetched all records or received a short page
            if total_count is not None and len(all_records) >= total_count:
                break
            if len(records) < page_size:
                break
            startrow += page_size

        return all_records

    @staticmethod
    def _first_present(record: Dict[str, Any], *keys: str) -> str:
        """First non-empty value among ``keys`` as a string, else "".

        ``str(record.get(k))`` turns a key present with a JSON null into the
        literal "None", which then keys every such member into one mapping.
        """
        for key in keys:
            value = record.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        return ""

    def _normalize_vector_solutions_record(
        self, record: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Normalize a Vector Solutions / TargetSolutions record to our standard format.

        Field names come from the TargetSolutions API response. We try multiple
        possible field names to handle variations across API versions.
        """
        # Build full name from components if not provided as a single field
        first = record.get("firstName", record.get("first_name", ""))
        last = record.get("lastName", record.get("last_name", ""))
        full_name = record.get("fullName", record.get("displayName", ""))
        if not full_name and (first or last):
            full_name = f"{first} {last}".strip()

        return {
            "external_record_id": str(
                record.get(
                    "id", record.get("credentialId", record.get("completionId", ""))
                )
            ),
            "external_user_id": self._first_present(
                record, "userId", "employeeId", "user_id"
            ),
            "external_course_id": str(
                record.get("courseId", record.get("course_id", ""))
            ),
            "external_category_id": str(
                record.get("categoryId", record.get("category_id", ""))
            ),
            "course_title": record.get(
                "courseName", record.get("courseTitle", record.get("name", ""))
            ),
            "course_code": record.get("courseCode", record.get("code", "")),
            "description": record.get(
                "description", record.get("courseDescription", "")
            ),
            "training_type": record.get(
                "trainingType", record.get("type", record.get("courseType", ""))
            ),
            "duration_minutes": record.get(
                "durationMinutes",
                record.get("duration", record.get("creditMinutes", 0)),
            ),
            "credit_hours": record.get(
                "creditHours", record.get("credits", record.get("hours", 0))
            ),
            "completion_date": record.get(
                "completionDate",
                record.get("completedDate", record.get("dateCompleted")),
            ),
            "expiration_date": record.get(
                "expirationDate",
                record.get("expireDate", record.get("certExpirationDate")),
            ),
            "certification_number": record.get(
                "certificationNumber",
                record.get("certNumber", record.get("licenseNumber", "")),
            ),
            "issuing_agency": record.get(
                "issuingAgency",
                record.get("issuer", record.get("certifyingBody", "")),
            ),
            "score": record.get(
                "score", record.get("percentScore", record.get("finalScore"))
            ),
            "passed": record.get(
                "passed",
                record.get(
                    "isPassed",
                    record.get("status", "").lower()
                    in ("passed", "completed", "complete"),
                ),
            ),
            "external_category_name": record.get(
                "categoryName", record.get("category", "")
            ),
            "external_username": record.get("username", record.get("loginName", "")),
            "external_email": record.get("email", record.get("userEmail", "")),
            "external_name": full_name,
            "raw_data": record,
        }

    # ------------------------------------------
    # TargetSolutions Training Records API
    # ------------------------------------------
    # Documented at support.vectorlmstargetsolutionsedition.com, article
    # "Training-Records-API": a single GET returning a CSV of every course and
    # activity completion for all active and offline users. Credentials are the
    # ``key`` and ``secret`` query parameters — there is no header form — so
    # app.core.logging redacts them from httpx logs and Sentry data. Dates are
    # mm-dd-yyyy; without them the report covers the current day only.

    TS_REPORT_ACTION = "reports.buildReport"
    TS_REPORT_TYPE = "completionsall"
    TS_REQUIRED_COLUMNS = ("Employee ID", "Email")
    TS_API_BASE_URL = "https://app.targetsolutions.com/tsapp/api/"
    TS_QUOTE_MAX = 150

    def _target_solutions_params(
        self,
        provider: ExternalTrainingProvider,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
    ) -> Dict[str, str]:
        key = self._decrypt_field(provider.api_key)
        secret = self._decrypt_field(provider.api_secret)
        if not key or not secret:
            raise ValueError("Target Solutions API key and secret are both required")
        params = {
            "action": self.TS_REPORT_ACTION,
            "reportType": self.TS_REPORT_TYPE,
            "key": key,
            "secret": secret,
        }
        if from_date:
            params["startDate"] = from_date.strftime("%m-%d-%Y")
        if to_date:
            params["endDate"] = to_date.strftime("%m-%d-%Y")
        return params

    async def _target_solutions_report(
        self, provider: ExternalTrainingProvider, params: Dict[str, str]
    ) -> List[Dict[str, str]]:
        """Request the completions report and return its rows.

        Error messages never include the URL or response body: the URL holds
        the credentials, and the message is stored on the sync log and shown
        to officers.
        """
        url = join_endpoint(provider.api_base_url, "/")
        host = urlsplit(url).hostname or "the API base URL"
        try:
            response = await self.http_client.get(
                url, params=params, headers={"Accept": "text/csv"}
            )
        except httpx.TimeoutException:
            raise ValueError(
                f"Target Solutions ({host}) did not respond within "
                f"{self.http_client.timeout.read:.0f} seconds. Try again later."
            )
        except httpx.ConnectError:
            raise ValueError(
                f"Could not connect to {host}. Check the API base URL, and that "
                "this server can reach the internet."
            )

        status_code = response.status_code
        if status_code in (401, 403):
            raise ValueError(
                f"Target Solutions rejected the API key or secret (HTTP {status_code})."
            )
        if 300 <= status_code < 400:
            # Redirects are not followed; say where it pointed, minus the
            # query string and any user:password, either of which can carry
            # credentials.
            location = response.headers.get("location", "")
            target = urlsplit(location)
            destination = f"{target.hostname or ''}{target.path}"
            where = f" to {destination}" if destination else ""
            raise ValueError(
                f"Target Solutions redirected the report request{where} "
                f"(HTTP {status_code}) instead of returning a report. Check the "
                f"API key and secret, and that the API base URL is "
                f"{self.TS_API_BASE_URL}"
            )
        if status_code == 404:
            raise ValueError(
                f"Target Solutions has no report API at this address (HTTP 404). "
                f"The API base URL should be {self.TS_API_BASE_URL}"
            )
        if status_code >= 500:
            raise ValueError(
                f"Target Solutions had a server error (HTTP {status_code}). "
                "The problem is on their side; try again later."
            )
        if status_code != 200:
            raise ValueError(
                f"Target Solutions report request failed (HTTP {status_code})."
            )

        body = response.content.decode("utf-8-sig", errors="replace")
        return self._parse_target_solutions_report(body, params)

    @classmethod
    def _parse_target_solutions_report(
        cls, body: str, params: Dict[str, str], uploaded: bool = False
    ) -> List[Dict[str, str]]:
        """Rows of a completions report, from the API or an uploaded file.

        Both arrive as the same CSV, so both go through this one parser and
        stage identical records — which is what lets a completion that comes
        in both ways update one staged row instead of making two.
        """
        if not body.strip():
            return []

        # The live report opens with a title block ("Completions (via API)",
        # "Report executed ...", the filters applied) before the header row,
        # so the header is located rather than assumed to be the first line.
        rows = csv.reader(io.StringIO(body))
        columns: List[str] = []
        for cells in rows:
            stripped = [cell.strip() for cell in cells]
            if all(col in stripped for col in cls.TS_REQUIRED_COLUMNS):
                columns = stripped
                break
        if not columns:
            # An invalid key comes back as a 200 with an error page rather
            # than a CSV, so the header row is the only reliable signal.
            raise ValueError(cls._ts_not_a_report_message(body, params, uploaded))
        return [
            {
                k: (cells[i].strip() if i < len(cells) else "")
                for i, k in enumerate(columns)
                if k
            }
            for cells in rows
            if any(v.strip() for v in cells)
        ]

    @classmethod
    def _ts_not_a_report_message(
        cls, body: str, params: Dict[str, str], uploaded: bool = False
    ) -> str:
        """Describe a response or uploaded file that holds no completions report.

        Quotes what the response itself says (a web page's title, or a file's
        first line) so the officer sees Target Solutions' own words rather
        than a guess. The key and secret are scrubbed from the quote, since
        an error page may echo the request back.
        """

        def quote(text: str) -> str:
            text = " ".join(html.unescape(text).split())
            for name in ("key", "secret"):
                value = params.get(name)
                if value:
                    text = text.replace(value, "[REDACTED]")
            text = redact_url_secrets(text)
            if len(text) > cls.TS_QUOTE_MAX:
                text = text[: cls.TS_QUOTE_MAX].rstrip() + "…"
            return text

        if re.search(r"<\s*(!doctype|html|head|body)\b", body[:2000], re.I):
            title = re.search(r"<title[^>]*>(.*?)</title>", body, re.I | re.S)
            titled = quote(title.group(1)) if title else ""
            named = f' titled "{titled}"' if titled else ""
            if uploaded:
                return (
                    f"This file is a web page{named}, not a Target Solutions "
                    "completions report. Download the report as CSV and "
                    "upload that file."
                )
            return (
                f"Target Solutions returned a web page{named} instead of a "
                "completions report. It does this when the API key or secret is "
                "not accepted, or when the API base URL points at the website "
                f"rather than the API ({cls.TS_API_BASE_URL})."
            )

        first_line = next((line for line in body.splitlines() if line.strip()), "")
        missing = ", ".join(cls.TS_REQUIRED_COLUMNS)
        if uploaded:
            return (
                "This file is not a Target Solutions completions report: it has "
                f'no {missing} columns. It begins: "{quote(first_line)}"'
            )
        return (
            "Target Solutions returned a file without the completions report's "
            f'columns ({missing}). It begins: "{quote(first_line)}"'
        )

    async def _test_target_solutions_connection(
        self, provider: ExternalTrainingProvider
    ) -> Tuple[bool, str]:
        """Request today's completions report, the cheapest call the API offers."""
        if not provider.api_key or not provider.api_secret:
            return False, "API key and secret are required"
        try:
            rows = await self._target_solutions_report(
                provider, self._target_solutions_params(provider)
            )
        except ValueError as e:
            return False, str(e)
        return (
            True,
            f"Connection successful - completions report returned {len(rows)} "
            "record(s) for today",
        )

    async def _fetch_target_solutions_records(
        self,
        provider: ExternalTrainingProvider,
        from_date: date,
        to_date: date,
    ) -> List[Dict[str, Any]]:
        rows = await self._target_solutions_report(
            provider, self._target_solutions_params(provider, from_date, to_date)
        )
        records = []
        for row in rows:
            record = self._normalize_target_solutions_record(row)
            if record is not None:
                records.append(record)
        return records

    @staticmethod
    def _parse_number(value: Any) -> Optional[float]:
        if value is None:
            return None
        text = str(value).strip().rstrip("%").strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None

    def _normalize_target_solutions_record(
        self, row: Dict[str, str]
    ) -> Optional[Dict[str, Any]]:
        """Map one Training Records API CSV row to the standard format.

        Returns None for a row that names no assignment, which cannot become a
        training record.
        """
        employee_id = row.get("Employee ID", "")
        email = row.get("Email", "")
        course_id = row.get("Course ID", "")
        title = row.get("Assignment Name", "") or course_id
        if not title:
            return None

        completion_date = row.get("Completion Date", "")
        # Transcript ID identifies a completion, so a re-sync updates the same
        # staging row. If it is ever blank, fall back to who + what + when.
        record_id = (
            row.get("Transcript ID", "")
            or "|".join(
                [
                    employee_id or email.lower(),
                    course_id or title,
                    completion_date,
                    row.get("Completion Time", ""),
                ]
            )[:255]
        )

        hours = self._parse_number(row.get("Duration (hours)"))
        return {
            "external_record_id": record_id,
            "external_user_id": employee_id,
            "external_course_id": course_id,
            "external_category_id": "",
            "course_title": title,
            "course_code": course_id,
            "description": "",
            "training_type": row.get("Assignment Type", ""),
            # The import endpoints derive hours from duration_minutes, so the
            # reported hours must be carried there as well as in credit_hours.
            "duration_minutes": round(hours * 60) if hours is not None else None,
            "credit_hours": hours,
            "completion_date": completion_date,
            "score": self._parse_number(row.get("Test Score")),
            "passed": True,
            "external_category_name": "",
            "external_username": "",
            "external_email": email,
            "external_name": "",
            # Kept apart from external_user_id, which falls back to the email
            # when the Employee ID is blank, so only a real ID is ever compared
            # against membership numbers.
            "external_employee_id": employee_id,
            "raw_data": row,
        }

    async def _fetch_lexipol_records(
        self,
        provider: ExternalTrainingProvider,
        from_date: date,
        to_date: date,
    ) -> List[Dict[str, Any]]:
        """Fetch records from Lexipol API"""
        headers = self._get_auth_headers(provider)
        config = provider.config or {}

        records_endpoint = config.get("records_endpoint", "/api/v1/training/records")
        url = join_endpoint(provider.api_base_url, records_endpoint)

        params = {
            "start": from_date.isoformat(),
            "end": to_date.isoformat(),
        }

        response = await self.http_client.get(url, headers=headers, params=params)
        response.raise_for_status()

        data = response.json()
        records = data.get("records", data.get("data", []))

        return [self._normalize_lexipol_record(r) for r in records]

    def _normalize_lexipol_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize Lexipol record to standard format"""
        return {
            "external_record_id": str(record.get("recordId", record.get("id", ""))),
            "external_user_id": str(record.get("memberId", record.get("userId", ""))),
            "external_course_id": str(record.get("courseId", "")),
            "external_category_id": str(record.get("topicId", "")),
            "course_title": record.get("courseTitle", record.get("topicName", "")),
            "course_code": record.get("courseCode", ""),
            "description": record.get("description", ""),
            "duration_minutes": record.get("minutes", record.get("creditMinutes", 0)),
            "completion_date": record.get("completedDate", record.get("dateCompleted")),
            "score": record.get("score", None),
            "passed": record.get("passed", True),
            "external_category_name": record.get(
                "topicName", record.get("category", "")
            ),
            "external_username": record.get("memberEmail", ""),
            "external_email": record.get("memberEmail", ""),
            "external_name": record.get("memberName", ""),
            "raw_data": record,
        }

    async def _fetch_iar_records(
        self,
        provider: ExternalTrainingProvider,
        from_date: date,
        to_date: date,
    ) -> List[Dict[str, Any]]:
        """Fetch records from I Am Responding API"""
        headers = self._get_auth_headers(provider)
        config = provider.config or {}

        records_endpoint = config.get("records_endpoint", "/api/v1/training")
        url = join_endpoint(provider.api_base_url, records_endpoint)

        params = {
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
        }

        response = await self.http_client.get(url, headers=headers, params=params)
        response.raise_for_status()

        data = response.json()
        records = data.get("training", data.get("records", []))

        return [self._normalize_iar_record(r) for r in records]

    def _normalize_iar_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize I Am Responding record to standard format"""
        return {
            "external_record_id": str(record.get("id", "")),
            "external_user_id": str(record.get("member_id", "")),
            "external_course_id": str(record.get("training_id", "")),
            "external_category_id": str(record.get("type_id", "")),
            "course_title": record.get("name", record.get("training_name", "")),
            "course_code": record.get("code", ""),
            "description": record.get("notes", ""),
            "duration_minutes": record.get("duration", 0),
            "completion_date": record.get("date", record.get("training_date")),
            "score": None,
            "passed": True,
            "external_category_name": record.get(
                "type", record.get("training_type", "")
            ),
            "external_username": record.get("member_email", ""),
            "external_email": record.get("member_email", ""),
            "external_name": record.get("member_name", ""),
            "raw_data": record,
        }

    async def _fetch_custom_api_records(
        self,
        provider: ExternalTrainingProvider,
        from_date: date,
        to_date: date,
    ) -> List[Dict[str, Any]]:
        """Fetch records from custom API using provider config"""
        headers = self._get_auth_headers(provider)
        config = provider.config or {}

        records_endpoint = config.get("records_endpoint", "/training/records")
        url = join_endpoint(provider.api_base_url, records_endpoint)

        # Get custom parameter names from config
        param_mapping = config.get("param_mapping", {})
        start_param = param_mapping.get("start_date", "start_date")
        end_param = param_mapping.get("end_date", "end_date")

        params = {
            start_param: from_date.isoformat(),
            end_param: to_date.isoformat(),
        }

        response = await self.http_client.get(url, headers=headers, params=params)
        response.raise_for_status()

        data = response.json()

        # Get records from response using configured path
        records_path = config.get("records_path", "data")
        records = data
        for key in records_path.split("."):
            if isinstance(records, dict):
                records = records.get(key, [])

        if not isinstance(records, list):
            records = [records] if records else []

        # Get field mapping from config
        field_mapping = config.get("field_mapping", {})

        return [self._normalize_custom_record(r, field_mapping) for r in records]

    def _normalize_custom_record(
        self, record: Dict[str, Any], field_mapping: Dict[str, str]
    ) -> Dict[str, Any]:
        """Normalize custom API record using field mapping"""

        def get_field(name: str, default: Any = "") -> Any:
            field_name = field_mapping.get(name, name)
            return record.get(field_name, default)

        return {
            "external_record_id": str(
                get_field("external_record_id", record.get("id", ""))
            ),
            "external_user_id": str(get_field("external_user_id", "")),
            "external_course_id": str(get_field("external_course_id", "")),
            "external_category_id": str(get_field("external_category_id", "")),
            "course_title": get_field("course_title", ""),
            "course_code": get_field("course_code", ""),
            "description": get_field("description", ""),
            "duration_minutes": get_field("duration_minutes", 0),
            "completion_date": get_field("completion_date"),
            "score": get_field("score", None),
            "passed": get_field("passed", True),
            "external_category_name": get_field("external_category_name", ""),
            "external_username": get_field("external_username", ""),
            "external_email": get_field("external_email", ""),
            "external_name": get_field("external_name", ""),
            "raw_data": record,
        }

    async def _process_external_record(
        self,
        provider: ExternalTrainingProvider,
        sync_log_id: str,
        record_data: Dict[str, Any],
    ) -> str:
        """
        Process a single external training record.

        Returns: "imported", "updated", or "skipped"
        """
        # Normalizers build ids with str(record.get(...)), so a provider that
        # sends null yields the text "None"; treat it as absent.
        for key in ("external_record_id", "external_user_id", "external_course_id"):
            if _is_blank(record_data.get(key)):
                record_data[key] = ""

        # A record that carries an email but no provider user id still belongs
        # to someone: key the member by that email so it can be mapped (and
        # later bulk-imported, which looks mappings up by external_user_id).
        if not record_data.get("external_user_id"):
            email_key = self._normalize_email(record_data.get("external_email"))
            if email_key:
                record_data["external_user_id"] = email_key

        # Every completion needs its own key: staging is unique per record id,
        # so records sharing a blank id would overwrite one another, and with
        # automatic crediting the survivor would be credited while the rest
        # vanished. Without a provider id, who + what + when identifies it, as
        # Target Solutions' blank-Transcript-ID fallback does.
        if not record_data.get("external_record_id"):
            parts = [
                str(record_data.get("external_user_id") or ""),
                str(
                    record_data.get("external_course_id")
                    or record_data.get("course_title")
                    or ""
                ),
                str(record_data.get("completion_date") or ""),
            ]
            if not parts[0] or not any(parts[1:]):
                logger.warning(
                    f"Skipped a {provider.provider_type} record with no id, "
                    "member, course or date to identify it"
                )
                return "skipped"
            record_data["external_record_id"] = "|".join(parts)[:255]

        # A locking read, not a plain SELECT: under REPEATABLE READ a plain one
        # answers from this transaction's first snapshot, which predates the
        # provider lock, and would miss a row a concurrent sync or upload
        # committed while this one waited for it.
        existing = await self.db.execute(
            select(ExternalTrainingImport)
            .where(ExternalTrainingImport.provider_id == provider.id)
            .where(
                ExternalTrainingImport.external_record_id
                == record_data["external_record_id"]
            )
            .with_for_update()
        )
        existing_import = existing.scalar_one_or_none()

        if existing_import:
            # Update existing record
            for key, value in record_data.items():
                if key in ("raw_data", "completion_date"):
                    continue
                if hasattr(existing_import, key):
                    setattr(existing_import, key, value)
            # The provider sends dates as strings; the column is a DateTime, so
            # the value must go through the same parser the insert path uses.
            existing_import.completion_date = self._parse_date(
                record_data.get("completion_date")
            )
            existing_import.raw_data = record_data.get("raw_data")
            existing_import.sync_log_id = sync_log_id
            await self._track_course_mapping(provider, record_data)

            # A member who could not be matched on an earlier sync (email not yet
            # on file in the Logbook) is attached once the mapping resolves.
            # Records already imported keep the member they were imported to.
            if (
                not existing_import.user_id
                and existing_import.import_status != "imported"
                and record_data.get("external_user_id")
            ):
                user_mapping = await self._find_or_create_user_mapping(
                    provider, record_data
                )
                if user_mapping and user_mapping.internal_user_id:
                    existing_import.user_id = user_mapping.internal_user_id
            return "updated"

        # Create new import record
        import_record = ExternalTrainingImport(
            provider_id=provider.id,
            organization_id=provider.organization_id,
            sync_log_id=sync_log_id,
            external_record_id=record_data["external_record_id"],
            external_user_id=record_data.get("external_user_id"),
            external_course_id=record_data.get("external_course_id"),
            external_category_id=record_data.get("external_category_id"),
            course_title=record_data["course_title"],
            course_code=record_data.get("course_code"),
            description=record_data.get("description"),
            duration_minutes=record_data.get("duration_minutes"),
            credit_hours=record_data.get("credit_hours"),
            completion_date=self._parse_date(record_data.get("completion_date")),
            score=record_data.get("score"),
            passed=record_data.get("passed", True),
            external_category_name=record_data.get("external_category_name"),
            raw_data=record_data.get("raw_data"),
            import_status="pending",
        )

        # Try to auto-map user
        if record_data.get("external_user_id"):
            user_mapping = await self._find_or_create_user_mapping(
                provider, record_data
            )
            if user_mapping and user_mapping.internal_user_id:
                import_record.user_id = user_mapping.internal_user_id

        await self._track_course_mapping(provider, record_data)

        # Try to auto-map category
        if record_data.get("external_category_id"):
            await self._find_or_create_category_mapping(provider, record_data)

        repeated = await self._same_day_acknowledgment(provider, import_record)
        if repeated:
            # Kept for the record, but set aside so it is never imported.
            import_record.import_status = "duplicate"
            import_record.import_error = f"Same-day repeat of acknowledgment {repeated}"
            self.db.add(import_record)
            return "skipped"

        self.db.add(import_record)
        return "imported"

    async def _track_course_mapping(
        self, provider: ExternalTrainingProvider, record_data: Dict[str, Any]
    ) -> None:
        """Make sure the record's course id has a mapping row, noting new ones."""
        external_course_id = record_data.get("external_course_id")
        if not external_course_id:
            return
        mapping, created = await find_or_create_course_mapping(
            self.db,
            provider,
            str(external_course_id),
            record_data.get("course_title") or "",
        )
        if created:
            self.new_course_mapping_ids.append(mapping.id)

    async def _same_day_acknowledgment(
        self,
        provider: ExternalTrainingProvider,
        import_record: ExternalTrainingImport,
    ) -> Optional[str]:
        """The record id this policy acknowledgment repeats, if any.

        A member who acknowledges the same policy twice on one day (Target
        Solutions records each click) has acknowledged it once. A later day's
        acknowledgment is a new one — next year's annual reading — and is
        kept. Only policy acknowledgments collapse: two completions of a real
        course on one day are two completions.
        """
        if (
            self._map_training_type(import_record.raw_data)
            != TrainingType.POLICY_ACKNOWLEDGMENT
            or not import_record.external_user_id
            or import_record.completion_date is None
        ):
            return None
        same_item = (
            ExternalTrainingImport.external_course_id
            == import_record.external_course_id
            if import_record.external_course_id
            else ExternalTrainingImport.course_title == import_record.course_title
        )
        result = await self.db.execute(
            select(ExternalTrainingImport.external_record_id)
            .where(ExternalTrainingImport.provider_id == provider.id)
            .where(
                ExternalTrainingImport.external_user_id
                == import_record.external_user_id
            )
            .where(same_item)
            .where(
                ExternalTrainingImport.completion_date == import_record.completion_date
            )
            .where(ExternalTrainingImport.import_status != "duplicate")
            .where(
                ExternalTrainingImport.external_record_id
                != import_record.external_record_id
            )
            .limit(1)
            .with_for_update()
        )
        repeated = result.scalar_one_or_none()
        return str(repeated) if repeated is not None else None

    @staticmethod
    def _map_training_type(raw_data: Optional[Dict[str, Any]]) -> TrainingType:
        """Infer the Logbook TrainingType from external provider data.

        Looks at trainingType, courseType, and category keywords to map
        to the closest Logbook enum value.  Falls back to
        CONTINUING_EDUCATION when no match is found.
        """
        if not raw_data:
            return TrainingType.CONTINUING_EDUCATION

        # Target Solutions' "Assignment Type" tells its own courses ("TS
        # Course") from items a department authors itself ("Admin") — the
        # policies members must read and acknowledge each year.
        assignment_type = str(raw_data.get(TS_ASSIGNMENT_TYPE_COLUMN, "")).strip()
        if assignment_type.lower() == TS_ADMIN_ASSIGNMENT_TYPE:
            return TrainingType.POLICY_ACKNOWLEDGMENT

        type_str = (
            str(
                raw_data.get(
                    "trainingType",
                    raw_data.get("type", raw_data.get("courseType", "")),
                )
            )
            .lower()
            .strip()
        )

        # Direct keyword matching
        cert_keywords = ("certification", "license", "credential", "cert")
        refresher_keywords = ("refresher", "recertification", "renewal")
        skills_keywords = ("skills", "practical", "hands-on", "drill")
        orientation_keywords = ("orientation", "onboarding", "induction")
        specialty_keywords = ("specialty", "advanced", "technician", "hazmat")

        if any(k in type_str for k in cert_keywords):
            return TrainingType.CERTIFICATION
        if any(k in type_str for k in refresher_keywords):
            return TrainingType.REFRESHER
        if any(k in type_str for k in skills_keywords):
            return TrainingType.SKILLS_PRACTICE
        if any(k in type_str for k in orientation_keywords):
            return TrainingType.ORIENTATION
        if any(k in type_str for k in specialty_keywords):
            return TrainingType.SPECIALTY

        # Check if the record has expiration data — likely a certification
        if raw_data.get("expirationDate") or raw_data.get("expireDate"):
            return TrainingType.CERTIFICATION

        return TrainingType.CONTINUING_EDUCATION

    def _parse_date(self, date_value: Any) -> Optional[datetime]:
        """Parse various date formats to datetime"""
        if not date_value:
            return None
        if isinstance(date_value, datetime):
            return date_value
        if isinstance(date_value, date):
            return datetime.combine(
                date_value, datetime.min.time(), tzinfo=timezone.utc
            )
        if isinstance(date_value, str):
            # Try common formats
            for fmt in [
                "%Y-%m-%dT%H:%M:%S.%fZ",
                "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d",
                "%m/%d/%Y",
                "%m-%d-%Y",
            ]:
                try:
                    return datetime.strptime(date_value, fmt)
                except ValueError:
                    continue
        return None

    async def _find_or_create_user_mapping(
        self,
        provider: ExternalTrainingProvider,
        record_data: Dict[str, Any],
    ) -> Optional[ExternalUserMapping]:
        """Find or create a user mapping for the external user"""
        external_user_id = record_data.get("external_user_id")
        if not external_user_id:
            return None

        # Check if mapping exists
        result = await self.db.execute(
            select(ExternalUserMapping)
            .where(ExternalUserMapping.provider_id == provider.id)
            .where(ExternalUserMapping.external_user_id == external_user_id)
        )
        mapping = result.scalar_one_or_none()
        email = self._normalize_email(record_data.get("external_email"))

        if mapping:
            if email:
                mapping.external_email = email
            if record_data.get("external_username"):
                mapping.external_username = record_data["external_username"]
            if record_data.get("external_name"):
                mapping.external_name = record_data["external_name"]

            # Retry the match on every sync until it lands, so a member whose
            # email or membership number is added or corrected in the Logbook
            # after the first sync is picked up. A mapping an officer has touched (mapped_by is
            # set, including a deliberate un-map) is never overridden.
            if not mapping.internal_user_id and not mapping.mapped_by:
                user_id = await self._match_member(provider, record_data, email)
                if user_id:
                    mapping.internal_user_id = user_id
                    mapping.is_mapped = True
                    mapping.auto_mapped = True
            return mapping

        # Create new mapping
        mapping = ExternalUserMapping(
            provider_id=provider.id,
            organization_id=provider.organization_id,
            external_user_id=external_user_id,
            external_username=record_data.get("external_username"),
            external_email=email or None,
            external_name=record_data.get("external_name"),
            is_mapped=False,
            auto_mapped=False,
        )

        user_id = await self._match_member(provider, record_data, email)
        if user_id:
            mapping.internal_user_id = user_id
            mapping.is_mapped = True
            mapping.auto_mapped = True

        self.db.add(mapping)
        return mapping

    @staticmethod
    def _normalize_email(value: Any) -> str:
        """Trim and lowercase an email so provider and Logbook spellings compare."""
        if not isinstance(value, str):
            return ""
        return value.strip().lower()

    async def _match_member(
        self,
        provider: ExternalTrainingProvider,
        record_data: Dict[str, Any],
        email: str,
    ) -> Optional[str]:
        """Email first, then (Target Solutions only) Employee ID.

        The Employee ID is compared only for providers in
        ``MEMBERSHIP_NUMBER_PROVIDERS``: other providers' user ids are their own
        internal keys, and one that happened to equal a membership number would
        attach a completion to the wrong member.
        """
        if email:
            user_id = await self._match_member_by_email(provider.organization_id, email)
            if user_id:
                return user_id
        if provider.provider_type in MEMBERSHIP_NUMBER_PROVIDERS:
            employee_id = str(record_data.get("external_employee_id") or "").strip()
            if employee_id:
                return await self._match_member_by_membership_number(
                    provider.organization_id, employee_id
                )
        return None

    async def _match_member_by_membership_number(
        self, organization_id: str, membership_number: str
    ) -> Optional[str]:
        """Return the id of the one live member in the org with this number.

        Membership numbers are unique per org, but a deleted member is excluded
        all the same, and more than one candidate maps nothing.
        """
        result = await self.db.execute(
            select(User.id)
            .where(User.organization_id == organization_id)
            .where(func.trim(User.membership_number) == membership_number)
            .where(User.deleted_at.is_(None))
            .limit(2)
        )
        ids = list(result.scalars().all())
        if len(ids) != 1:
            return None
        return str(ids[0])

    async def _match_member_by_email(
        self, organization_id: str, email: str
    ) -> Optional[str]:
        """Return the id of the one live member in the org with this email.

        Case-insensitive, and deleted members are excluded so a completion is
        never attached to a removed account. Two candidates means the match is
        ambiguous, so nothing is mapped and the officer decides.
        """
        result = await self.db.execute(
            select(User.id)
            .where(User.organization_id == organization_id)
            .where(func.lower(func.trim(User.email)) == email)
            .where(User.deleted_at.is_(None))
            .limit(2)
        )
        ids = list(result.scalars().all())
        if len(ids) != 1:
            return None
        return str(ids[0])

    async def _find_or_create_category_mapping(
        self,
        provider: ExternalTrainingProvider,
        record_data: Dict[str, Any],
    ) -> Optional[ExternalCategoryMapping]:
        """Find or create a category mapping for the external category"""
        external_category_id = record_data.get("external_category_id")
        if not external_category_id:
            return None

        # Check if mapping exists
        result = await self.db.execute(
            select(ExternalCategoryMapping)
            .where(ExternalCategoryMapping.provider_id == provider.id)
            .where(ExternalCategoryMapping.external_category_id == external_category_id)
        )
        mapping = result.scalar_one_or_none()

        if mapping:
            return mapping

        # Create new mapping
        mapping = ExternalCategoryMapping(
            provider_id=provider.id,
            organization_id=provider.organization_id,
            external_category_id=external_category_id,
            external_category_name=record_data.get("external_category_name", ""),
            is_mapped=False,
            auto_mapped=False,
        )

        # Try to auto-map by name match
        if record_data.get("external_category_name"):
            category_result = await self.db.execute(
                select(TrainingCategory)
                .where(TrainingCategory.organization_id == provider.organization_id)
                .where(TrainingCategory.name == record_data["external_category_name"])
                .where(TrainingCategory.active.is_(True))
            )
            category = category_result.scalar_one_or_none()
            if category:
                mapping.internal_category_id = category.id
                mapping.is_mapped = True
                mapping.auto_mapped = True

        self.db.add(mapping)
        return mapping

    # ==========================================
    # Import Operations
    # ==========================================

    async def import_single_record(
        self,
        import_record: ExternalTrainingImport,
        user_id: Optional[str] = None,
        category_id: Optional[str] = None,
        default_category_id: Optional[str] = None,
        created_by: Optional[str] = None,
    ) -> Optional[TrainingRecord]:
        """
        Import a single external training record to create a TrainingRecord.

        Every import path goes through here — sync, upload, and the officer's
        Import and Bulk Import buttons — so a completion is credited the same
        way whichever brought it in.

        Args:
            import_record: The external training import to process
            user_id: Override user ID (if not auto-mapped)
            category_id: The officer's chosen category, which wins outright.
                Callers verify it is in the organization.
            default_category_id: A batch default, used only when neither the
                provider's category mapping nor the mapped course gives one.
                Callers verify it is in the organization.
            created_by: The officer importing, if one is.

        Returns:
            The created TrainingRecord, or None when nothing was created: no
            member (``import_status`` becomes "failed") or the completion is
            already a training record (it becomes "imported", linked to it).
        """
        # Determine user
        target_user_id = user_id or import_record.user_id
        if not target_user_id:
            import_record.import_status = "failed"
            import_record.import_error = "No user mapping found"
            return None

        # The same provider record never becomes two training records. The
        # staged row is unique per record, but a training record can already
        # carry this record id from a staged row that no longer points at it
        # (one the 2026-10-07 upgrade marked duplicate, say), so check the
        # record table too and link to what is already there.
        existing = (
            await self.db.execute(
                select(TrainingRecord)
                .where(TrainingRecord.organization_id == import_record.organization_id)
                .where(TrainingRecord.external_provider_id == import_record.provider_id)
                .where(
                    TrainingRecord.external_record_id
                    == import_record.external_record_id
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing is not None:
            import_record.training_record_id = existing.id
            import_record.import_status = "imported"
            import_record.import_error = None
            import_record.imported_at = datetime.now(timezone.utc)
            return None

        target_course_id = await mapped_course_id(
            self.db,
            import_record.provider_id,
            import_record.organization_id,
            import_record.external_course_id,
        )

        # Determine category: the officer's choice, then the provider's
        # category mapping, then the mapped library course's own category
        # (Target Solutions sends no category, so for it this is usually what
        # decides), then a batch default, then the provider's default.
        target_category_id = category_id
        if not target_category_id and import_record.external_category_id:
            # Look up category mapping
            result = await self.db.execute(
                select(ExternalCategoryMapping)
                .where(ExternalCategoryMapping.provider_id == import_record.provider_id)
                .where(
                    ExternalCategoryMapping.external_category_id
                    == import_record.external_category_id
                )
            )
            mapping = result.scalar_one_or_none()
            if mapping and mapping.internal_category_id:
                target_category_id = mapping.internal_category_id

        if not target_category_id and target_course_id:
            target_category_id = await course_category_id(
                self.db, target_course_id, import_record.organization_id
            )
        if not target_category_id:
            target_category_id = default_category_id

        # If still no category, use provider default
        if not target_category_id:
            provider_result = await self.db.execute(
                select(ExternalTrainingProvider).where(
                    ExternalTrainingProvider.id == import_record.provider_id
                )
            )
            provider = provider_result.scalar_one_or_none()
            if provider:
                target_category_id = provider.default_category_id

        # Build notes from description and import metadata
        notes_parts = []
        if import_record.description:
            notes_parts.append(import_record.description)
        if import_record.score:
            notes_parts.append(f"Score: {import_record.score}")
        notes_parts.append("Imported from external training provider")
        import_notes = ". ".join(notes_parts)

        computed_hours = credited_hours(import_record)

        # Determine training type from external data when available
        training_type = self._map_training_type(import_record.raw_data)

        # Parse expiration date if present in raw data
        raw = import_record.raw_data or {}
        expiration_str = raw.get(
            "expirationDate",
            raw.get("expireDate", raw.get("certExpirationDate")),
        )
        expiration_date = None
        if expiration_str:
            parsed = self._parse_date(expiration_str)
            if parsed:
                expiration_date = parsed.date()

        # Create training record
        training_record = TrainingRecord(
            user_id=target_user_id,
            organization_id=import_record.organization_id,
            course_name=import_record.course_title,
            course_code=import_record.course_code,
            training_type=training_type,
            hours_completed=computed_hours,
            credit_hours=import_record.credit_hours,
            completion_date=(
                import_record.completion_date.date()
                if import_record.completion_date
                else None
            ),
            expiration_date=expiration_date,
            certification_number=raw.get(
                "certificationNumber",
                raw.get("certNumber", raw.get("licenseNumber")),
            ),
            issuing_agency=raw.get(
                "issuingAgency",
                raw.get("issuer", raw.get("certifyingBody")),
            ),
            score=import_record.score,
            passed=import_record.passed,
            status=TrainingStatus.COMPLETED,
            category_id=target_category_id,
            course_id=target_course_id,
            created_by=created_by,
            external_provider_id=import_record.provider_id,
            external_record_id=import_record.external_record_id,
            notes=import_notes,
        )

        self.db.add(training_record)
        await self.db.flush()
        # Refresh server-computed timestamps to prevent MissingGreenlet
        await self.db.refresh(
            training_record, attribute_names=["created_at", "updated_at"]
        )

        # Update import record
        import_record.training_record_id = training_record.id
        import_record.user_id = target_user_id
        import_record.import_status = "imported"
        import_record.import_error = None
        import_record.imported_at = datetime.now(timezone.utc)

        return training_record

    async def upload_target_solutions_report(
        self,
        provider: ExternalTrainingProvider,
        content: str,
        user_id: str,
    ) -> Tuple[ExternalTrainingSyncLog, int, int]:
        """Stage an uploaded completions report and credit matched members.

        The file is the same report the API returns, parsed and staged by the
        same code, so each completion is keyed by its Transcript ID: one that
        an API sync already staged is updated, never added again, and one that
        is already a training record is never credited twice. Rows whose
        member is matched become training records at once; the rest wait
        under Imports for an officer, as they would after a sync.

        Needs no API key or secret, so it works when the API cannot be used.

        Returns the sync log, the number of training records created, and the
        number of rows still waiting for a member.
        """
        if provider.provider_type != ExternalProviderType.TARGET_SOLUTIONS:
            raise ValueError("Report upload is only available for Target Solutions")

        rows = self._parse_target_solutions_report(content, {}, uploaded=True)
        records = [
            record
            for record in map(self._normalize_target_solutions_record, rows)
            if record is not None
        ]
        dates = [
            parsed.date()
            for parsed in (self._parse_date(r.get("completion_date")) for r in records)
            if parsed is not None
        ]

        sync_log = ExternalTrainingSyncLog(
            provider_id=provider.id,
            organization_id=provider.organization_id,
            sync_type=UPLOAD_SYNC_TYPE,
            status=SyncStatus.IN_PROGRESS,
            started_at=datetime.now(timezone.utc),
            sync_from_date=min(dates) if dates else None,
            sync_to_date=max(dates) if dates else None,
            initiated_by=user_id,
        )
        self.db.add(sync_log)
        await self.db.flush()

        await self._stage_records(provider, sync_log, records)
        created, awaiting_member = await self.credit_matched_members(provider, sync_log)
        sync_log.completed_at = datetime.now(timezone.utc)
        return sync_log, created, awaiting_member

    async def credit_matched_members(
        self,
        provider: ExternalTrainingProvider,
        sync_log: ExternalTrainingSyncLog,
    ) -> Tuple[int, int]:
        """Turn this run's matched completions into training records.

        Runs after staging, for API sync and upload alike, so a completion is
        credited the moment its member is known however it arrived. Rows with
        no member wait under Imports. Returns (records created, rows waiting
        for a member).
        """
        await self.db.flush()
        staged = (
            (
                await self.db.execute(
                    select(ExternalTrainingImport)
                    .where(ExternalTrainingImport.provider_id == provider.id)
                    .where(
                        ExternalTrainingImport.organization_id
                        == provider.organization_id
                    )
                    .where(ExternalTrainingImport.sync_log_id == sync_log.id)
                    # Only rows still waiting: never one an officer or the
                    # dedup migration set aside as a duplicate.
                    .where(
                        ExternalTrainingImport.import_status.in_(["pending", "failed"])
                    )
                )
            )
            .scalars()
            .all()
        )
        created: List[TrainingRecord] = []
        awaiting_member = 0
        for import_record in staged:
            if not import_record.user_id:
                awaiting_member += 1
                continue
            training_record = await self.import_single_record(import_record)
            if training_record is not None:
                created.append(training_record)
        await self.feed_imported_records_to_pipelines(created)
        return len(created), awaiting_member

    async def feed_imported_records_to_pipelines(self, records: list) -> None:
        """Advance category-linked pipeline requirements for each imported record.
        A failure on one record is logged and never blocks the rest."""
        if not records:
            return
        from app.services.training_program_service import TrainingProgramService

        program_service = TrainingProgramService(self.db)
        for record in records:
            if not getattr(record, "category_id", None):
                continue
            try:
                await program_service.credit_category_progress(
                    user_id=record.user_id,
                    organization_id=record.organization_id,
                    category_id=record.category_id,
                    hours=float(record.hours_completed or 0),
                    is_course_completion=True,
                    source_id=str(record.id),
                )
            except Exception as e:
                logger.error(
                    f"External→pipeline feed failed for record {record.id}: {e}"
                )

    # ==========================================
    # Mapping Management
    # ==========================================
