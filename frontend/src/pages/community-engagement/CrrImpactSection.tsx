/**
 * Community risk reduction on Outreach Impact: what each activity type added
 * up to in the page's period, the same work under each risk and priority
 * population, and where it happened by ZIP code, with a street map on request.
 *
 * Every figure comes from the report (CrrImpactService); nothing is derived
 * here but the change text (pitfall #29). An activity with two tags counts
 * under both, so the tag lists do not add up to the total, and the section
 * says so (owner decision, 2026-11-23).
 */

import React, { Suspense, useState } from 'react';
import { Link } from 'react-router';
import { Map as MapIcon, MapPin, ShieldCheck } from 'lucide-react';
import type { CrrImpact, CrrImpactCount, CrrImpactTag } from '../../services/communicationsServices';
import { formatNumber } from '../../utils/dateFormatting';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { ChangeBadge } from './ChangeBadge';
import { describeChange } from './communityEngagement';

/** "1 activity", "14 activities". */
const activitiesText = (n: number): string => `${formatNumber(n)} ${n === 1 ? 'activity' : 'activities'}`;

// Leaflet and the map stay out of the page until someone asks for the map.
const CrrZipMap = lazyWithRetry(() => import('./CrrZipMap'));

/** "Smoke alarm install · Alarms installed" — a count named with its type. */
const countName = (c: CrrImpactCount) => `${c.activity_type_name} · ${c.label}`;

const CountList: React.FC<{ counts: CrrImpactCount[] }> = ({ counts }) =>
  counts.length ? (
    <ul className="mt-2 space-y-1 text-sm">
      {counts.map((c) => (
        <li key={c.measure_id} className="flex justify-between gap-3">
          <span className="text-theme-text-secondary min-w-0">{countName(c)}</span>
          <span className="text-theme-text-primary shrink-0 font-medium tabular-nums">{formatNumber(c.quantity)}</span>
        </li>
      ))}
    </ul>
  ) : null;

const TagGroup: React.FC<{ title: string; tags: CrrImpactTag[]; id: string }> = ({ title, tags, id }) => (
  <div>
    <h4 id={id} className="text-theme-text-secondary mb-2 text-xs font-semibold tracking-wider uppercase">
      {title}
    </h4>
    {tags.length ? (
      <ul className="card-grid [--card-grid-min:16rem]" aria-labelledby={id}>
        {tags.map((t) => (
          <li key={t.tag_id} className="card-secondary p-3" aria-labelledby={`ce-crr-tag-${t.tag_id}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span id={`ce-crr-tag-${t.tag_id}`} className="text-theme-text-primary font-medium">
                {t.label}
              </span>
              <span className="text-theme-text-muted shrink-0 text-xs">{activitiesText(t.activities)}</span>
            </div>
            <CountList counts={t.counts} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-theme-text-muted text-sm">None tagged in this period.</p>
    )}
  </div>
);

interface CrrImpactSectionProps {
  crr: CrrImpact;
  /** "this year", "all time": the page's period, lower-cased. */
  periodLabel: string;
  /** What the changes compare with; null when the period has no comparison. */
  against: string | null;
}

const CrrImpactSection: React.FC<CrrImpactSectionProps> = ({ crr, periodLabel, against }) => {
  const [showMap, setShowMap] = useState(false);
  const risks = crr.by_tag.filter((t) => t.kind === 'risk');
  const populations = crr.by_tag.filter((t) => t.kind === 'population');
  const nothing = crr.activities === 0 && !crr.previous_activities;

  return (
    <section className="card mb-5 p-4" aria-labelledby="ce-crr-heading">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="ce-crr-heading" className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
            Community risk reduction
          </h3>
          <p className="text-theme-text-secondary mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs">
            <span>
              {activitiesText(crr.activities)} {periodLabel}
            </span>
            <ChangeBadge change={describeChange(crr.activities, crr.previous_activities)} against={against} />
          </p>
        </div>
        <Link to="/events/crr-activities" className="btn-secondary btn-sm">
          CRR activities
        </Link>
      </div>

      {nothing ? (
        <p className="text-theme-text-muted text-sm">No CRR activities recorded in this period.</p>
      ) : (
        <div className="space-y-6">
          <div>
            <h4
              id="ce-crr-types"
              className="text-theme-text-secondary mb-2 text-xs font-semibold tracking-wider uppercase"
            >
              By activity
            </h4>
            <ul className="card-grid [--card-grid-min:16rem]" aria-labelledby="ce-crr-types">
              {crr.by_type.map((t) => (
                <li
                  key={t.activity_type_id}
                  className="card-secondary p-3"
                  aria-labelledby={`ce-crr-type-${t.activity_type_id}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span id={`ce-crr-type-${t.activity_type_id}`} className="text-theme-text-primary font-medium">
                      {t.name}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="text-theme-text-muted text-xs">{activitiesText(t.activities)}</span>
                      <ChangeBadge change={describeChange(t.activities, t.previous_activities)} against={against} />
                    </span>
                  </div>
                  {t.counts.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm">
                      {t.counts.map((c) => (
                        <li key={c.measure_id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-theme-text-secondary">{c.label}</span>
                          <span className="flex items-baseline gap-2">
                            <span className="text-theme-text-primary font-medium tabular-nums">
                              {formatNumber(c.quantity)}
                            </span>
                            <ChangeBadge change={describeChange(c.quantity, c.previous_quantity)} against={against} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <p className="text-theme-text-muted text-xs">
              An activity counts under every risk and population it was tagged with, so these do not add up to the
              total.
            </p>
            <TagGroup title="By risk" tags={risks} id="ce-crr-risks" />
            <TagGroup title="By priority population" tags={populations} id="ce-crr-populations" />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 id="ce-crr-zips" className="text-theme-text-secondary text-xs font-semibold tracking-wider uppercase">
                By ZIP code
              </h4>
              {crr.by_zip.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary btn-sm inline-flex items-center gap-1"
                  aria-expanded={showMap}
                  aria-controls="ce-crr-map"
                  onClick={() => setShowMap((open) => !open)}
                >
                  <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{showMap ? 'Hide map' : 'Show map'}</span>
                </button>
              )}
            </div>
            {showMap && (
              <div id="ce-crr-map" className="mb-3">
                <Suspense fallback={<p className="text-theme-text-muted text-sm">Loading the map…</p>}>
                  <CrrZipMap zips={crr.by_zip} />
                </Suspense>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Street map from OpenStreetMap, loaded from openstreetmap.org when shown.
                </p>
              </div>
            )}
            {crr.by_zip.length ? (
              <ul className="card-grid [--card-grid-min:16rem]" aria-labelledby="ce-crr-zips">
                {crr.by_zip.map((z) => (
                  <li
                    key={z.zip_code}
                    className="card-secondary p-3"
                    aria-label={[z.zip_code, [z.city, z.state].filter(Boolean).join(', ')].filter(Boolean).join(' ')}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-theme-text-primary flex min-w-0 items-center gap-1 font-medium">
                        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {z.zip_code}
                          {(z.city || z.state) && (
                            <span className="text-theme-text-secondary font-normal">
                              {' '}
                              {[z.city, z.state].filter(Boolean).join(', ')}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="text-theme-text-muted shrink-0 text-xs">{activitiesText(z.activities)}</span>
                    </div>
                    <CountList counts={z.counts} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-theme-text-muted text-sm">No activities in this period have a ZIP code.</p>
            )}
            {crr.unplaced_activities > 0 && crr.by_zip.length > 0 && (
              <p className="text-theme-text-muted mt-2 text-xs">
                {activitiesText(crr.unplaced_activities)} had no ZIP code and are not listed here.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default CrrImpactSection;
