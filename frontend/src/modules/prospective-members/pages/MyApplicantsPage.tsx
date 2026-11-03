/**
 * My Applicants — the applicants the signed-in member is assigned to.
 *
 * A case manager or interviewer reaches their applicants here. The pipeline
 * page needs prospective_members.manage, which an interviewer such as a board
 * member or a trustee does not hold; the assignment is their grant, and the
 * server lists only the applicants it covers. Opening one shows the applicant
 * with the actions this member may take on them, as the server reports them.
 *
 * `?applicant=<id>` opens that applicant on arrival: it is the link the
 * assignment email carries.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MessageSquare, UserCheck } from 'lucide-react';
import { Breadcrumbs, EmptyState, SkeletonCard } from '../../../components/ux';
import { getErrorMessage } from '../../../utils/errorHandling';
import { applicantService, pipelineService } from '../services/api';
import type { Applicant, ApplicantListItem, Pipeline } from '../types';
import { ASSIGNMENT_ROLE_LABELS } from '../constants';
import { isConvertStage } from '../utils';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { ApplicantDetailDialog } from '../components/ApplicantDetailDialog';
import { ConversionModal } from '../components/ConversionModal';
import { useAssignedApplicantsStore } from '../hooks/useHasAssignedApplicants';
import { useAuthStore } from '../../../stores/authStore';

const MyApplicantsPage: React.FC = () => {
  const [items, setItems] = useState<ApplicantListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [converting, setConverting] = useState<Applicant | null>(null);
  const currentApplicant = useProspectiveMembersStore((s) => s.currentApplicant);
  const fetchApplicant = useProspectiveMembersStore((s) => s.fetchApplicant);
  const userId = useAuthStore((s) => s.user?.id);
  const rememberAssigned = useAssignedApplicantsStore((s) => s.remember);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const found = await applicantService.getMyApplicants();
      setItems(found);
      if (userId) rememberAssigned(userId, found.length > 0);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Your applicants could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [userId, rememberAssigned]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(
    (id: string) => {
      setDialogOpen(true);
      void fetchApplicant(id);
    },
    [fetchApplicant]
  );

  const requested = searchParams.get('applicant');
  useEffect(() => {
    if (!requested) return;
    open(requested);
    const next = new URLSearchParams(searchParams);
    next.delete('applicant');
    setSearchParams(next, { replace: true });
  }, [requested, open, searchParams, setSearchParams]);

  // The dialog needs the applicant's pipeline to tell its first and last
  // stages apart; the pipeline is readable to anyone assigned to an applicant.
  const pipelineId = dialogOpen ? currentApplicant?.pipeline_id : undefined;
  useEffect(() => {
    if (!pipelineId) return undefined;
    let cancelled = false;
    pipelineService
      .getPipeline(pipelineId)
      .then((result) => {
        if (!cancelled) setPipeline(result);
      })
      .catch(() => {
        if (!cancelled) setPipeline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineId]);

  const stages = useMemo(
    () => (pipeline ? [...pipeline.stages].sort((a, b) => a.sort_order - b.sort_order) : []),
    [pipeline]
  );
  const isLastStage = !!currentApplicant && isConvertStage(stages, currentApplicant.current_stage_id);
  const isFirstStage = !currentApplicant || stages[0]?.id === currentApplicant.current_stage_id;

  const close = () => {
    setDialogOpen(false);
    void load();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="text-theme-text-primary text-2xl font-bold">My Applicants</h1>
      <p className="text-theme-text-muted mt-1 mb-6 text-sm">
        Applicants you are assigned to as case manager or interviewer.
      </p>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : loadError ? (
        <div className="alert-danger flex flex-wrap items-center gap-2" role="alert">
          <span className="min-w-0 flex-1 text-sm">{loadError}</span>
          <button type="button" className="btn-secondary mobile-touch-target px-3 text-sm" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="You are not assigned to any applicants"
          description="When a coordinator assigns you to an applicant as case manager or interviewer, they will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-theme-text-primary text-base font-semibold">
                    {item.first_name} {item.last_name}
                  </h2>
                  <p className="text-theme-text-muted text-sm">{item.current_stage_name ?? 'Not on a stage'}</p>
                </div>
                <ul className="flex flex-wrap gap-1.5" aria-label="Your roles">
                  {(item.my_roles ?? []).map((role) => (
                    <li key={role} className="badge bg-theme-surface-secondary text-theme-text-secondary">
                      {ASSIGNMENT_ROLE_LABELS[role]}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary px-4 text-sm" onClick={() => open(item.id)}>
                  Open
                </button>
                <Link
                  to={`/prospective-members/${item.id}/interview`}
                  className="btn-secondary inline-flex items-center gap-1.5 px-4 text-sm"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Interview
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ApplicantDetailDialog
        applicant={currentApplicant}
        isOpen={dialogOpen}
        onClose={close}
        onConvert={(applicant) => setConverting(applicant)}
        isLastStage={isLastStage}
        isFirstStage={isFirstStage}
      />
      <ConversionModal isOpen={!!converting} onClose={() => setConverting(null)} applicant={converting} />
    </div>
  );
};

export default MyApplicantsPage;
