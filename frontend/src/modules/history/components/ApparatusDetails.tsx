/**
 * A historical apparatus as anyone allowed to read it sees it, and the
 * apparatus tags shown on photos, documents and events.
 */
import React from 'react';
import { Link } from 'react-router';
import {
  APPARATUS_DISPOSITION_LABELS,
  type ApparatusMemberView,
  type ApparatusTag,
  type ApparatusView,
} from '../types';
import { formatNumber } from '../../../utils/dateFormatting';
import { formatPartialDate } from '../utils/historyFormat';

/** Apparatus linked to a photo, document or event: only those the server
 * says the caller may read are ever sent. */
export const ApparatusLinks: React.FC<{ apparatus: ApparatusTag[]; headingId: string }> = ({
  apparatus,
  headingId,
}) => {
  if (apparatus.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-theme-text-primary mb-1 text-base font-semibold">
        Apparatus
      </h2>
      <ul className="flex flex-wrap gap-2">
        {apparatus.map((item) => (
          <li key={item.apparatus_id}>
            <Link
              to={`/history/apparatus/${item.apparatus_id}`}
              className="badge touch-target-phone inline-flex items-center underline-offset-2 hover:underline"
            >
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

const figure = (value: number | null, unit: string): string | null =>
  value === null ? null : `${formatNumber(value)} ${unit}`;

export const ApparatusDetails: React.FC<{ item: ApparatusView | ApparatusMemberView }> = ({ item }) => {
  const built = [item.year, item.make, item.model].filter(Boolean).join(' ');
  const rows: [string, string | null][] = [
    ['Type', item.apparatus_type_name],
    ['Built', built || null],
    ['Body builder', item.body_builder],
    ['Pump', figure(item.pump_gpm, 'GPM')],
    ['Tank', figure(item.tank_gallons, 'gallons')],
    ['Ladder', figure(item.ladder_feet, 'feet')],
    ['In service', formatPartialDate(item.in_service_date, item.in_service_precision, item.in_service_circa) || null],
    [
      'Out of service',
      formatPartialDate(item.out_of_service_date, item.out_of_service_precision, item.out_of_service_circa) || null,
    ],
    ['What became of it', APPARATUS_DISPOSITION_LABELS[item.disposition]],
    ['Where it is now', item.current_location],
    ['Source or donor', item.source_name],
    ['Accession number', item.accession_number],
  ];
  return (
    <div className="space-y-4">
      {item.description && <p className="text-theme-text-primary text-sm whitespace-pre-line">{item.description}</p>}
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-theme-text-secondary font-medium">{label}</dt>
              <dd className="text-theme-text-primary">{value}</dd>
            </React.Fragment>
          ))}
      </dl>
      {item.designations.length > 0 && (
        <section aria-labelledby="apparatus-designations-heading">
          <h2 id="apparatus-designations-heading" className="text-theme-text-primary mb-1 text-base font-semibold">
            Unit numbers
          </h2>
          <ol className="divide-theme-surface-border divide-y text-sm">
            {item.designations.map((d) => {
              const from = formatPartialDate(d.start_date, d.start_precision, d.start_circa);
              const to = formatPartialDate(d.end_date, d.end_precision, d.end_circa);
              const span = from || to ? `${from || '?'} – ${to}` : '';
              return (
                <li key={d.id} className="flex flex-wrap gap-x-3 py-1.5">
                  <span className="text-theme-text-primary font-medium">{d.designation}</span>
                  {d.station_name && <span className="text-theme-text-secondary">{d.station_name}</span>}
                  {span && <span className="text-theme-text-secondary">{span}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
};
