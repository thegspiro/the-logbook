/**
 * A coordinator puts a member in a seat. For a Driver seat the list starts
 * with members the server has judged against the night's EVOC rule — the same
 * rule the assignment itself applies — and anyone else can still be picked
 * from the full roster, where the server decides on submit.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../Modal';
import { apparatusEventService } from '../../../services/api';
import {
  ApparatusEventEvocMode,
  ApparatusEventSeatType,
  type AssignableMember,
  type CrewBoard,
  type CrewSeat,
  type CrewUnit,
  type DriverCandidates,
} from '../../../types/apparatusEvent';
import { getErrorMessage } from '../../../utils/errorHandling';
import { TONE } from '../../../pages/apparatus-events/tones';

interface AssignSeatDialogProps {
  eventId: string;
  target: { unit: CrewUnit; seat: CrewSeat; label: string } | null;
  onClose: () => void;
  onAssigned: (board: CrewBoard) => void;
}

export const AssignSeatDialog: React.FC<AssignSeatDialogProps> = ({ eventId, target, onClose, onAssigned }) => {
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [drivers, setDrivers] = useState<DriverCandidates | null>(null);
  const [chosen, setChosen] = useState('');
  const [saving, setSaving] = useState(false);
  const isDriver = target?.seat.seat_type === ApparatusEventSeatType.DRIVER;

  useEffect(() => {
    if (!target) return;
    setChosen('');
    setDrivers(null);
    void apparatusEventService
      .getAssignableMembers()
      .then(setMembers)
      .catch((err: unknown) => toast.error(getErrorMessage(err, 'Could not load members.')));
    if (target.seat.seat_type === ApparatusEventSeatType.DRIVER) {
      void apparatusEventService
        .getDriverCandidates(eventId, target.unit.id)
        .then(setDrivers)
        .catch(() => setDrivers(null));
    }
  }, [eventId, target]);

  const verdicts = useMemo(() => new Map((drivers?.candidates ?? []).map((c) => [c.user_id, c])), [drivers]);

  if (!target) return null;

  const submit = async () => {
    if (!chosen) return;
    setSaving(true);
    try {
      const board = await apparatusEventService.assignSeat(eventId, target.seat.id, chosen);
      board.warnings.forEach((w) => toast(w.message, { icon: '⚠️' }));
      toast.success(`Assigned to ${target.label}`);
      onAssigned(board);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not assign the seat.'));
    } finally {
      setSaving(false);
    }
  };

  const ruleText =
    drivers?.evoc_mode === ApparatusEventEvocMode.IGNORE
      ? 'EVOC is not checked on this night.'
      : drivers?.required_evoc_level_name
        ? `${target.unit.unit_number} requires ${drivers.required_evoc_level_name}. Rule on this night: ${
            drivers.evoc_mode === ApparatusEventEvocMode.ENFORCE ? 'enforce' : 'warn only'
          }.`
        : `${target.unit.unit_number} has no EVOC level set, so anyone can drive it.`;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Assign ${target.label}`}
      size="md"
      footer={
        <>
          <button type="button" className="btn-primary" disabled={!chosen || saving} onClick={() => void submit()}>
            {saving ? 'Assigning…' : 'Assign'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {isDriver && (
          <section className="space-y-2" aria-labelledby="assign-drivers">
            <h3 id="assign-drivers" className="text-theme-text-primary text-sm font-semibold">
              Who can drive {target.unit.unit_number}
            </h3>
            <p className="text-theme-text-muted text-xs">{ruleText}</p>
            {drivers && drivers.candidates.length > 0 ? (
              <ul className="space-y-1.5">
                {drivers.candidates.map((c) => (
                  <li key={c.user_id}>
                    <label className="border-theme-surface-border hover:bg-theme-surface-hover touch:py-3 flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-sm">
                      <input
                        type="radio"
                        name="assign-member"
                        className="form-checkbox mt-0.5"
                        value={c.user_id}
                        checked={chosen === c.user_id}
                        onChange={() => setChosen(c.user_id)}
                      />
                      <span className="text-theme-text-primary flex-1">{c.name}</span>
                      {c.allowed ? (
                        <span className={`badge ${c.exception_valid_until ? TONE.blue : TONE.green}`}>
                          {c.exception_valid_until ? `Exception to ${c.exception_valid_until}` : 'Qualified'}
                        </span>
                      ) : (
                        <span className={`badge ${TONE.red}`}>Not qualified</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-theme-text-muted text-sm">
                {drivers ? 'Nobody holds an operator certification or driver exception yet.' : 'Checking…'}
              </p>
            )}
          </section>
        )}
        <div>
          <label className="form-label" htmlFor="assign-anyone">
            {isDriver ? 'Or choose anyone' : 'Member'}
          </label>
          <select id="assign-anyone" className="form-input" value={chosen} onChange={(e) => setChosen(e.target.value)}>
            <option value="">Choose a member…</option>
            {members.map((m) => {
              const verdict = verdicts.get(m.user_id);
              return (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                  {isDriver && verdict && !verdict.allowed ? ' (not qualified)' : ''}
                </option>
              );
            })}
          </select>
          {isDriver && (
            <p className="text-theme-text-muted mt-1 text-xs">
              The assignment is checked against the night’s EVOC rule when you press Assign.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default AssignSeatDialog;
