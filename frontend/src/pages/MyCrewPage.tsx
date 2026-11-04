/**
 * My Crew — the members the signed-in member supervises today.
 *
 * Owner decision 2026-11-01 ("Crew views and approvals"): a line officer sees
 * their crew's training standing and evaluations. The Reports To assignment
 * is the grant, not a permission, and the server answers every read from it,
 * so this page asks for nothing the server would not give: the crew list, each
 * member's compliance summary (the same figure their profile card shows), and
 * the evaluations written about them. Medical records and contact details are
 * not part of crew access and are not fetched here.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ClipboardList, GraduationCap, Users } from 'lucide-react';
import { Breadcrumbs, EmptyState, SkeletonCard } from '../components/ux';
import { useEnabledModules } from '../hooks/useEnabledModules';
import { useCrewStore } from '../hooks/useHasCrew';
import { memberStatusService, trainingService } from '../services/api';
import { evaluationsService } from '../modules/reports/services/evaluationsApi';
import type { EvaluationSummary } from '../modules/reports/types/evaluations';
import { useAuthStore } from '../stores/authStore';
import type { ComplianceSummary } from '../types/training';
import type { CrewMember } from '../types/user';
import { formatCalendarDate } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';

const STANDING_CLASSES: Record<ComplianceSummary['compliance_status'], string> = {
  green: 'bg-green-500/10 text-green-800 dark:text-green-300',
  yellow: 'bg-amber-500/10 text-amber-800 dark:text-amber-300',
  red: 'bg-red-500/10 text-red-800 dark:text-red-300',
  exempt: 'bg-theme-surface-secondary text-theme-text-secondary',
  not_applicable: 'bg-theme-surface-secondary text-theme-text-secondary',
};

const MyCrewPage: React.FC = () => {
  const userId = useAuthStore((s) => s.user?.id);
  const rememberCrew = useCrewStore((s) => s.remember);
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const trainingOn = !modulesLoading && isModuleOn('training');
  const reportsOn = !modulesLoading && isModuleOn('reports');

  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [standing, setStanding] = useState<Record<string, ComplianceSummary | null>>({});
  const [evaluations, setEvaluations] = useState<EvaluationSummary[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const members = await memberStatusService.getMyCrew();
      setCrew(members);
      if (userId) rememberCrew(userId, members.length > 0);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Your crew could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [userId, rememberCrew]);

  useEffect(() => {
    void load();
  }, [load]);

  // Each member's standing is fetched on its own, so one that fails shows a
  // dash rather than taking the whole crew down.
  useEffect(() => {
    if (!trainingOn || crew.length === 0) return;
    let cancelled = false;
    void Promise.allSettled(crew.map((m) => trainingService.getComplianceSummary(m.id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, ComplianceSummary | null> = {};
      results.forEach((result, index) => {
        const member = crew[index];
        if (member) next[member.id] = result.status === 'fulfilled' ? result.value : null;
      });
      setStanding(next);
    });
    return () => {
      cancelled = true;
    };
  }, [crew, trainingOn]);

  useEffect(() => {
    if (!reportsOn || crew.length === 0) return;
    let cancelled = false;
    evaluationsService
      .crew()
      .then((found) => {
        if (!cancelled) setEvaluations(found);
      })
      .catch(() => {
        // The section is simply left out when evaluations cannot be read.
        if (!cancelled) setEvaluations(null);
      });
    return () => {
      cancelled = true;
    };
  }, [crew, reportsOn]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="text-theme-text-primary text-2xl font-bold">My Crew</h1>
      <p className="text-theme-text-muted mt-1 mb-6 text-sm">
        The members who report to you today. You can read their training standing and their evaluations once each is
        released to them.
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
      ) : crew.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody reports to you"
          description="Members appear here once a members manager names you as their supervisor on their profile."
        />
      ) : (
        <>
          <ul className="card-grid" aria-label="Your crew">
            {crew.map((member) => {
              const summary = standing[member.id];
              return (
                <li key={member.id} className="card p-4">
                  <h2 className="text-theme-text-primary text-base font-semibold">
                    <Link to={`/members/${member.id}`} className="hover:underline">
                      {member.name}
                    </Link>
                  </h2>
                  <p className="text-theme-text-muted text-sm">
                    {[member.rank, member.station].filter(Boolean).join(' · ') || 'No rank or station recorded'}
                  </p>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Reports to you since {formatCalendarDate(member.supervised_since)}
                  </p>
                  {trainingOn && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      {summary ? (
                        <>
                          <span className={`badge ${STANDING_CLASSES[summary.compliance_status]}`}>
                            {summary.compliance_label}
                          </span>
                          {summary.requirements_total > 0 && (
                            <span className="text-theme-text-secondary">
                              {summary.requirements_met} of {summary.requirements_total} requirements met
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-theme-text-muted">
                          {member.id in standing ? 'Training standing unavailable' : 'Loading training standing…'}
                        </span>
                      )}
                    </div>
                  )}
                  {trainingOn && (
                    <div className="mt-3">
                      <Link
                        to={`/members/${member.id}/training`}
                        className="btn-secondary mobile-touch-target inline-flex items-center gap-1.5 px-3 text-sm"
                      >
                        <GraduationCap className="h-4 w-4" aria-hidden="true" /> Training records
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {reportsOn && evaluations !== null && (
            <section className="mt-8" aria-labelledby="crew-evaluations">
              <h2 id="crew-evaluations" className="text-theme-text-primary mb-3 text-lg font-semibold">
                Evaluations
              </h2>
              {evaluations.length === 0 ? (
                <p className="text-theme-text-muted text-sm">No evaluations have been written for your crew.</p>
              ) : (
                <ul className="space-y-2">
                  {evaluations.map((evaluation) => (
                    <li key={evaluation.id} className="card flex flex-wrap items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="text-theme-text-primary text-sm font-medium">
                          {evaluation.member.name} — {evaluation.template_name}
                        </p>
                        <p className="text-theme-text-muted text-xs">
                          {evaluation.period_name ??
                            `${formatCalendarDate(evaluation.period_start)} – ${formatCalendarDate(evaluation.period_end)}`}
                          {' · '}
                          {evaluation.status === 'finalized'
                            ? 'Finalized'
                            : `In progress${evaluation.current_step ? `: ${evaluation.current_step}` : ''}`}
                        </p>
                      </div>
                      <Link
                        to={`/reports/evaluations/${evaluation.id}`}
                        className="btn-secondary mobile-touch-target inline-flex items-center gap-1.5 px-3 text-sm"
                      >
                        <ClipboardList className="h-4 w-4" aria-hidden="true" /> Open
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default MyCrewPage;
