/**
 * Pick open action items from earlier meetings to carry into these minutes.
 *
 * The server decides what is offered (approved minutes only, the same kind of
 * meeting unless asked, never executive-session items into another kind of
 * meeting). Carrying copies the item here and retires the original, so an item
 * is open in exactly one place.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCalendarDate, formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { OpenActionItem } from '../types/minutes';

interface CarryForwardDialogProps {
  isOpen: boolean;
  minutesId: string;
  onClose: () => void;
  onCarried: () => Promise<void> | void;
}

export const CarryForwardDialog: React.FC<CarryForwardDialogProps> = ({ isOpen, minutesId, onClose, onCarried }) => {
  const tz = useTimezone();
  const [items, setItems] = useState<OpenActionItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [otherTypes, setOtherTypes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [carrying, setCarrying] = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    try {
      setItems(await minutesService.getOpenActionItems(minutesId, otherTypes));
      setSelected(new Set());
    } catch (err: unknown) {
      setItems([]);
      setError(getErrorMessage(err, 'Could not load open action items'));
    }
  }, [minutesId, otherTypes]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCarry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected.size === 0) return;
    setCarrying(true);
    try {
      await minutesService.carryForward(minutesId, [...selected], otherTypes);
      toast.success(
        selected.size === 1 ? 'Carried 1 action item forward' : `Carried ${selected.size} action items forward`
      );
      await onCarried();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to carry the action items forward'));
    } finally {
      setCarrying(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Carry action items forward"
      size="lg"
      onSubmit={(e) => {
        void handleCarry(e);
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={carrying || selected.size === 0} className="btn-primary">
            {carrying ? 'Carrying…' : `Carry forward${selected.size > 0 ? ` (${selected.size})` : ''}`}
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-3 text-sm">
        Open items from earlier approved minutes. Each one you carry is copied into these minutes and no longer counts
        as open on the meeting that assigned it.
      </p>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="form-checkbox"
          checked={otherTypes}
          onChange={(e) => setOtherTypes(e.target.checked)}
        />
        <span className="text-theme-text-primary">Include items from other kinds of meetings</span>
      </label>

      {error && (
        <p className="alert-danger mb-3 text-sm" role="alert">
          {error}
        </p>
      )}
      {items === null ? (
        <p className="text-theme-text-muted text-sm" role="status">
          Loading open action items…
        </p>
      ) : items.length === 0 ? (
        <p className="text-theme-text-muted text-sm">There are no open action items from earlier meetings.</p>
      ) : (
        <fieldset>
          <legend className="sr-only">Open action items</legend>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="border-theme-surface-border rounded-lg border p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="form-checkbox mt-1"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="min-w-0">
                    <span className="text-theme-text-primary block text-sm font-medium">{item.description}</span>
                    <span className="text-theme-text-muted block text-xs">
                      {item.assignee_name ?? 'Unassigned'}
                      {item.due_date ? ` · due ${formatCalendarDate(item.due_date)}` : ''}
                      {` · from ${item.minutes_title} (${formatDate(item.meeting_date, tz)})`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </Modal>
  );
};

export default CarryForwardDialog;
