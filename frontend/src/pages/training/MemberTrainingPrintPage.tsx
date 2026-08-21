/**
 * Printable Member Training Record
 *
 * Paper-formatted training history for a member, designed for
 * letter-size printing. Includes compliance summary, certifications,
 * training hours, and complete course history.
 *
 * URL: /training/print/member?id=<user_id>&name=<name>
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { trainingService, trainingProgramService } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatDateCustom } from '../../utils/dateFormatting';
import type { TrainingRecord, ComplianceSummary, UserTrainingStats, ProgramEnrollment } from '../../types/training';
import PrintPageStyles from '../../components/print/PrintPageStyles';

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  scheduled: 'Scheduled',
  expired: 'Expired',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

const MemberTrainingPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('id') || '';
  const memberName = searchParams.get('name') || 'Member';
  const tz = useTimezone();

  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [stats, setStats] = useState<UserTrainingStats | null>(null);
  const [compliance, setCompliance] = useState<ComplianceSummary | null>(null);
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) {
      setError('No member ID provided');
      setLoading(false);
      return;
    }
    Promise.all([
      trainingService.getRecords({ user_id: userId }).catch(() => []),
      trainingService.getUserStats(userId).catch(() => null),
      trainingService.getComplianceSummary(userId).catch(() => null),
      trainingProgramService.getUserEnrollments(userId).catch(() => []),
    ])
      .then(([recs, st, comp, enr]) => {
        setRecords(recs);
        setStats(st);
        setCompliance(comp);
        setEnrollments(enr);
      })
      .catch(() => setError('Failed to load training data'))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    if (loading || error) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loading, error]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center" aria-busy="true">
        <p className="text-gray-500" role="status" aria-live="polite">
          Loading training records...
        </p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-red-600" role="alert">
          {error}
        </p>
      </main>
    );
  }

  const certifications = records.filter((r) => r.certification_number || r.training_type === 'certification');
  const courseRecords = records.filter((r) => r.training_type !== 'certification' || !r.certification_number);
  const fmtDate = (d?: string) =>
    d ? formatDateCustom(d, { month: 'short', day: 'numeric', year: 'numeric' }, tz) : '—';

  const generatedDate = formatDate(new Date(), tz);
  const complianceClass = compliance ? `member-training-print__compliance--${compliance.compliance_status}` : '';

  return (
    <>
      <PrintPageStyles margin="0.5in 0.6in" />

      <main className="member-training-print-shell">
        <article className="member-training-print" aria-labelledby="training-record-title">
          {/* Header */}
          <header className="member-training-print__header">
            <div className="member-training-print__header-layout">
              <div>
                <h1 id="training-record-title">Training Record</h1>
                <p className="member-training-print__member">{memberName}</p>
              </div>
              <div className="member-training-print__metadata">
                <p>Generated: {generatedDate}</p>
                {compliance && (
                  <p className={`member-training-print__compliance ${complianceClass}`}>
                    Compliance: {compliance.compliance_label || compliance.compliance_status.toUpperCase()}
                  </p>
                )}
              </div>
            </div>
          </header>

          {/* Summary Stats */}
          {stats && (
            <dl className="member-training-print__stats" aria-label="Training summary">
              {[
                { label: 'Total Hours', value: stats.total_hours },
                { label: 'Hours This Year', value: stats.hours_this_year },
                { label: 'Active Certifications', value: stats.active_certifications },
                { label: 'Completed Courses', value: stats.completed_courses },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {/* Compliance Summary */}
          {compliance && (
            <dl className="member-training-print__summary" aria-label="Compliance summary">
              <div>
                <dt>Requirements Met</dt>
                <dd>
                  {compliance.requirements_met} / {compliance.requirements_total}
                </dd>
              </div>
              <div>
                <dt>Expiring Soon</dt>
                <dd>{compliance.certs_expiring_soon}</dd>
              </div>
              <div>
                <dt>Expired</dt>
                <dd>{compliance.certs_expired}</dd>
              </div>
            </dl>
          )}

          {/* Active Program Enrollments */}
          {enrollments.length > 0 && (
            <section className="member-training-print__section" aria-labelledby="program-enrollments-heading">
              <h2 id="program-enrollments-heading">Program Enrollments</h2>
              <div
                className="member-training-print__table-scroll"
                role="region"
                aria-label="Program enrollments"
                tabIndex={0}
              >
                <table>
                  <caption className="sr-only">Active training program enrollments</caption>
                  <thead>
                    <tr>
                      <th scope="col">Program</th>
                      <th scope="col">Status</th>
                      <th scope="col">Progress</th>
                      <th scope="col">Enrolled</th>
                      <th scope="col">Target Completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollments.map((e) => (
                      <tr key={e.id}>
                        <td>{e.program?.name || '—'}</td>
                        <td>{e.status}</td>
                        <td>{Math.round(e.progress_percentage)}%</td>
                        <td>{fmtDate(e.enrolled_at)}</td>
                        <td>{fmtDate(e.target_completion_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Certifications */}
          {certifications.length > 0 && (
            <section className="member-training-print__section" aria-labelledby="certifications-heading">
              <h2 id="certifications-heading">Certifications</h2>
              <div
                className="member-training-print__table-scroll"
                role="region"
                aria-label="Certifications"
                tabIndex={0}
              >
                <table>
                  <caption className="sr-only">Member certifications</caption>
                  <thead>
                    <tr>
                      <th scope="col">Certification</th>
                      <th scope="col">Number</th>
                      <th scope="col">Issuing Agency</th>
                      <th scope="col">Completed</th>
                      <th scope="col">Expires</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certifications.map((r) => (
                      <tr key={r.id}>
                        <td>{r.course_name}</td>
                        <td>{r.certification_number || '—'}</td>
                        <td>{r.issuing_agency || '—'}</td>
                        <td>{fmtDate(r.completion_date)}</td>
                        <td
                          className={
                            r.expiration_date && new Date(r.expiration_date) < new Date()
                              ? 'member-training-print__expired'
                              : undefined
                          }
                        >
                          {fmtDate(r.expiration_date)}
                        </td>
                        <td>{STATUS_LABELS[r.status] || r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Training Course History */}
          {courseRecords.length > 0 && (
            <section className="member-training-print__section" aria-labelledby="training-history-heading">
              <h2 id="training-history-heading">Training History</h2>
              <div
                className="member-training-print__table-scroll"
                role="region"
                aria-label="Training history"
                tabIndex={0}
              >
                <table>
                  <caption className="sr-only">Complete course history</caption>
                  <thead>
                    <tr>
                      <th scope="col">Course</th>
                      <th scope="col">Type</th>
                      <th scope="col">Date</th>
                      <th scope="col">Hours</th>
                      <th scope="col">Instructor</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courseRecords
                      .sort((a, b) =>
                        (b.completion_date || b.scheduled_date || '').localeCompare(
                          a.completion_date || a.scheduled_date || ''
                        )
                      )
                      .map((r) => (
                        <tr key={r.id}>
                          <td>{r.course_name}</td>
                          <td>{r.training_type?.replace(/_/g, ' ') || '—'}</td>
                          <td>{fmtDate(r.completion_date || r.scheduled_date)}</td>
                          <td className="member-training-print__hours">{r.hours_completed}</td>
                          <td>{r.instructor || '—'}</td>
                          <td>{STATUS_LABELS[r.status] || r.status}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Footer */}
          <footer className="member-training-print__footer">
            <span>The Logbook — Member Training Record</span>
            <span>Generated {generatedDate}</span>
          </footer>
        </article>
      </main>
    </>
  );
};

export default MemberTrainingPrintPage;
