/**
 * What happened at an outreach event, recorded when it closes (owner decision,
 * 2026-11-20): how it went, which apparatus attended, what was handed out and
 * whether photos were taken with the host's consent. The Outreach Impact
 * report totals the materials and exports the rest.
 *
 * Rendered on the same rule as the guest headcount (`can_record_guest_headcount`:
 * events.manage, an outreach event that has started and is not cancelled), which
 * is the rule the save applies. Every field is sent on every save, so clearing
 * one clears it.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { NotebookPen, Plus, Trash2 } from 'lucide-react';
import { eventService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { Event, OutreachMaterial, OutreachPhotos } from '../../types/event';
import { getErrorMessage } from '../../utils/errorHandling';

interface EventOutreachCloseoutCardProps {
  event: Event;
  onSaved: (event: Event) => void;
}

interface ApparatusChoice {
  id: string;
  label: string;
}

const PHOTO_CHOICES: { value: OutreachPhotos | ''; label: string }[] = [
  { value: '', label: 'Not recorded' },
  { value: 'none', label: 'No photos were taken' },
  { value: 'consented', label: 'Photos taken, with the host’s consent' },
  { value: 'not_consented', label: 'Photos taken, without consent — do not publish' },
];

const EventOutreachCloseoutCard: React.FC<EventOutreachCloseoutCardProps> = ({ event, onSaved }) => {
  const [note, setNote] = useState(event.outreach_outcome_note ?? '');
  const [apparatusIds, setApparatusIds] = useState<string[]>(event.outreach_apparatus_ids ?? []);
  const [materials, setMaterials] = useState<OutreachMaterial[]>(event.outreach_materials ?? []);
  const [photos, setPhotos] = useState<OutreachPhotos | ''>(event.outreach_photos ?? '');
  const [apparatus, setApparatus] = useState<ApparatusChoice[]>([]);
  const [busy, setBusy] = useState(false);

  // A fresh event from the server (after a save, or a reload) resets the form.
  useEffect(() => {
    setNote(event.outreach_outcome_note ?? '');
    setApparatusIds(event.outreach_apparatus_ids ?? []);
    setMaterials(event.outreach_materials ?? []);
    setPhotos(event.outreach_photos ?? '');
  }, [event.outreach_outcome_note, event.outreach_apparatus_ids, event.outreach_materials, event.outreach_photos]);

  useEffect(() => {
    const load = async () => {
      try {
        const { options } = await schedulingService.getApparatusOptions();
        // Only real vehicles: a "default" type placeholder has no id to save.
        setApparatus(
          options
            .filter((o) => o.id && o.source !== 'default')
            .map((o) => ({ id: o.id ?? '', label: o.unit_number ? `${o.unit_number} — ${o.name}` : o.name }))
        );
      } catch {
        // Without the list the apparatus section offers nothing to tick; the
        // rest of the record still saves.
      }
    };
    void load();
  }, []);

  const toggleApparatus = (id: string) =>
    setApparatusIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const updateMaterial = (index: number, patch: Partial<OutreachMaterial>) =>
    setMaterials((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  const incomplete = materials.some((m) => !m.item.trim() || m.quantity < 1);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await eventService.setOutreachCloseout(event.id, {
        outcome_note: note.trim() || null,
        apparatus_ids: apparatusIds,
        materials: materials.map((m) => ({ item: m.item.trim(), quantity: m.quantity })),
        photos: photos || null,
      });
      onSaved(updated);
      toast.success('Close-out saved.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the close-out'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-4 p-6" aria-labelledby="event-closeout-heading">
      <div>
        <h2
          id="event-closeout-heading"
          className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold"
        >
          <NotebookPen className="h-5 w-5" aria-hidden="true" />
          How it went
        </h2>
        <p className="text-theme-text-muted text-sm">
          Recorded for the department&apos;s outreach report. What was handed out is totalled there.
        </p>
      </div>

      <div>
        <label htmlFor="closeout-note" className="form-label">
          Outcome and follow-ups
        </label>
        <textarea
          id="closeout-note"
          rows={3}
          maxLength={5000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="form-input"
        />
      </div>

      {apparatus.length > 0 && (
        <fieldset>
          <legend className="form-label">Apparatus that attended</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {apparatus.map((a) => (
              <label key={a.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={apparatusIds.includes(a.id)}
                  onChange={() => toggleApparatus(a.id)}
                />
                <span className="text-theme-text-primary">{a.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="form-label">Materials handed out</legend>
        {materials.map((m, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={m.item}
              maxLength={100}
              onChange={(e) => updateMaterial(index, { item: e.target.value })}
              placeholder="e.g. Smoke alarms"
              aria-label={`Material ${index + 1}`}
              className="form-input min-w-0 flex-1"
            />
            <input
              type="number"
              min={1}
              value={m.quantity || ''}
              onChange={(e) =>
                updateMaterial(index, {
                  quantity: e.target.value === '' ? 0 : Math.max(1, Math.min(100000, Number(e.target.value) || 1)),
                })
              }
              aria-label={`How many of material ${index + 1}`}
              className="form-input w-24"
            />
            <button
              type="button"
              onClick={() => setMaterials((prev) => prev.filter((_, i) => i !== index))}
              className="btn-icon text-theme-text-muted hover:text-red-700"
              aria-label={`Remove material ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setMaterials((prev) => [...prev, { item: '', quantity: 1 }])}
          className="touch-target-phone inline-flex items-center gap-1 text-sm font-medium text-red-700 dark:text-red-400"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add an item
        </button>
      </fieldset>

      <div>
        <label htmlFor="closeout-photos" className="form-label">
          Photos
        </label>
        <select
          id="closeout-photos"
          value={photos}
          onChange={(e) => setPhotos(e.target.value as OutreachPhotos | '')}
          className="form-input"
        >
          {PHOTO_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-end gap-3">
        {incomplete && <p className="text-sm text-red-800 dark:text-red-300">Give every item a name and a number.</p>}
        <button type="button" onClick={() => void save()} disabled={busy || incomplete} className="btn-primary">
          {busy ? 'Saving…' : 'Save close-out'}
        </button>
      </div>
    </section>
  );
};

export default EventOutreachCloseoutCard;
