/**
 * Which unit each vehicle name in the file means.
 *
 * Names match exactly or not at all: A106 and A106E are different vehicles,
 * and one may belong to the department while the other belongs to the county.
 * A name can map to one of the department's own units — its rows become
 * shifts on the schedule — or to an outside agency's unit, whose rows become
 * outside-agency hours. A unit not yet in the outside list can be added here,
 * under an agency picked from the department's list so a misspelling cannot
 * create a second agency. Names that are not a vehicle at all (POV, "Other
 * EMS") can all go to one catch-all "Other" unit.
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
import { positionLabel } from '../../../../modules/scheduling/utils/positionLabels';
import { isSettled, RESOLUTION_LABELS, unitLabel } from './historyImportLabels';
import RememberedBadge from './RememberedBadge';

interface ReviewUnitsProps {
  analysis: HistoryImportAnalysis;
  busy: boolean;
  onMappings: (payload: HistoryImportMappingsUpdate) => void;
}

const AUTOMATIC = '';
const NEW_OUTSIDE = '__new_outside__';
const CATCH_ALL = '__catch_all_other__';
const NEW_AGENCY = '__new_agency__';
// The catch-all is an outside agency and unit both named this; commit reuses
// them by name once they exist, so every import lands on the same unit.
const CATCH_ALL_NAME = 'Other';

const sameName = (a: string | null | undefined, b: string): boolean =>
  (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

const UnitRow: React.FC<{
  unit: HistoryImportUnit;
  analysis: HistoryImportAnalysis;
  busy: boolean;
  onMappings: (payload: HistoryImportMappingsUpdate) => void;
}> = ({ unit, analysis, busy, onMappings }) => {
  const agencies = analysis.options.agencies ?? [];
  const initialAgency =
    agencies.find((a) => a.id === unit.new_agency_id) ??
    agencies.find((a) => sameName(a.name, unit.new_agency_name || unit.agency));
  const [addingOutside, setAddingOutside] = useState(false);
  const [agencyChoice, setAgencyChoice] = useState(initialAgency?.id ?? NEW_AGENCY);
  const [agencyName, setAgencyName] = useState(initialAgency ? '' : unit.new_agency_name || unit.agency);
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
  const isNewExternal = unit.target_kind === UnitTargetKind.NEW_EXTERNAL;
  const isCatchAll =
    isNewExternal && sameName(unit.new_agency_name, CATCH_ALL_NAME) && sameName(unit.new_unit_name, CATCH_ALL_NAME);
  // Opening the add form wins over the current mapping, or choosing it on a
  // unit already mapped elsewhere would leave the form closed.
  const current = addingOutside
    ? NEW_OUTSIDE
    : unit.status === 'mapped' && !isNewExternal
      ? `${unit.target_kind ?? ''}:${unit.target_id ?? ''}`
      : isCatchAll
        ? CATCH_ALL
        : isNewExternal
          ? NEW_OUTSIDE
          : AUTOMATIC;

  const send = (mapping: UnitMapping | null) => onMappings({ units: { [unit.key]: mapping } });

  const chooseCatchAll = () => {
    const agency = agencies.find((a) => sameName(a.name, CATCH_ALL_NAME));
    const existing = analysis.options.units.find(
      (u) => u.kind === 'external' && sameName(u.name, CATCH_ALL_NAME) && sameName(u.agency_name, CATCH_ALL_NAME)
    );
    if (existing) {
      send({ action: 'external', id: existing.id });
      return;
    }
    send({
      action: 'create_external',
      agency_id: agency?.id,
      agency_name: agency?.name ?? CATCH_ALL_NAME,
      unit_name: CATCH_ALL_NAME,
    });
  };

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
    if (value === CATCH_ALL) {
      chooseCatchAll();
      return;
    }
    const [kind, id] = value.split(':');
    if ((kind === 'own' || kind === 'external') && id) send({ action: kind, id });
  };

  const pickedAgency = agencies.find((a) => a.id === agencyChoice);
  const newAgencyName = agencyName.trim();
  const canAdd = Boolean(unitName.trim()) && (pickedAgency !== undefined || Boolean(newAgencyName));

  const ownUnits = analysis.options.units.filter((u) => u.kind === 'own');
  const outsideUnits = analysis.options.units.filter((u) => u.kind === 'external');
  // An own unit whose apparatus record lists its seats: the reviewer can say
  // which seat a member takes when the file names no position, so a crew on an
  // ambulance is not seated as firefighters.
  const ownTarget =
    unit.target_kind === UnitTargetKind.OWN && unit.target_id
      ? ownUnits.find((o) => o.id === unit.target_id)
      : undefined;
  const seats = ownTarget?.seats ?? [];
  const seatId = `${selectId}-seat`;

  return (
    <li className="space-y-3 p-4">
      <div className="split-row gap-3 sm:items-center">
        <div className="split-row-main">
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
        <div className="split-row-aside sm:w-80">
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
            <option value={CATCH_ALL}>Catch-all: {CATCH_ALL_NAME}</option>
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
                    {option.is_active === false ? ' — hidden from members' : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {ownTarget && seats.length > 0 && (
        <div className="split-row gap-3 sm:items-center">
          <label htmlFor={seatId} className="split-row-main text-theme-text-secondary text-sm">
            Position for members on this unit when the file names none
          </label>
          <div className="split-row-aside sm:w-80">
            <select
              id={seatId}
              className="form-input"
              value={unit.default_seat ?? ''}
              disabled={busy}
              onChange={(e) => send({ action: 'own', id: ownTarget.id, default_seat: e.target.value || undefined })}
            >
              <option value="">
                {seats.some((s) => s.toLowerCase() === 'firefighter') ? 'Firefighter' : 'Choose…'}
              </option>
              {seats.map((seat) => (
                <option key={seat} value={seat}>
                  {positionLabel(seat)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {current === NEW_OUTSIDE && (
        <>
          <form
            className="bg-theme-surface-secondary flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canAdd) return;
              send(
                pickedAgency
                  ? {
                      action: 'create_external',
                      agency_id: pickedAgency.id,
                      agency_name: pickedAgency.name,
                      unit_name: unitName.trim(),
                    }
                  : { action: 'create_external', agency_name: newAgencyName, unit_name: unitName.trim() }
              );
            }}
          >
            <div className="flex-1 space-y-2">
              <div>
                <label htmlFor={`${selectId}-agency`} className="form-label">
                  Agency
                </label>
                <select
                  id={`${selectId}-agency`}
                  className="form-input"
                  value={agencyChoice}
                  disabled={busy}
                  onChange={(e) => setAgencyChoice(e.target.value)}
                >
                  <option value={NEW_AGENCY}>New agency…</option>
                  {agencies.map((agency) => (
                    <option key={agency.id} value={agency.id}>
                      {agency.name}
                      {agency.is_active ? '' : ' — hidden from members'}
                    </option>
                  ))}
                </select>
              </div>
              {agencyChoice === NEW_AGENCY && (
                <div>
                  <label htmlFor={`${selectId}-agency-name`} className="form-label">
                    New agency name
                  </label>
                  <input
                    id={`${selectId}-agency-name`}
                    className="form-input"
                    maxLength={255}
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    placeholder="e.g. County EMS"
                  />
                </div>
              )}
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
            <button type="submit" className="btn-primary" disabled={busy || !canAdd}>
              Use this unit
            </button>
          </form>
          <p className="text-theme-text-secondary text-sm">
            A unit added here starts hidden from members. Offer it in Outside Apparatus settings if it is still in
            service.
          </p>
        </>
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
