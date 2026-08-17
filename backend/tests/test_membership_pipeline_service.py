"""
Membership pipeline service unit tests (MP2 / BXC).

Covers the pass-2 fixes:
- get_prospect populates the flat ProspectResponse.pipeline_name (BXC-2 — the
  applicant detail view renders it; it was always null off the list path).
- create_prospect / update_prospect validate a client-supplied referred_by
  (a User FK) is an in-org member (XC-1 — it wasn't in the protected set).

Mocked session — no DB.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.membership_pipeline import PipelineStepType
from app.services.membership_pipeline_service import MembershipPipelineService


def _get_prospect_db(prospect):
    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = prospect
    db.execute = AsyncMock(return_value=result)
    return db


class TestGetProspectPipelineName:
    async def test_populates_pipeline_name(self):
        prospect = SimpleNamespace(pipeline=SimpleNamespace(name="Recruit Class 2026"))
        db = _get_prospect_db(prospect)
        out = await MembershipPipelineService(db).get_prospect("p1", "org1")
        assert out.pipeline_name == "Recruit Class 2026"

    async def test_no_pipeline_yields_none_name(self):
        prospect = SimpleNamespace(pipeline=None)
        db = _get_prospect_db(prospect)
        out = await MembershipPipelineService(db).get_prospect("p1", "org1")
        assert out.pipeline_name is None

    async def test_missing_prospect_returns_none(self):
        db = _get_prospect_db(None)
        out = await MembershipPipelineService(db).get_prospect("p1", "org1")
        assert out is None


class TestReferredByValidation:
    """The create/update paths validate a client-supplied referred_by (a User
    FK) is in-org via the shared assert_in_org helper."""

    async def test_update_rejects_foreign_referrer(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=SimpleNamespace()
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
            side_effect=ValueError("Invalid referring member"),
        ):
            with pytest.raises(ValueError, match="referring member"):
                await svc.update_prospect("p1", "org1", {"referred_by": "foreign-user"})

    async def test_create_rejects_foreign_referrer(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc,
            "_find_active_prospect_by_email",
            new_callable=AsyncMock,
            return_value=None,
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
            side_effect=ValueError("Invalid referring member"),
        ):
            with pytest.raises(ValueError, match="referring member"):
                await svc.create_prospect(
                    "org1",
                    {
                        "email": "a@b.com",
                        "first_name": "A",
                        "last_name": "B",
                        "referred_by": "foreign-user",
                    },
                    "u1",
                )

    async def test_update_without_referrer_skips_validation(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=SimpleNamespace()
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
        ) as mock_assert, patch.object(
            svc, "_log_activity", new_callable=AsyncMock
        ):
            # main's update guard is `if "referred_by" in data:` — absent key skips.
            await svc.update_prospect("p1", "org1", {})
        mock_assert.assert_not_awaited()


class TestStepEmailTemplateValidation:
    """MP2-5 (pass 4): a step's client-supplied email_template_id (a FK to the
    org-scoped EmailTemplate) is validated in-org on every step writer."""

    async def test_add_step_rejects_foreign_template(self):
        svc = MembershipPipelineService(AsyncMock())
        with patch.object(
            svc,
            "get_pipeline",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(steps=[]),
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
            side_effect=ValueError("Invalid email template"),
        ):
            with pytest.raises(ValueError, match="email template"):
                await svc.add_step(
                    "pipe1",
                    "org1",
                    {"name": "Welcome", "email_template_id": "foreign-template"},
                )

    async def test_create_pipeline_rejects_foreign_step_template(self):
        db = AsyncMock()
        db.add = MagicMock()  # add() is sync; AsyncMock would leave a coroutine
        svc = MembershipPipelineService(db)
        with patch.object(
            svc, "_unset_default_pipeline", new_callable=AsyncMock
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
            side_effect=ValueError("Invalid email template"),
        ):
            with pytest.raises(ValueError, match="email template"):
                await svc.create_pipeline(
                    "org1",
                    name="Recruits",
                    steps=[
                        {"name": "Welcome", "email_template_id": "foreign-template"}
                    ],
                )

    async def test_update_step_without_template_skips_validation(self):
        svc = MembershipPipelineService(AsyncMock())
        # config={} on both old and new so the form-integration reconciliation
        # at the tail of update_step is a no-op (no form method to patch).
        step = SimpleNamespace(id="s1", name="Old", config={})
        with patch.object(
            svc,
            "get_pipeline",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(steps=[step]),
        ), patch(
            "app.services.membership_pipeline_service.assert_in_org",
            new_callable=AsyncMock,
        ) as mock_assert:
            # The update guard is `if "email_template_id" in data:` — absent skips.
            await svc.update_step("s1", "pipe1", "org1", {"name": "Renamed"})
        mock_assert.assert_not_awaited()


class TestProspectDocumentStepValidation:
    """MP2-5 (pass 4): add_prospect_document rejects a client-supplied step_id
    that isn't in the prospect's own pipeline (the MP-5 sibling that was missed)."""

    async def test_foreign_step_rejected(self):
        svc = MembershipPipelineService(AsyncMock())
        prospect = SimpleNamespace(
            pipeline=SimpleNamespace(steps=[SimpleNamespace(id="real-step")])
        )
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=prospect
        ):
            with pytest.raises(ValueError, match="Step does not belong"):
                await svc.add_prospect_document(
                    prospect_id="p1",
                    organization_id="org1",
                    document_type="waiver",
                    file_name="w.pdf",
                    file_path="/app/uploads/w.pdf",
                    step_id="foreign-step",
                )


class TestChecklistStepGate:
    """A checklist stage's gate grades the action_result submitted with the
    completion request, merged over any stored progress row.

    The stored row is only ever written by complete-step itself, so grading
    the stored value alone made a stage with items configured impossible to
    complete legitimately (the KNOWN_LIMITATIONS.md dead end); the gate now
    counts the submitted payload.
    """

    @staticmethod
    def _step(items, require_all=True):
        return SimpleNamespace(
            id="step-1",
            step_type=PipelineStepType.CHECKLIST,
            config={"items": items, "require_all": require_all},
        )

    @staticmethod
    def _prospect(completed):
        return SimpleNamespace(
            step_progress=[
                SimpleNamespace(
                    step_id="step-1",
                    action_result=(
                        {"completed_items": completed}
                        if completed is not None
                        else None
                    ),
                )
            ]
        )

    async def test_refuses_while_items_are_outstanding(self):
        service = MembershipPipelineService(AsyncMock())
        with pytest.raises(ValueError, match="checklist items must be"):
            await service._validate_step_completion(
                self._prospect(["Gear issued"]),
                self._step(["Gear issued", "Station tour", "Radio assigned"]),
            )

    async def test_refuses_when_nothing_has_recorded_progress(self):
        service = MembershipPipelineService(AsyncMock())
        with pytest.raises(ValueError, match="only 0 done"):
            await service._validate_step_completion(
                self._prospect(None),
                self._step(["Gear issued", "Station tour"]),
            )

    async def test_submitted_items_satisfy_the_gate(self):
        """The fix: a first-time completion carrying all items passes even
        though no progress row was ever stored."""
        service = MembershipPipelineService(AsyncMock())
        await service._validate_step_completion(
            self._prospect(None),
            self._step(["Gear issued", "Station tour"]),
            {"completed_items": ["Gear issued", "Station tour"]},
        )

    async def test_submitted_items_refused_when_incomplete(self):
        service = MembershipPipelineService(AsyncMock())
        with pytest.raises(ValueError, match="only 1 done"):
            await service._validate_step_completion(
                self._prospect(None),
                self._step(["Gear issued", "Station tour"]),
                {"completed_items": ["Gear issued"]},
            )

    async def test_submitted_key_wins_over_stored_key(self):
        """Key-level merge: the caller's payload is what gets graded, not a
        stale stored list."""
        service = MembershipPipelineService(AsyncMock())
        with pytest.raises(ValueError, match="only 1 done"):
            await service._validate_step_completion(
                self._prospect(["Gear issued", "Station tour"]),
                self._step(["Gear issued", "Station tour"]),
                {"completed_items": ["Gear issued"]},
            )

    async def test_stored_progress_still_counts_when_nothing_submitted(self):
        service = MembershipPipelineService(AsyncMock())
        await service._validate_step_completion(
            self._prospect(["Gear issued", "Station tour"]),
            self._step(["Gear issued", "Station tour"]),
        )

    async def test_allows_a_stage_with_no_items_configured(self):
        """Which is why the demo pipeline's Onboarding stage still advances."""
        service = MembershipPipelineService(AsyncMock())
        await service._validate_step_completion(self._prospect(None), self._step([]))

    async def test_allows_it_when_require_all_is_off(self):
        service = MembershipPipelineService(AsyncMock())
        await service._validate_step_completion(
            self._prospect(None),
            self._step(["Gear issued"], require_all=False),
        )


class TestMultiApprovalAndReferenceGates:
    """The other two action_result-graded gates accept the submitted payload."""

    @staticmethod
    def _prospect_without_progress():
        return SimpleNamespace(step_progress=[])

    async def test_submitted_approvals_satisfy_the_gate(self):
        service = MembershipPipelineService(AsyncMock())
        step = SimpleNamespace(
            id="step-1",
            step_type=PipelineStepType.MULTI_APPROVAL,
            config={"required_approvers": ["chief", "president"]},
        )
        await service._validate_step_completion(
            self._prospect_without_progress(),
            step,
            {"approvals": [{"role": "chief"}, {"role": "president"}]},
        )

    async def test_missing_approver_still_refused(self):
        service = MembershipPipelineService(AsyncMock())
        step = SimpleNamespace(
            id="step-1",
            step_type=PipelineStepType.MULTI_APPROVAL,
            config={"required_approvers": ["chief", "president"]},
        )
        with pytest.raises(ValueError, match="president"):
            await service._validate_step_completion(
                self._prospect_without_progress(),
                step,
                {"approvals": [{"role": "chief"}]},
            )

    async def test_approval_identity_and_role_come_from_authenticated_signer(self):
        db = AsyncMock()
        query_result = MagicMock()
        query_result.scalar_one_or_none.return_value = SimpleNamespace(
            id="real-chief", positions=[SimpleNamespace(slug="chief", name="Chief")]
        )
        db.execute.return_value = query_result
        service = MembershipPipelineService(db)

        result = await service._authorized_multi_approval_result(
            "org-1",
            "real-chief",
            {"approvals": [{"role": "chief", "approved_by": "forged-user"}]},
        )

        assert result == {"approvals": [{"role": "chief", "approved_by": "real-chief"}]}

    async def test_signer_cannot_claim_another_role(self):
        db = AsyncMock()
        query_result = MagicMock()
        query_result.scalar_one_or_none.return_value = SimpleNamespace(
            id="coordinator",
            positions=[SimpleNamespace(slug="coordinator", name="Coordinator")],
        )
        db.execute.return_value = query_result
        service = MembershipPipelineService(db)

        with pytest.raises(ValueError, match="role you currently hold"):
            await service._authorized_multi_approval_result(
                "org-1", "coordinator", {"approvals": [{"role": "chief"}]}
            )

    async def test_multiple_claimed_signers_are_rejected(self):
        service = MembershipPipelineService(AsyncMock())

        with pytest.raises(ValueError, match="own signer"):
            await service._authorized_multi_approval_result(
                "org-1",
                "chief",
                {"approvals": [{"role": "chief"}, {"role": "president"}]},
            )

    async def test_submitted_references_satisfy_the_gate(self):
        service = MembershipPipelineService(AsyncMock())
        step = SimpleNamespace(
            id="step-1",
            step_type=PipelineStepType.REFERENCE_CHECK,
            config={"required_count": 2, "require_all_before_advance": True},
        )
        await service._validate_step_completion(
            self._prospect_without_progress(),
            step,
            {"references": [{"name": "A"}, {"name": "B"}]},
        )

    async def test_too_few_references_still_refused(self):
        service = MembershipPipelineService(AsyncMock())
        step = SimpleNamespace(
            id="step-1",
            step_type=PipelineStepType.REFERENCE_CHECK,
            config={"required_count": 2, "require_all_before_advance": True},
        )
        with pytest.raises(ValueError, match="only 1 received"):
            await service._validate_step_completion(
                self._prospect_without_progress(),
                step,
                {"references": [{"name": "A"}]},
            )


class TestCompleteStepActionResult:
    """complete_step feeds the submitted action_result into the gate and
    persists the merged view onto the progress row."""

    @staticmethod
    def _checklist_step():
        return SimpleNamespace(
            id="s1",
            step_type=PipelineStepType.CHECKLIST,
            config={"items": ["Gear issued", "Station tour"], "require_all": True},
            is_final_step=False,
            notify_prospect_on_completion=False,
        )

    @classmethod
    def _prospect(cls, step, progress_rows):
        return SimpleNamespace(
            id="p1",
            email=None,
            pipeline=SimpleNamespace(steps=[step], auto_transfer_on_approval=False),
            step_progress=progress_rows,
            current_step_id="s1",
        )

    def _service(self, prospect):
        db = AsyncMock()
        db.add = MagicMock()
        svc = MembershipPipelineService(db)
        patches = [
            patch.object(
                svc, "get_prospect", new_callable=AsyncMock, return_value=prospect
            ),
            patch.object(svc, "_log_activity", new_callable=AsyncMock),
            patch.object(svc, "_advance_current_step", new_callable=AsyncMock),
            patch.object(svc, "_do_transfer", new_callable=AsyncMock),
        ]
        return svc, patches

    async def test_submitted_payload_completes_a_required_checklist(self):
        step = self._checklist_step()
        prospect = self._prospect(step, [])
        svc, patches = self._service(prospect)
        with patches[0], patches[1], patches[2], patches[3]:
            result = await svc.complete_step(
                prospect_id="p1",
                organization_id="org1",
                step_id="s1",
                completed_by="u1",
                action_result={"completed_items": ["Gear issued", "Station tour"]},
            )
        assert result is prospect
        added = svc.db.add.call_args[0][0]
        assert added.action_result == {
            "completed_items": ["Gear issued", "Station tour"]
        }

    async def test_incomplete_payload_is_still_refused(self):
        step = self._checklist_step()
        prospect = self._prospect(step, [])
        svc, patches = self._service(prospect)
        with patches[0], patches[1], patches[2], patches[3]:
            with pytest.raises(ValueError, match="checklist items"):
                await svc.complete_step(
                    prospect_id="p1",
                    organization_id="org1",
                    step_id="s1",
                    completed_by="u1",
                    action_result={"completed_items": ["Gear issued"]},
                )

    async def test_merged_result_is_persisted_over_stored_keys(self):
        step = self._checklist_step()
        existing = SimpleNamespace(
            step_id="s1",
            action_result={"notes_key": "kept", "completed_items": []},
            status=None,
            completed_at=None,
            completed_by=None,
            notes=None,
        )
        prospect = self._prospect(step, [existing])
        svc, patches = self._service(prospect)
        with patches[0], patches[1], patches[2], patches[3]:
            await svc.complete_step(
                prospect_id="p1",
                organization_id="org1",
                step_id="s1",
                completed_by="u1",
                action_result={"completed_items": ["Gear issued", "Station tour"]},
            )
        assert existing.action_result == {
            "notes_key": "kept",
            "completed_items": ["Gear issued", "Station tour"],
        }


class TestSkipNeverTransfers:
    """A skip is a coordinator bypass, not an approval: even when the skipped
    stage still carries is_final_step (e.g. left mid-pipeline by a reorder)
    and auto-transfer is on, skipping must advance — never convert the
    prospect to an active member."""

    @staticmethod
    def _pipeline_with_misplaced_final_flag():
        flagged_mid = SimpleNamespace(
            id="s1",
            sort_order=0,
            step_type=PipelineStepType.CHECKLIST,
            config={"items": ["Vote held"], "require_all": True},
            is_final_step=True,
            notify_prospect_on_completion=False,
        )
        actual_last = SimpleNamespace(
            id="s2",
            sort_order=1,
            step_type=PipelineStepType.CHECKLIST,
            config={},
            is_final_step=False,
            notify_prospect_on_completion=False,
        )
        return SimpleNamespace(
            steps=[flagged_mid, actual_last],
            auto_transfer_on_approval=True,
        )

    def _prospect(self):
        return SimpleNamespace(
            id="p1",
            email=None,
            pipeline=self._pipeline_with_misplaced_final_flag(),
            step_progress=[],
            current_step_id="s1",
        )

    async def test_skip_advances_instead_of_transferring(self):
        prospect = self._prospect()
        db = AsyncMock()
        db.add = MagicMock()
        svc = MembershipPipelineService(db)
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=prospect
        ), patch.object(svc, "_log_activity", new_callable=AsyncMock), patch.object(
            svc, "_advance_current_step", new_callable=AsyncMock
        ) as mock_advance, patch.object(
            svc, "_do_transfer", new_callable=AsyncMock
        ) as mock_transfer:
            result = await svc.skip_current_step(
                "p1", "org1", "coordinator", notes="bypass"
            )
        assert result is prospect
        mock_transfer.assert_not_awaited()
        mock_advance.assert_awaited_once()
        added = db.add.call_args[0][0]
        assert added.action_result == {"skipped": True}

    async def test_genuine_final_completion_still_transfers(self):
        """Regression guard for the other direction: an actual approval of
        the final stage keeps auto-transferring."""
        prospect = self._prospect()
        db = AsyncMock()
        db.add = MagicMock()
        svc = MembershipPipelineService(db)
        with patch.object(
            svc, "get_prospect", new_callable=AsyncMock, return_value=prospect
        ), patch.object(svc, "_log_activity", new_callable=AsyncMock), patch.object(
            svc, "_advance_current_step", new_callable=AsyncMock
        ) as mock_advance, patch.object(
            svc, "_do_transfer", new_callable=AsyncMock
        ) as mock_transfer:
            await svc.complete_step(
                prospect_id="p1",
                organization_id="org1",
                step_id="s1",
                completed_by="u1",
                action_result={"completed_items": ["Vote held"]},
            )
        mock_transfer.assert_awaited_once()
        mock_advance.assert_not_awaited()


class TestGetProspectEagerLoadsWhatValidationReads:
    """`_validate_step_completion` must not trigger a lazy load.

    It counts `prospect.interviews` when the step is an interview_requirement.
    That is a lazy backref, so reading it mid-await raised MissingGreenlet and
    surfaced as a 500 from advance/complete — past the endpoint's ValueError
    handling, which turns real business-rule failures into a 409. Interview is
    the third stage of the default pipeline, so it blocked advancing anyone out
    of it, one at a time or in bulk.
    """

    def test_interviews_is_in_the_eager_load_list(self):
        import inspect as _inspect

        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        source = _inspect.getsource(MembershipPipelineService.get_prospect)

        assert "selectinload(ProspectiveMember.interviews)" in source, (
            "get_prospect must eager-load interviews; _validate_step_completion "
            "reads it and a lazy load there raises MissingGreenlet"
        )

    def test_validation_reads_no_other_unloaded_relationship(self):
        """Guard the audit, not just the one relationship that bit us."""
        import inspect as _inspect
        import re

        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        validator = _inspect.getsource(
            MembershipPipelineService._validate_step_completion
        )
        loaded = _inspect.getsource(MembershipPipelineService.get_prospect)

        # Relationship reads look like getattr(prospect, "name", ...) or
        # prospect.name — collect both and check each is eager-loaded.
        touched = set(re.findall(r'getattr\(\s*prospect,\s*"([a-z_]+)"', validator))
        for name in touched:
            assert f"ProspectiveMember.{name}" in loaded, (
                f"_validate_step_completion reads prospect.{name} but "
                "get_prospect does not eager-load it"
            )
