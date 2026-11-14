/**
 * What anyone allowed to read the record sees: names, service, biography,
 * memorial details and family. The restricted fields are not part of this —
 * a member's payload does not carry them at all.
 */
import React from 'react';
import { Link } from 'react-router';
import { Medal } from 'lucide-react';
import type { HistoricalMemberView } from '../types';
import { formatPartialDate, formatPeriod } from '../utils/historyFormat';
import { ArchiveHtml } from './ArchiveHtml';

export const PersonDetails: React.FC<{ person: HistoricalMemberView }> = ({ person }) => {
  const deathDate = formatPartialDate(
    person.death_date ?? null,
    person.death_date_precision ?? null,
    person.death_date_circa
  );
  return (
    <div className="space-y-6">
      {person.is_line_of_duty_death && (
        <p className="alert-warning flex items-center gap-2 rounded-md p-3 text-sm font-medium">
          <Medal className="h-4 w-4 shrink-0" aria-hidden="true" />
          Died in the line of duty
        </p>
      )}

      <section aria-labelledby="service-heading">
        <h2 id="service-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
          Service
        </h2>
        {person.badge_number && <p className="text-theme-text-secondary mb-2 text-sm">Badge {person.badge_number}</p>}
        {person.service_periods.length === 0 ? (
          <p className="text-theme-text-secondary text-sm">No periods of service recorded.</p>
        ) : (
          <ul className="space-y-2">
            {person.service_periods.map((period) => (
              <li key={period.id} className="text-sm">
                <span className="text-theme-text-primary font-medium">{formatPeriod(period)}</span>
                {period.titles.length > 0 && (
                  <span className="text-theme-text-secondary"> · {period.titles.map((t) => t.name).join(', ')}</span>
                )}
                {period.notes && <p className="text-theme-text-secondary">{period.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {person.biography_html && (
        <section aria-labelledby="biography-heading">
          <h2 id="biography-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
            Biography
          </h2>
          <ArchiveHtml html={person.biography_html} className="text-theme-text-primary" />
        </section>
      )}

      {person.is_memorial && (deathDate || person.death_circumstances || person.burial_location) && (
        <section aria-labelledby="memorial-heading">
          <h2 id="memorial-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
            In memoriam
          </h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
            {deathDate && (
              <>
                <dt className="text-theme-text-secondary">Died</dt>
                <dd className="text-theme-text-primary">{deathDate}</dd>
              </>
            )}
            {person.death_circumstances && (
              <>
                <dt className="text-theme-text-secondary">Circumstances</dt>
                <dd className="text-theme-text-primary whitespace-pre-wrap">{person.death_circumstances}</dd>
              </>
            )}
            {person.burial_location && (
              <>
                <dt className="text-theme-text-secondary">Resting place</dt>
                <dd className="text-theme-text-primary whitespace-pre-wrap">{person.burial_location}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {person.relations.length > 0 && (
        <section aria-labelledby="family-heading">
          <h2 id="family-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
            Family in the department
          </h2>
          <ul className="space-y-1 text-sm">
            {person.relations.map((r) => (
              <li key={r.id}>
                <Link
                  to={`/history/people/${r.other_member_id}`}
                  className="touch-target-phone link-underline inline-flex items-center"
                >
                  {r.other_display_name}
                </Link>
                <span className="text-theme-text-secondary"> — {r.relationship}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
