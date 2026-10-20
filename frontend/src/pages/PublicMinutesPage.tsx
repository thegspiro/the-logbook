import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import axios from 'axios';

import RichText from '../components/ux/RichText';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';

/**
 * Public minutes page (no auth): the list of minutes the department chose to
 * post, and one set of minutes read in full.
 *
 * Served by `GET /api/public/v1/minutes`. What arrives is already the public
 * copy, narrowed on the server: this page renders it and decides nothing about
 * what may be shown. The department can switch the page off or withdraw a copy
 * at any time, which is why both views treat a 404 as "not available" rather
 * than as an error to retry.
 */

interface PublicItem {
  id: string;
  title: string;
  meeting_type_display: string | null;
  meeting_date: string | null;
  meeting_date_display: string | null;
  posted_at: string;
  version: number | null;
  under_correction: boolean;
}

interface PublicList {
  organization_name: string;
  minutes: PublicItem[];
  total: number;
  skip: number;
  limit: number;
}

interface PublicSection {
  title: string;
  content: string;
  format: 'html' | 'text';
  presenter?: string;
  not_taken_up?: boolean;
}

interface PublicMotion {
  number: number | null;
  text: string | null;
  status: string | null;
  moved_by: string | null;
  seconded_by: string | null;
  vote_display: string | null;
  acceptance?: string | null;
}

interface PublicCandidate {
  name: string | null;
  votes: number | null;
  percentage: number | null;
  outcome: 'winner' | 'tied' | null;
}

interface PublicContent {
  location: string | null;
  called_by: string | null;
  called_to_order: string | null;
  adjourned: string | null;
  quorum_display: string | null;
  attendance: {
    present: number;
    // Left out by the server when the department does not report them.
    excused?: number;
    absent?: number;
    guests: number;
    officers_present: { name: string; role: string }[];
  };
  sections: PublicSection[];
  motions: PublicMotion[];
  action_items: {
    description: string | null;
    assignee: string | null;
    due: string | null;
    status: string | null;
  }[];
  closed_sessions: {
    reason: string | null;
    legal_basis: string | null;
    started: string | null;
    ended: string | null;
  }[];
  election_results: {
    title: string | null;
    closed: string | null;
    addendum: boolean;
    eligible_voters: number | null;
    ballots_cast: number | null;
    turnout_percentage: number | null;
    contests: { label: string | null; candidates: PublicCandidate[] }[];
  }[];
  approval: {
    adopted_on: string | null;
    as_amended: boolean;
    version: number | null;
    signatures: { title: string | null; name: string | null; signed_at: string | null }[];
  } | null;
}

interface PublicDetail extends PublicItem {
  organization_name: string;
  replaces: { version: number | null; posted_on: string | null } | null;
  content: PublicContent;
}

type LoadState<T> = { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'error' } | { kind: 'ready'; data: T };

const shell =
  'from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 pt-[max(3rem,env(safe-area-inset-top))] pb-12 sm:px-6 lg:px-8';
const heading = 'mt-8 text-xl font-semibold text-theme-text-primary';
const body = 'mt-2 text-sm leading-6 text-theme-text-secondary';

function useLoad<T>(url: string): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    axios
      .get<T>(url)
      .then((res) => {
        if (!cancelled) setState({ kind: 'ready', data: res.data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const missing = axios.isAxiosError(err) && err.response?.status === 404;
        setState({ kind: missing ? 'unavailable' : 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

const Unavailable: React.FC<{ state: 'unavailable' | 'error' }> = ({ state }) => (
  <p className={body} role={state === 'error' ? 'alert' : 'status'}>
    {state === 'unavailable'
      ? 'These minutes are not available.'
      : 'The minutes could not be loaded right now. Please try again later.'}
  </p>
);

const Footer: React.FC<{ organizationName?: string }> = ({ organizationName }) => (
  <footer className="border-theme-surface-border mt-12 border-t pt-4">
    <p className="text-theme-text-muted text-xs">
      &copy; {new Date().getFullYear()} {organizationName || 'Your Organization'}. Powered by The Logbook.
    </p>
  </footer>
);

const MinutesList: React.FC = () => {
  const tz = useTimezone();
  const state = useLoad<PublicList>('/api/public/v1/minutes');
  return (
    <main className={shell} id="main-content" tabIndex={-1}>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-theme-text-primary text-3xl font-extrabold">
          {state.kind === 'ready' ? `${state.data.organization_name} meeting minutes` : 'Meeting minutes'}
        </h1>
        {state.kind === 'loading' && <p className={body}>Loading…</p>}
        {(state.kind === 'unavailable' || state.kind === 'error') && <Unavailable state={state.kind} />}
        {state.kind === 'ready' && state.data.minutes.length === 0 && (
          <p className={body}>No minutes have been posted yet.</p>
        )}
        {state.kind === 'ready' && state.data.minutes.length > 0 && (
          <ul className="mt-6 space-y-3">
            {state.data.minutes.map((item) => (
              <li key={item.id} className="card p-4">
                <Link
                  to={`/public/minutes/${item.id}`}
                  className="text-theme-text-primary text-base font-semibold hover:underline"
                >
                  {item.title}
                </Link>
                <p className="text-theme-text-secondary mt-1 text-sm">
                  {[item.meeting_type_display, item.meeting_date_display].filter(Boolean).join(' · ')}
                </p>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Posted {formatDate(item.posted_at, tz)}
                  {item.under_correction ? ' · Being corrected' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Footer {...(state.kind === 'ready' ? { organizationName: state.data.organization_name } : {})} />
      </div>
    </main>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="card-secondary px-3 py-2 text-center">
    <div className="text-theme-text-primary text-lg font-semibold">{value}</div>
    <div className="text-theme-text-muted text-xs">{label}</div>
  </div>
);

const MinutesDocument: React.FC<{ id: string }> = ({ id }) => {
  const state = useLoad<PublicDetail>(`/api/public/v1/minutes/${encodeURIComponent(id)}`);
  const header = (
    <nav aria-label="Minutes">
      <Link to="/public/minutes" className="text-theme-accent-red text-sm font-medium hover:underline">
        &larr; All minutes
      </Link>
    </nav>
  );

  if (state.kind !== 'ready') {
    return (
      <main className={shell} id="main-content" tabIndex={-1}>
        <div className="mx-auto max-w-3xl">
          {header}
          {state.kind === 'loading' ? <p className={body}>Loading…</p> : <Unavailable state={state.kind} />}
        </div>
      </main>
    );
  }

  const m = state.data;
  const c = m.content;
  const a = c.attendance;
  return (
    <main className={shell} id="main-content" tabIndex={-1}>
      <div className="mx-auto max-w-3xl">
        {header}
        <h1 className="text-theme-text-primary mt-6 text-3xl font-extrabold">{m.title}</h1>
        <p className="text-theme-text-secondary mt-2 text-sm">
          {m.organization_name}
          {[m.meeting_type_display, m.meeting_date_display].some(Boolean) && ' · '}
          {[m.meeting_type_display, m.meeting_date_display].filter(Boolean).join(' · ')}
        </p>

        {m.under_correction && (
          <p className="alert-warning mt-4 text-sm" role="status">
            These minutes are being corrected. The corrected version will replace this one.
          </p>
        )}
        {m.replaces && (
          <p className="text-theme-text-muted mt-3 text-xs">
            This version replaces {m.replaces.version !== null ? `version ${m.replaces.version}` : 'an earlier version'}
            {m.replaces.posted_on ? `, posted ${m.replaces.posted_on}` : ''}.
          </p>
        )}

        <dl className="text-theme-text-secondary mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {c.location && (
            <div>
              <dt className="text-theme-text-muted inline">Location: </dt>
              <dd className="inline">{c.location}</dd>
            </div>
          )}
          {c.called_by && (
            <div>
              <dt className="text-theme-text-muted inline">Called by: </dt>
              <dd className="inline">{c.called_by}</dd>
            </div>
          )}
          {c.called_to_order && (
            <div>
              <dt className="text-theme-text-muted inline">Called to order: </dt>
              <dd className="inline">{c.called_to_order}</dd>
            </div>
          )}
          {c.adjourned && (
            <div>
              <dt className="text-theme-text-muted inline">Adjourned: </dt>
              <dd className="inline">{c.adjourned}</dd>
            </div>
          )}
          {c.quorum_display && (
            <div>
              <dt className="text-theme-text-muted inline">Quorum: </dt>
              <dd className="inline">{c.quorum_display}</dd>
            </div>
          )}
        </dl>

        <h2 className={heading}>Attendance</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Present" value={a.present} />
          {a.excused !== undefined && <Stat label="Excused" value={a.excused} />}
          {a.absent !== undefined && <Stat label="Absent" value={a.absent} />}
          <Stat label="Guests" value={a.guests} />
        </div>
        {a.officers_present.length > 0 && (
          <p className={body}>Officers present: {a.officers_present.map((o) => `${o.name} (${o.role})`).join(', ')}.</p>
        )}

        {c.sections.map((section, index) => (
          <section key={`${section.title}-${index}`}>
            <h2 className={heading}>{section.title}</h2>
            {section.presenter && (
              <p className="text-theme-text-muted mt-1 text-xs">Presented by {section.presenter}</p>
            )}
            {section.not_taken_up ? (
              <p className={body}>Not taken up at this meeting.</p>
            ) : (
              <RichText
                content={section.content}
                format={section.format}
                className={`${body} text-theme-text-secondary`}
              />
            )}
          </section>
        ))}

        {c.motions.length > 0 && (
          <section>
            <h2 className={heading}>Motions</h2>
            <ol className="mt-3 space-y-3">
              {c.motions.map((motion, index) => (
                <li key={index} className="card-secondary p-3 text-sm">
                  <p className="text-theme-text-primary font-medium">
                    {motion.number !== null ? `Motion ${motion.number}: ` : ''}
                    {motion.text}
                  </p>
                  <p className="text-theme-text-secondary mt-1">
                    {[
                      motion.moved_by && `Moved by ${motion.moved_by}`,
                      motion.seconded_by && `seconded by ${motion.seconded_by}`,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                  <p className="text-theme-text-secondary mt-1">
                    {[motion.status, motion.vote_display, motion.acceptance].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {c.action_items.length > 0 && (
          <section>
            <h2 className={heading}>Action items</h2>
            <ul className="text-theme-text-secondary mt-3 list-disc space-y-1 pl-6 text-sm">
              {c.action_items.map((item, index) => (
                <li key={index}>
                  {item.description}
                  {[item.assignee && `assigned to ${item.assignee}`, item.due && `due ${item.due}`, item.status]
                    .filter(Boolean)
                    .map((part) => ` — ${String(part)}`)
                    .join('')}
                </li>
              ))}
            </ul>
          </section>
        )}

        {c.closed_sessions.length > 0 && (
          <section>
            <h2 className={heading}>Closed sessions</h2>
            <ul className="mt-3 space-y-2">
              {c.closed_sessions.map((session, index) => (
                <li key={index} className="card-secondary p-3 text-sm">
                  <p className="text-theme-text-primary">{session.reason}</p>
                  {session.legal_basis && (
                    <p className="text-theme-text-secondary mt-1">Authority: {session.legal_basis}</p>
                  )}
                  {(session.started || session.ended) && (
                    <p className="text-theme-text-muted mt-1 text-xs">
                      {[session.started && `From ${session.started}`, session.ended && `to ${session.ended}`]
                        .filter(Boolean)
                        .join(' ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {c.election_results.map((election, index) => (
          <section key={index}>
            <h2 className={heading}>
              {election.title || 'Election results'}
              {election.addendum ? ' (added after adoption)' : ''}
            </h2>
            <p className="text-theme-text-muted mt-1 text-xs">
              {[
                election.closed && `Closed ${election.closed}`,
                election.ballots_cast !== null &&
                  election.eligible_voters !== null &&
                  `${election.ballots_cast} of ${election.eligible_voters} voted`,
                election.turnout_percentage !== null && `${election.turnout_percentage}% turnout`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {election.contests.map((contest, i) => (
              <div key={i} className="mt-3">
                {contest.label && <h3 className="text-theme-text-primary text-sm font-medium">{contest.label}</h3>}
                <ul className="text-theme-text-secondary mt-1 text-sm">
                  {contest.candidates.map((candidate, j) => (
                    <li key={j}>
                      {candidate.name}
                      {candidate.votes !== null ? `: ${candidate.votes}` : ''}
                      {candidate.percentage !== null ? ` (${candidate.percentage}%)` : ''}
                      {candidate.outcome === 'winner' ? ' — elected' : candidate.outcome === 'tied' ? ' — tied' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}

        {c.approval && (
          <section>
            <h2 className={heading}>Adoption</h2>
            <p className={body}>
              Adopted{c.approval.adopted_on ? ` on ${c.approval.adopted_on}` : ''}
              {c.approval.as_amended ? ' as amended' : ''}.
            </p>
            {c.approval.signatures.length > 0 && (
              <ul className="text-theme-text-secondary mt-2 space-y-1 text-sm">
                {c.approval.signatures.map((signature, index) => (
                  <li key={index}>
                    {signature.name}
                    {signature.title ? `, ${signature.title}` : ''}
                    {signature.signed_at ? ` — signed ${signature.signed_at}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <Footer organizationName={m.organization_name} />
      </div>
    </main>
  );
};

const PublicMinutesPage: React.FC = () => {
  const { copyId } = useParams<{ copyId: string }>();
  return copyId ? <MinutesDocument id={copyId} /> : <MinutesList />;
};

export default PublicMinutesPage;
