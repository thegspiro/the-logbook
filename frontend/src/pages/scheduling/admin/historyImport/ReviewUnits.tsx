/**
 * Which unit each vehicle name in the file means.
 *
 * Names match exactly or not at all: A106 and A106E are different vehicles,
 * and one may belong to the department while the other belongs to the county.
 * A name can map to one of the department's own units — its rows become
 * shifts on the schedule — or to an outside agency's unit, whose rows become
 * outside-agency hours. A unit not yet in the outside list can be added here.
 */

import React, { useState } from 'react';
import { HISTORY_IMPORT_RESOLUTION_COLORS } from '../../../../constants/enums';
import type {
  HistoryImportAnalysis,
  HistoryImportMappingsUpdate,
  HistoryImportUnit,
  UnitMapping,
} from '../../../../modules/scheduling/types/historyImport';
import { UnitTargetKind } from '../../../../modules/scheduling/types/historyImport';
import { isSettled, RESOLUTION_LABELS, unitLabel } from './historyImportLabels';
import RememberedBadge from './RememberedBadge';

interface ReviewUnitsProps {
  analysis: HistoryImportAnalysis;
  busy: boolean;
  onMappings: (payload: HistoryImportMappingsUpdate) => void;
}

const AUTOMATIC = '';
const NEW_OUTSIDE = '__new_outside__';

const UnitRow: React.FC<{
  unit: HistoryImportUnit;
  analysis: HistoryImportAnalysis;
  busy: boolean;
  onMappings: (payload: HistoryImportMappingsUpdate) => void;
}> = ({ unit, analysis, busy, onMappings }) => {
  const [addingOutside, setAddingOutside] = useState(false);
  const [agencyName, setAgencyName] = useState(unit.agency || unit.new_agency_name);
  const [unitName, setUnitName] = useState(unit.new_unit_name || unit.unit);

  const label = unit.agency ? `${unit.unit} (${unit.agency})` : unit.unit;
  const target = unit.target_kind
    ? unitLabel(
        analysis,
        unit.target_kind,
        unit.target_kind === UnitTargetKind.NEW_EXTERNAL ? unit.key : (unit.target_id ?? '')
      )
    : null;
  const selectId = `unit-decision-${unit.key}`;
  const current =
    unit.status === 'mapped' && unit.target_kind !== UnitTargetKind.NEW_EXTERNAL
      ? `${unit.target_kind ?? ''}:${unit.target_id ?? ''}`
      : unit.target_kind === UnitTargetKind.NEW_EXTERNAL || addingOutside
        ? NEW_OUTSIDE
        : AUTOMATIC;

  const send = (mapping: UnitMapping | null) => onMappings({ units: { [unit.key]: mapping } });

  const choose = (value: string) => {
    if (value === NEW_OUTSIDE) {
      setAddingOutside(true);
      return;
    }
    setAddingOutside(false);
    if (value === AUTOMATIC) {
      send(null);
      return;
    }
    const [kind, id] = value.split(':');
    if ((kind === 'own' || kind === 'external') && id) send({ action: kind, id });
  };

  const ownUnits = analysis.options.units.filter((u) => u.kind === 'own');
  const outsideUnits = analysis.options.units.filter((u) => u.kind === 'external');

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-theme-text-primary font-medium break-words">{label}</span>
            <span className={`badge border ${HISTORY_IMPORT_RESOLUTION_COLORS[unit.status] ?? ''}`}>
              {RESOLUTION_LABELS[unit.status] ?? unit.status}
            </span>
            {unit.remembered && <RememberedBadge />}
          </div>
          <p className="text-theme-text-secondary mt-1 text-sm">
            {unit.row_count} {unit.row_count === 1 ? 'row' : 'rows'}
            {target ? ` · recorded on ${target}` : ''}
          </p>
        </div>
        <div className="lg:w-80">
          <label htmlFor={selectId} className="sr-only">
            Which unit is {label}?
          </label>
          <select
            id={selectId}
            className="form-input"
            value={current}
            disabled={busy}
            onChange={(e) => choose(e.target.value)}
          >
            <option value={AUTOMATIC}>{unit.status === 'matched' ? 'Matched automatically' : 'Choose…'}</option>
            <option value={NEW_OUTSIDE}>Add as an outside agency's unit…</option>
            {ownUnits.length > 0 && (
              <optgroup label="This department's units">
                {ownUnits.map((option) => (
                  <option key={option.id} value={`own:${option.id}`}>
                    {option.name}
                  </option>
                ))}
              </optgroup>
            )}
            {outsideUnits.length > 0 && (
              <optgroup label="Outside agencies' units">
                {outsideUnits.map((option) => (
                  <option key={option.id} value={`external:${option.id}`}>
                    {option.name}
                    {option.agency_name ? ` (${option.agency_name})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {current === NEW_OUTSIDE && (
        <form
          className="bg-theme-surface-secondary flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!agencyName.trim() || !unitName.trim()) return;
            send({ action: 'create_external', agency_name: agencyName.trim(), unit_name: unitName.trim() });
          }}
        >
          <div className="flex-1">
            <label htmlFor={`${selectId}-agency`} className="form-label">
              Agency
            </label>
            <input
              id={`${selectId}-agency`}
              className="form-input"
              maxLength={255}
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              placeholder="e.g. County EMS"
            />
          </div>
          <div className="flex-1">
            <label htmlFor={`${selectId}-unit`} className="form-label">
              Unit
            </label>
            <input
              id={`${selectId}-unit`}
              className="form-input"
              maxLength={100}
              value={unitName}
              onChange={(e) => setUnitName(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={busy || !agencyName.trim() || !unitName.trim()}>
            Use this unit
          </button>
        </form>
      )}
    </li>
  );
};

const ReviewUnits: React.FC<ReviewUnitsProps> = ({ analysis, busy, onMappings }) => {
  const units = [...analysis.units].sort(
    (a, b) => Number(isSettled(a.status)) - Number(isSettled(b.status)) || a.unit.localeCompare(b.unit)
  );
  const unresolved = units.filter((u) => !isSettled(u.status)).length;

  return (
    <section aria-labelledby="review-units-heading" className="space-y-4">
      <div>
        <h2 id="review-units-heading" className="text-theme-text-primary text-lg font-semibold">
          Units
        </h2>
        <p className="text-theme-text-secondary text-sm">
          {unresolved === 0
            ? `All ${units.length} unit names are settled.`
            : `${unresolved} of ${units.length} unit names need a decision.`}{' '}
          Rows on this department's units become shifts; rows on an outside agency's unit become outside-agency hours.
        </p>
      </div>
      {units.length === 0 ? (
        <p className="card text-theme-text-secondary p-4 text-sm">No units yet — check the column mapping.</p>
      ) : (
        <ul className="card divide-theme-surface-border divide-y">
          {units.map((unit) => (
            <UnitRow key={unit.key} unit={unit} analysis={analysis} busy={busy} onMappings={onMappings} />
          ))}
        </ul>
      )}
    </section>
  );
};

export default ReviewUnits;
