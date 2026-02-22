"""
External Training Sync Service

Business logic for syncing training records from external providers
like Vector Solutions, Target Solutions, Lexipol, etc.
"""

from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, date, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
import httpx
import logging

from app.models.training import (
    ExternalTrainingProvider,
    ExternalCategoryMapping,
    ExternalUserMapping,
    ExternalTrainingSyncLog,
    ExternalTrainingImport,
    ExternalProviderType,
    SyncStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingCategory,
)
from app.models.user import User
from app.core.security import decrypt_data


logger = logging.getLogger(__name__)


class ExternalTrainingSyncService:
    """Service for syncing training records from external providers"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.http_client = httpx.AsyncClient(timeout=30.0)

    async def close(self):
        """Close HTTP client connections"""
        await self.http_client.aclose()

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
            return False, f"Failed to connect: {str(e)}"
        except Exception as e:
            logger.exception(f"Error testing connection for provider {provider.id}")
            return False, f"Connection test failed: {str(e)}"

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
        test_url = f"{provider.api_base_url.rstrip('/')}/sites"

        response = await self.http_client.get(test_url, headers=headers)

        if response.status_code == 200:
            data = response.json()
            sites = data if isinstance(data, list) else data.get("sites", data.get("data", []))
            site_id = config.get("site_id")

            if site_id:
                # Verify the configured site_id is accessible
                site_ids = [str(s.get("id", s.get("siteId", ""))) for s in sites] if isinstance(sites, list) else []
                if site_ids and site_id not in site_ids:
                    return False, f"Connection successful but site_id '{site_id}' not found in accessible sites: {', '.join(site_ids)}"
                return True, f"Connection successful - site '{site_id}' verified"
            else:
                # No site_id configured yet - report available sites
                site_count = len(sites) if isinstance(sites, list) else 0
                return True, f"Connection successful - {site_count} site(s) accessible. Configure site_id in provider settings to enable sync."
        elif response.status_code == 401:
            return False, "Authentication failed - check your AccessToken"
        elif response.status_code == 403:
            return False, "Access denied - your token may not have sufficient permissions"
        else:
            return False, f"Unexpected response: {response.status_code}"

    async def _test_target_solutions_connection(
        self, provider: ExternalTrainingProvider
    ) -> Tuple[bool, str]:
        """Test Target Solutions API connection"""
        if not provider.api_base_url or not provider.api_key:
            return False, "API base URL and API key are required"

        headers = self._get_auth_headers(provider)
        test_url = f"{provider.api_base_url.rstrip('/')}/api/health"

        response = await self.http_client.get(test_url, headers=headers)

        if response.status_code == 200:
            return True, "Connection successful"
        elif response.status_code == 401:
            return False, "Authentication failed - check API key"
        else:
            return False, f"Unexpected response: {response.status_code}"

    async def _test_lexipol_connection(
        self, provider: ExternalTrainingProvider
    ) -> Tuple[bool, str]:
        """Test Lexipol API connection"""
        if not provider.api_base_url:
            return False, "API base URL is required"

        headers = self._get_auth_headers(provider)
        test_url = f"{provider.api_base_url.rstrip('/')}/api/v1/status"

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
        test_url = f"{provider.api_base_url.rstrip('/')}/api/v1/account"

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
        test_url = f"{provider.api_base_url.rstrip('/')}{test_endpoint}"

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
        except Exception:
            # If decryption fails, the value may be stored in plaintext (pre-encryption migration)
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

        # Vector Solutions / TargetSolutions uses a custom AccessToken header
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
                from_date = (provider.last_sync_at or datetime.now(timezone.utc) - timedelta(days=30)).date()
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

            # Process each record
            imported = 0
            updated = 0
            skipped = 0
            failed = 0

            for record_data in records:
                try:
                    result = await self._process_external_record(
                        provider, sync_log.id, record_data
                    )
                    if result == "imported":
                        imported += 1
                    elif result == "updated":
                        updated += 1
                    elif result == "skipped":
                        skipped += 1
                except Exception as e:
                    logger.error(f"Error processing record: {e}")
                    failed += 1

            # Update sync log
            sync_log.records_imported = imported
            sync_log.records_updated = updated
            sync_log.records_skipped = skipped
            sync_log.records_failed = failed
            sync_log.status = SyncStatus.COMPLETED if failed == 0 else SyncStatus.PARTIAL
            sync_log.completed_at = datetime.now(timezone.utc)

            # Update provider sync timestamps
            provider.last_sync_at = datetime.now(timezone.utc)
            if provider.auto_sync_enabled:
                provider.next_sync_at = datetime.now(timezone.utc) + timedelta(hours=provider.sync_interval_hours)

            await self.db.commit()

        except Exception as e:
            logger.exception(f"Sync failed for provider {provider.id}")
            sync_log.status = SyncStatus.FAILED
            sync_log.error_message = str(e)
            sync_log.completed_at = datetime.now(timezone.utc)
            await self.db.commit()

        return sync_log

    async def _fetch_external_records(
        self,
        provider: ExternalTrainingProvider,
        from_date: date,
        to_date: date,
    ) -> List[Dict[str, Any]]:
        """Fetch training records from external provider"""
        if provider.provider_type == ExternalProviderType.VECTOR_SOLUTIONS:
            return await self._fetch_vector_solutions_records(provider, from_date, to_date)
        elif provider.provider_type == ExternalProviderType.TARGET_SOLUTIONS:
            return await self._fetch_target_solutions_records(provider, from_date, to_date)
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
        - Pagination: startrow & limit params (max 1000 per page)
        - Date filtering via query params
        - Response is JSON
        """
        headers = self._get_auth_headers(provider)
        config = provider.config or {}
        site_id = self._get_vector_site_id(provider)

        # Use configured endpoint or default to credentials (training completions)
        records_endpoint = config.get(
            "records_endpoint",
            f"/sites/{site_id}/credentials"
        )
        # If the endpoint doesn't already include the site_id, prepend it
        if "{siteId}" in records_endpoint:
            records_endpoint = records_endpoint.replace("{siteId}", site_id)
        elif not records_endpoint.startswith(f"/sites/{site_id}"):
            records_endpoint = f"/sites/{site_id}/{records_endpoint.lstrip('/')}"

        url = f"{provider.api_base_url.rstrip('/')}{records_endpoint}"

        # Vector Solutions uses startrow/limit pagination (max 1000)
        page_size = min(int(config.get("page_size", 1000)), 1000)

        params: Dict[str, Any] = {
            "limit": page_size,
        }

        # Add date filtering if the API supports it
        date_filter = config.get("date_filter_param")
        if date_filter:
            params[date_filter] = from_date.isoformat()
        else:
            # Use search query for date filtering
            params["q"] = f'{{"completionDate":"{from_date.isoformat()}..{to_date.isoformat()}"}}'

        all_records = []
        startrow = 0

        while True:
            params["startrow"] = startrow
            response = await self.http_client.get(url, headers=headers, params=params)
            response.raise_for_status()

            data = response.json()
            records = data if isinstance(data, list) else data.get("data", data.get("credentials", data.get("records", [])))

            if not records:
                break

            for record in records:
                all_records.append(self._normalize_vector_solutions_record(record))

            # Vector Solutions returns fewer than limit when no more pages
            if len(records) < page_size:
                break
            startrow += page_size

        return all_records

    def _normalize_vector_solutions_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
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
            "external_record_id": str(record.get("id", record.get("credentialId", record.get("completionId", "")))),
            "external_user_id": str(record.get("userId", record.get("employeeId", record.get("user_id", "")))),
            "external_course_id": str(record.get("courseId", record.get("course_id", ""))),
            "external_category_id": str(record.get("categoryId", record.get("category_id", ""))),
            "course_title": record.get("courseName", record.get("courseTitle", record.get("name", ""))),
            "course_code": record.get("courseCode", record.get("code", "")),
            "description": record.get("description", record.get("courseDescription", "")),
            "duration_minutes": record.get("durationMinutes", record.get("duration", record.get("creditMinutes", 0))),
            "completion_date": record.get("completionDate", record.get("completedDate", record.get("dateCompleted"))),
            "score": record.get("score", record.get("percentScore", record.get("finalScore"))),
            "passed": record.get("passed", record.get("isPassed", record.get("status", "").lower() in ("passed", "completed", "complete"))),
            "external_category_name": record.get("categoryName", record.get("category", "")),
            "external_username": record.get("username", record.get("loginName", "")),
            "external_email": record.get("email", record.get("userEmail", "")),
            "external_name": full_name,
            "raw_data": record,
        }

    async def _fetch_target_solutions_records(
        self,
        provider: ExternalTrainingProvider,
        from_date: date,
        to_date: date,
    ) -> List[Dict[str, Any]]:
        """Fetch records from Target Solutions API"""
        headers = self._get_auth_headers(provider)
        config = provider.config or {}

        records_endpoint = config.get("records_endpoint", "/api/v2/training/completions")
        url = f"{provider.api_base_url.rstrip('/')}{records_endpoint}"

        params = {
            "fromDate": from_date.isoformat(),
            "toDate": to_date.isoformat(),
            "limit": 100,
            "offset": 0,
        }

        all_records = []

        while True:
            response = await self.http_client.get(url, headers=headers, params=params)
            response.raise_for_status()

            data = response.json()
            records = data.get("items", data.get("data", []))

            if not records:
                break

            for record in records:
                all_records.append(self._normalize_target_solutions_record(record))

            if len(records) < params["limit"]:
                break
            params["offset"] += params["limit"]

        return all_records

    def _normalize_target_solutions_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize Target Solutions record to standard format"""
        return {
            "external_record_id": str(record.get("id", "")),
            "external_user_id": str(record.get("userId", record.get("employeeId", ""))),
            "external_course_id": str(record.get("courseId", "")),
            "external_category_id": str(record.get("categoryId", "")),
            "course_title": record.get("courseName", record.get("courseTitle", "")),
            "course_code": record.get("courseCode", ""),
            "description": record.get("courseDescription", ""),
            "duration_minutes": record.get("durationMinutes", 0),
            "completion_date": record.get("completionDate", record.get("completedOn")),
            "score": record.get("score", record.get("percentScore")),
            "passed": record.get("passed", record.get("isPassed", True)),
            "external_category_name": record.get("categoryName", ""),
            "external_username": record.get("username", ""),
            "external_email": record.get("email", record.get("userEmail", "")),
            "external_name": record.get("userName", record.get("displayName", "")),
            "raw_data": record,
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
        url = f"{provider.api_base_url.rstrip('/')}{records_endpoint}"

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
            "external_category_name": record.get("topicName", record.get("category", "")),
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
        url = f"{provider.api_base_url.rstrip('/')}{records_endpoint}"

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
            "external_category_name": record.get("type", record.get("training_type", "")),
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
        url = f"{provider.api_base_url.rstrip('/')}{records_endpoint}"

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
            "external_record_id": str(get_field("external_record_id", record.get("id", ""))),
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
        # Check if record already exists
        existing = await self.db.execute(
            select(ExternalTrainingImport)
            .where(ExternalTrainingImport.provider_id == provider.id)
            .where(ExternalTrainingImport.external_record_id == record_data["external_record_id"])
        )
        existing_import = existing.scalar_one_or_none()

        if existing_import:
            # Update existing record
            for key, value in record_data.items():
                if key != "raw_data" and hasattr(existing_import, key):
                    setattr(existing_import, key, value)
            existing_import.raw_data = record_data.get("raw_data")
            existing_import.sync_log_id = sync_log_id
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

        # Try to auto-map category
        if record_data.get("external_category_id"):
            await self._find_or_create_category_mapping(provider, record_data)

        self.db.add(import_record)
        return "imported"

    def _parse_date(self, date_value: Any) -> Optional[datetime]:
        """Parse various date formats to datetime"""
        if not date_value:
            return None
        if isinstance(date_value, datetime):
            return date_value
        if isinstance(date_value, date):
            return datetime.combine(date_value, datetime.min.time())
        if isinstance(date_value, str):
            # Try common formats
            for fmt in [
                "%Y-%m-%dT%H:%M:%S.%fZ",
                "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d",
                "%m/%d/%Y",
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

        if mapping:
            return mapping

        # Create new mapping
        mapping = ExternalUserMapping(
            provider_id=provider.id,
            organization_id=provider.organization_id,
            external_user_id=external_user_id,
            external_username=record_data.get("external_username"),
            external_email=record_data.get("external_email"),
            external_name=record_data.get("external_name"),
            is_mapped=False,
            auto_mapped=False,
        )

        # Try to auto-map by email
        if record_data.get("external_email"):
            user_result = await self.db.execute(
                select(User)
                .where(User.organization_id == provider.organization_id)
                .where(User.email == record_data["external_email"])
            )
            user = user_result.scalar_one_or_none()
            if user:
                mapping.internal_user_id = user.id
                mapping.is_mapped = True
                mapping.auto_mapped = True

        self.db.add(mapping)
        return mapping

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
                .where(TrainingCategory.active == True)  # noqa: E712
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
    ) -> TrainingRecord:
        """
        Import a single external training record to create a TrainingRecord.

        Args:
            import_record: The external training import to process
            user_id: Override user ID (if not auto-mapped)
            category_id: Override category ID (if not auto-mapped)

        Returns:
            Created TrainingRecord
        """
        # Determine user
        target_user_id = user_id or import_record.user_id
        if not target_user_id:
            import_record.import_status = "failed"
            import_record.import_error = "No user mapping found"
            return None

        # Determine category
        target_category_id = category_id
        if not target_category_id and import_record.external_category_id:
            # Look up category mapping
            result = await self.db.execute(
                select(ExternalCategoryMapping)
                .where(ExternalCategoryMapping.provider_id == import_record.provider_id)
                .where(ExternalCategoryMapping.external_category_id == import_record.external_category_id)
            )
            mapping = result.scalar_one_or_none()
            if mapping and mapping.internal_category_id:
                target_category_id = mapping.internal_category_id

        # If still no category, use provider default
        if not target_category_id:
            provider_result = await self.db.execute(
                select(ExternalTrainingProvider)
                .where(ExternalTrainingProvider.id == import_record.provider_id)
            )
            provider = provider_result.scalar_one_or_none()
            if provider:
                target_category_id = provider.default_category_id

        # Create training record
        training_record = TrainingRecord(
            user_id=target_user_id,
            organization_id=import_record.organization_id,
            title=import_record.course_title,
            description=import_record.description,
            hours_completed=round((import_record.duration_minutes or 0) / 60.0, 2),
            completion_date=import_record.completion_date.date() if import_record.completion_date else None,
            status=TrainingStatus.COMPLETED,
            category_id=target_category_id,
            external_provider_id=import_record.provider_id,
            external_record_id=import_record.external_record_id,
            notes=f"Imported from external training provider. Score: {import_record.score}" if import_record.score else "Imported from external training provider",
        )

        self.db.add(training_record)
        await self.db.flush()

        # Update import record
        import_record.training_record_id = training_record.id
        import_record.import_status = "imported"
        import_record.imported_at = datetime.now(timezone.utc)

        return training_record

    async def bulk_import_records(
        self,
        provider_id: str,
        import_ids: Optional[List[str]] = None,
        import_all_pending: bool = False,
    ) -> Dict[str, int]:
        """
        Bulk import multiple external training records.

        Args:
            provider_id: Provider ID
            import_ids: Specific import IDs to process
            import_all_pending: Import all pending records for the provider

        Returns:
            Dict with counts: imported, failed, skipped
        """
        query = (
            select(ExternalTrainingImport)
            .where(ExternalTrainingImport.provider_id == str(provider_id))
        )

        if import_ids:
            query = query.where(ExternalTrainingImport.id.in_(import_ids))
        elif import_all_pending:
            query = query.where(ExternalTrainingImport.import_status == "pending")
            # Only import records that have a user mapping
            query = query.where(ExternalTrainingImport.user_id.isnot(None))

        result = await self.db.execute(query)
        imports = result.scalars().all()

        imported = 0
        failed = 0
        skipped = 0

        for import_record in imports:
            if import_record.import_status == "imported":
                skipped += 1
                continue

            if not import_record.user_id:
                import_record.import_status = "skipped"
                import_record.import_error = "No user mapping"
                skipped += 1
                continue

            try:
                await self.import_single_record(import_record)
                imported += 1
            except Exception as e:
                import_record.import_status = "failed"
                import_record.import_error = str(e)
                failed += 1

        await self.db.commit()

        return {
            "imported": imported,
            "failed": failed,
            "skipped": skipped,
        }

    # ==========================================
    # Mapping Management
    # ==========================================

    async def get_unmapped_users(
        self, provider_id: str
    ) -> List[ExternalUserMapping]:
        """Get all unmapped users for a provider"""
        result = await self.db.execute(
            select(ExternalUserMapping)
            .where(ExternalUserMapping.provider_id == str(provider_id))
            .where(ExternalUserMapping.is_mapped == False)  # noqa: E712
        )
        return result.scalars().all()

    async def get_unmapped_categories(
        self, provider_id: str
    ) -> List[ExternalCategoryMapping]:
        """Get all unmapped categories for a provider"""
        result = await self.db.execute(
            select(ExternalCategoryMapping)
            .where(ExternalCategoryMapping.provider_id == str(provider_id))
            .where(ExternalCategoryMapping.is_mapped == False)  # noqa: E712
        )
        return result.scalars().all()

    async def map_user(
        self,
        mapping_id: str,
        internal_user_id: str,
        mapped_by: Optional[str] = None,
    ) -> ExternalUserMapping:
        """Map an external user to an internal user"""
        result = await self.db.execute(
            select(ExternalUserMapping)
            .where(ExternalUserMapping.id == str(mapping_id))
        )
        mapping = result.scalar_one_or_none()

        if not mapping:
            raise ValueError("User mapping not found")

        mapping.internal_user_id = internal_user_id
        mapping.is_mapped = True
        mapping.auto_mapped = False
        mapping.mapped_by = mapped_by

        # Update any pending imports with this user
        await self.db.execute(
            ExternalTrainingImport.__table__.update()
            .where(ExternalTrainingImport.provider_id == mapping.provider_id)
            .where(ExternalTrainingImport.external_user_id == mapping.external_user_id)
            .where(ExternalTrainingImport.user_id.is_(None))
            .values(user_id=internal_user_id)
        )

        await self.db.commit()
        return mapping

    async def map_category(
        self,
        mapping_id: str,
        internal_category_id: str,
        mapped_by: Optional[str] = None,
    ) -> ExternalCategoryMapping:
        """Map an external category to an internal category"""
        result = await self.db.execute(
            select(ExternalCategoryMapping)
            .where(ExternalCategoryMapping.id == str(mapping_id))
        )
        mapping = result.scalar_one_or_none()

        if not mapping:
            raise ValueError("Category mapping not found")

        mapping.internal_category_id = internal_category_id
        mapping.is_mapped = True
        mapping.auto_mapped = False
        mapping.mapped_by = mapped_by

        await self.db.commit()
        return mapping
