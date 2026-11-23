/**
 * Reshape one night — seats added, renamed or removed, the rules adjusted —
 * without touching its template or the other nights. A filled seat cannot be
 * removed here; the server refuses it too, rather than silently dropping
 * someone from the crew.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X } from 'lucide-react';
import { Modal } from '../../Modal';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { apparatusEventService } from '../../../services/api';
import {
  ApparatusEventEvocMode,
  ApparatusEventSeatType,
  type CrewBoard,
  type EditorOptions,
  type NightPlanPayload,
} from '../../../types/apparatusEvent';
import { getErrorMessage } from '../../../utils/errorHandling';
import { hoursWouldNotBeCredited, nextKey } from '../../../pages/apparatus-events/templateForm';
import HoursNotCreditedNote from '../../../pages/apparatus-events/HoursNotCreditedNote';

interface SeatRow {
  key: string;
  id?: string | undefined;
  name: string;
  seat_type: ApparatusEventSeatType;
  note: string;
  is_essential: boolean;
  occupant: string | null;
}

interface UnitRow {
  key: string;
  id: string;
  apparatus_id: string;
  unit_number: string;
  seats: SeatRow[];
}

interface EditNightDialogProps {
  board: CrewBoard | null;
  onClose: () => void;
  onSaved: (board: CrewBoard) => void;
  /** The crew was taken off the event entirely; the event itself stays. */
  onRemoved: () => void;
}

const rowsFrom = (board: CrewBoard): UnitRow[] =>
  board.units.map((unit) => ({
    key: nextKey(),
    id: unit.id,
    apparatus_id: unit.apparatus_id,
    unit_number: unit.unit_number,
    seats: unit.seats.map((seat) => ({
      key: nextKey(),
      id: seat.id,
      name: seat.name,
      seat_type: seat.seat_type,
      note: seat.note ?? '',
      is_essential: seat.is_essential,
      occupant: seat.user_name,
    })),
  }));

export const EditNightDialog: React.FC<EditNightDialogProps> = ({ board, onClose, onSaved, onRemoved }) => {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [evocMode, setEvocMode] = useState<ApparatusEventEvocMode>(ApparatusEventEvocMode.ENFORCE);
  const [selfSignup, setSelfSignup] = useState(true);
  const [showOnSchedule, setShowOnSchedule] = useState(true);
  const [categoryId, setCategoryId] = useState('');
  const [options, setOptions] = useState<EditorOptions | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm } = useConfirm();

  useEffect(() => {
    if (!board) return;
    setUnits(rowsFrom(board));
    setEvocMode(board.evoc_mode);
    setSelfSignup(board.allow_self_signup);
    setShowOnSchedule(board.show_on_schedule);
    setCategoryId(board.admin_hours_category_id ?? '');
    void apparatusEventService
      .getEditorOptions()
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [board]);

  if (!board) return null;

  const updateSeat = (unitKey: string, seatKey: string, patch: Partial<SeatRow>) =>
    setUnits((list) =>
      list.map((u) =>
        u.key === unitKey ? { ...u, seats: u.seats.map((s) => (s.key === seatKey ? { ...s, ...patch } : s)) } : u
      )
    );

  const invalid = units.some((u) => u.seats.length === 0 || u.seats.some((s) => !s.name.trim()));
  const anyoneSeated = units.some((u) => u.seats.some((s) => s.occupant));

  const removeCrew = async () => {
    const ok = await confirm({
      title: 'Remove the apparatus crew?',
      message:
        'The apparatus and every seat come off this event. The event itself stays on the calendar, and its hours go back to the event type’s usual category.',
      confirmLabel: 'Remove crew',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await apparatusEventService.removePlan(board.event_id);
      toast.success('Apparatus crew removed');
      onRemoved();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not remove the crew.'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const payload: NightPlanPayload = {
      evoc_mode: evocMode,
      allow_self_signup: selfSignup,
      show_on_schedule: showOnSchedule,
      // A cleared category is sent as null so the night falls back to the
      // event type's mapping, instead of an omitted key leaving it as it was.
      admin_hours_category_id: categoryId || null,
      units: units.map((u) => ({
        id: u.id,
        apparatus_id: u.apparatus_id,
        seats: u.seats.map((s) => ({
          id: s.id,
          name: s.name.trim(),
          seat_type: s.seat_type,
          note: s.note.trim() || undefined,
          // Always sent: the PUT replaces the night's seats, and a seat that
          // omitted it would turn essential again.
          is_essential: s.is_essential,
        })),
      })),
    };
    setSaving(true);
    try {
      const updated = await apparatusEventService.updateNightPlan(board.event_id, payload);
      updated.warnings.forEach((w) => toast(w.message, { icon: '⚠️' }));
      toast.success('Night updated');
      onSaved(updated);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not update this night.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit this night"
      size="lg"
      isDirty
      footer={
        <>
          <button type="button" className="btn-primary" disabled={saving || invalid} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save this night'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-secondary sm:mr-auto"
            onClick={() => void removeCrew()}
            disabled={saving || anyoneSeated}
            title={anyoneSeated ? 'Clear every seat before removing the crew' : undefined}
          >
            Remove crew
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-theme-text-muted text-sm">
          Changes apply to this night only. The template and the other nights stay as they are.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="night-evoc">
              Driver EVOC rule
            </label>
            <select
              id="night-evoc"
              className="form-input"
              value={evocMode}
              onChange={(e) => setEvocMode(e.target.value as ApparatusEventEvocMode)}
            >
              <option value={ApparatusEventEvocMode.ENFORCE}>Enforce</option>
              <option value={ApparatusEventEvocMode.WARN}>Warn only</option>
              <option value={ApparatusEventEvocMode.IGNORE}>Don’t check</option>
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="night-category">
              Admin Hours category
            </label>
            <select
              id="night-category"
              className="form-input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Use the event type’s mapping</option>
              {(options?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {categoryId && !options?.categories.some((c) => c.id === categoryId) && (
                <option value={categoryId}>{board.admin_hours_category_name ?? 'Current category'}</option>
              )}
            </select>
            {hoursWouldNotBeCredited(categoryId, board.event_type, options) && (
              <HoursNotCreditedNote
                eventType={board.event_type}
                hasCategories={(options?.categories.length ?? 0) > 0}
              />
            )}
          </div>
        </div>
        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={selfSignup}
            onChange={(e) => setSelfSignup(e.target.checked)}
          />
          Members can take open seats themselves
        </label>
        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={showOnSchedule}
            onChange={(e) => setShowOnSchedule(e.target.checked)}
          />
          Show on Shift Scheduling
        </label>

        {units.map((unit) => (
          <fieldset key={unit.key} className="border-theme-surface-border space-y-2 rounded-lg border p-3">
            <legend className="text-theme-text-primary px-1 text-sm font-semibold">{unit.unit_number}</legend>
            {unit.seats.map((seat, index) => (
              <div key={seat.key} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-end gap-2">
                <div>
                  <label className="form-label text-xs" htmlFor={`night-seat-${seat.key}`}>
                    Seat {index + 1}
                    {seat.occupant ? ` · ${seat.occupant}` : ''}
                  </label>
                  <input
                    id={`night-seat-${seat.key}`}
                    className="form-input"
                    value={seat.name}
                    maxLength={100}
                    onChange={(e) => updateSeat(unit.key, seat.key, { name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="form-label text-xs" htmlFor={`night-type-${seat.key}`}>
                    Type
                  </label>
                  <select
                    id={`night-type-${seat.key}`}
                    className="form-input"
                    value={seat.seat_type}
                    onChange={(e) =>
                      updateSeat(unit.key, seat.key, { seat_type: e.target.value as ApparatusEventSeatType })
                    }
                  >
                    <option value={ApparatusEventSeatType.DRIVER}>Driver · EVOC</option>
                    <option value={ApparatusEventSeatType.GENERAL}>General</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-icon"
                  aria-label={
                    seat.occupant ? `${seat.occupant} is in this seat; clear it first` : `Remove seat ${index + 1}`
                  }
                  title={seat.occupant ? 'Clear the seat on the crew board first' : undefined}
                  disabled={Boolean(seat.occupant) || unit.seats.length === 1}
                  onClick={() =>
                    setUnits((list) =>
                      list.map((u) =>
                        u.key === unit.key ? { ...u, seats: u.seats.filter((s) => s.key !== seat.key) } : u
                      )
                    )
                  }
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
                <label className="text-theme-text-secondary col-span-full flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={seat.is_essential}
                    onChange={(e) => updateSeat(unit.key, seat.key, { is_essential: e.target.checked })}
                  />
                  Essential: must be filled for this night to count as staffed
                </label>
              </div>
            ))}
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() =>
                setUnits((list) =>
                  list.map((u) =>
                    u.key === unit.key
                      ? {
                          ...u,
                          seats: [
                            ...u.seats,
                            {
                              key: nextKey(),
                              name: '',
                              seat_type: ApparatusEventSeatType.GENERAL,
                              note: '',
                              is_essential: true,
                              occupant: null,
                            },
                          ],
                        }
                      : u
                  )
                )
              }
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add seat
            </button>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
};

export default EditNightDialog;
