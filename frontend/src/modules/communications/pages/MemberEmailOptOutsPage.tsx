/**
 * Member Email Opt-Outs
 *
 * Which current members have turned off which optional emails, beside the
 * Member Emails & Texts page that decides which emails can be turned off.
 * Owner decision 2026-11-01: administrators may see this, so that an officer
 * deciding whether to require an email knows who it would otherwise miss.
 *
 * Read-only on purpose. An opt-out is the member's own choice, set from their
 * settings; the department's lever is "Require for every member" on the
 * policy page. Who counts as "not emailed" is computed by the backend from the
 * same rule the senders apply, and this screen only reports it
 * (CLAUDE.md pitfall #29).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, MailX } from 'lucide-react';
import { Breadcrumbs, EmptyState, Pagination, SkeletonPage } from '../../../components/ux';
import { emailTemplatesService } from '../../../services/api';
import type { MemberEmailKind, MemberEmailOptOutPage } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const MemberEmailOptOutsPage: React.FC = () => {
  const [kinds, setKinds] = useState<MemberEmailKind[] | null>(null);
  const [page, setPage] = useState<MemberEmailOptOutPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    emailTemplatesService
      .getMemberEmailPolicy()
      .then((policy) => setKinds(policy.emails.filter((k) => !k.required)))
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load the list of member emails.')));
  }, []);

  const load = useCallback(async () => {
    try {
      setPage(
        await emailTemplatesService.getMemberEmailOptOuts({
          kind: kind || undefined,
          skip: (currentPage - 1) * pageSize,
          limit: pageSize,
        })
      );
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load who has opted out.'));
    }
  }, [kind, currentPage, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const labels = useMemo(() => new Map((kinds ?? []).map((k) => [k.key, k.label])), [kinds]);
  const labelFor = (key: string) => labels.get(key) ?? key;
  const departmentRequired = new Set(page?.department_required ?? []);
  const filteredLabel = kind ? labelFor(kind) : '';

  if ((!page || !kinds) && !error) {
    return <SkeletonPage />;
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Breadcrumbs
        items={[
          { label: 'Communications' },
          { label: 'Member Emails & Texts', path: '/communications/member-emails' },
          { label: 'Opt-outs' },
        ]}
      />
      <h1 className="text-theme-text-primary mb-2 flex items-center gap-2 text-2xl font-bold">
        <MailX className="h-6 w-6 shrink-0" aria-hidden="true" />
        Member Email Opt-Outs
      </h1>
      <p className="text-theme-text-secondary mb-6 text-sm">
        Current members who have turned off optional emails. Members choose this in their own settings, and they still
        get every notice in the bell. To make sure everyone receives an email, turn on{' '}
        <strong>Require for every member</strong> for it on{' '}
        <Link to="/communications/member-emails" className="text-theme-text-primary underline hover:no-underline">
          Member Emails &amp; Texts
        </Link>
        .
      </p>

      {error && (
        <div role="alert" className="alert-danger mb-4 flex items-center gap-2">
          <AlertCircle className="text-theme-alert-danger-icon h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}

      {page && kinds && (
        <>
          <div className="split-row mb-4 gap-2 sm:items-end">
            <div className="split-row-main">
              <label htmlFor="opt-out-kind" className="form-label">
                Show
              </label>
              <select
                id="opt-out-kind"
                className="form-input max-w-md"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setCurrentPage(1);
                }}
              >
                <option value="">Everyone who turned anything off</option>
                {kinds.map((k) => (
                  <option key={k.key} value={k.key}>
                    {`Not emailed: ${k.label} (${page.not_emailed[k.key] ?? 0})`}
                  </option>
                ))}
              </select>
            </div>
            <p className="split-row-aside text-theme-text-muted text-sm">
              {page.total} of {page.members_considered} current members
            </p>
          </div>

          {kind && departmentRequired.has(kind) && (
            <div role="status" className="alert-info mb-4 text-sm">
              Your department requires {filteredLabel} for every member, so everyone receives it whatever they chose.
            </div>
          )}

          {page.members.length === 0 ? (
            <EmptyState
              icon={MailX}
              title={kind ? `Everyone receives ${filteredLabel}` : 'No member has turned off an email'}
              description="Every current member receives these emails."
            />
          ) : (
            <div className="card overflow-hidden">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border bg-theme-surface-secondary border-b text-left">
                    <th scope="col" className="px-4 py-3">
                      Member
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Email notifications
                    </th>
                    <th scope="col" className="px-4 py-3">
                      Turned off
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.members.map((member) => (
                    <tr key={member.user_id} className="border-theme-surface-border border-b last:border-b-0">
                      <td className="rwd-table-lead px-4 py-3" data-label="Member">
                        <span className="text-theme-text-primary font-medium">{member.name}</span>
                        {member.membership_number && (
                          <span className="text-theme-text-muted ml-2 text-xs">#{member.membership_number}</span>
                        )}
                      </td>
                      <td className="px-4 py-3" data-label="Email notifications">
                        {member.email_notifications_off ? (
                          <span className="badge bg-theme-surface-secondary text-theme-text-primary">
                            Off — optional emails stopped
                          </span>
                        ) : (
                          <span className="text-theme-text-secondary">On</span>
                        )}
                      </td>
                      <td className="px-4 py-3" data-label="Turned off">
                        {member.turned_off.length === 0 ? (
                          <span className="text-theme-text-muted">None individually</span>
                        ) : (
                          <ul className="flex flex-wrap gap-1">
                            {member.turned_off.map((key) => (
                              <li key={key} className="badge bg-theme-surface-secondary text-theme-text-secondary">
                                {labelFor(key)}
                                {departmentRequired.has(key) ? ' (required — still sent)' : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {page.total > 0 && (
            <Pagination
              className="mt-4"
              currentPage={currentPage}
              totalItems={page.total}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
};

export default MemberEmailOptOutsPage;
