"""
Security-review finding (training core, 2026-08-26): two ``User`` lookups in
TrainingService took a client-influenceable ``user_id`` (reachable via a
``training.manage`` officer calling ``/requirements/progress/{user_id}`` or
``/reports/user/{user_id}``, which are gated self-or-officer, not self-or-org)
with no ``organization_id`` filter -- unlike the equivalent lookup in
``get_compliance_summary``, which already org-scopes. An officer in one org
could fetch a foreign org's user row (existence oracle, and the foreign
user's membership_type fed into this org's tier-exemption logic).

These assert against ``stmt.whereclause`` specifically, not the compiled
statement as a whole: ``select(User)`` always projects every User column
(including organization_id) regardless of what it's filtered on, so a bare
``"organization_id" in str(stmt)`` check would pass even without the fix
(CLAUDE.md pitfall: a hollow org-scoping assertion). Checking the WHERE
clause is what actually distinguishes a filtered query from an unfiltered
one.

DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

from app.services.training_service import TrainingService


class _RecordingSession:
    """Async session that records every statement and returns queued results."""

    def __init__(self, results=None):
        self._results = list(results or [])
        self.statements = []
        self.commit = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        self.statements.append(statement)
        return self._results.pop(0) if self._results else MagicMock()


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _first_user_select(statements):
    for stmt in statements:
        if "FROM users" in str(stmt) or "users" in str(stmt).lower():
            return stmt
    return None


class TestGetAllRequirementsProgressUserScoping:
    async def test_the_user_lookup_is_org_scoped(self):
        db = _RecordingSession(results=[_one(None)])  # user not found -> []
        svc = TrainingService(db)

        result = await svc.get_all_requirements_progress(
            user_id="u1", organization_id="org-1"
        )

        assert result == []
        user_stmt = _first_user_select(db.statements)
        assert user_stmt is not None
        assert "organization_id" in str(user_stmt.whereclause)


class TestGenerateTrainingReportTierExemptionUserScoping:
    """generate_training_report's tier-exemption block is deep inside a large,
    heavily-mocked report method -- a behavioral test would need to stub out
    every unrelated query it issues, which is fragile and obscures the one
    thing this guards. Source-inspection is the more robust check here,
    matching the shape used elsewhere in this codebase for a single-line
    invariant inside a large method (e.g. locking guard tests)."""

    def test_the_tier_exemption_user_lookup_is_org_scoped(self):
        import inspect

        source = inspect.getsource(TrainingService.generate_training_report)
        marker = "user_result = await self.db.execute("
        assert marker in source
        # The where() call immediately following the tier-exemption user
        # lookup must filter organization_id, not just _User.id -- grab the
        # ~200 chars after the marker (comfortably past the where(...) call)
        # rather than the whole method, so a later, unrelated User query
        # elsewhere in this large method can't make the assertion pass by
        # accident.
        window = source[source.index(marker) : source.index(marker) + 250]
        assert "_User.organization_id" in window


class TestExpiringCertificationsEnrichmentScoping:
    """GET /training/expiring-certifications' member-name enrichment lookup
    (training.py) -- defense-in-depth: user_ids come from records already
    filtered to this org, so this isn't independently exploitable today, but
    it should still match every other enrichment query in the module."""

    def test_the_enrichment_lookup_is_org_scoped(self):
        import inspect

        from app.api.v1.endpoints.training import get_expiring_certifications_detailed

        source = inspect.getsource(get_expiring_certifications_detailed)
        marker = "users_result = await db.execute("
        assert marker in source
        window = source[source.index(marker) : source.index(marker) + 200]
        assert "organization_id" in window
