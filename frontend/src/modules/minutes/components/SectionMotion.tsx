/**
 * The motion behind a section such as "Approval of Previous Minutes" or
 * "Adjournment".
 *
 * The outline marks which sections the body moves and seconds and supplies the
 * wording, so the secretary arrives at the section with the motion written and
 * only has to say who moved, who seconded and how it came out. A section with a
 * motion recorded shows it; one without shows a reminder. The reminder never
 * blocks anything: a department sometimes acts by consent or by acclamation.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Gavel } from 'lucide-react';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import { PersonPicker } from './PersonPicker';
import type { AttendeeEntry, Motion, MotionStatus, SectionEntry } from '../types/minutes';

const RESULTS: { value: MotionStatus; label: string }[] = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'tabled', label: 'Tabled' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

const RESULT_BADGE: Record<MotionStatus, string> = {
  passed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  tabled: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  withdrawn: 'bg-theme-surface-secondary text-theme-text-primary',
};

interface SectionMotionProps {
  minutesId: string;
  section: SectionEntry;
  /** Every motion on the minutes; this section's are picked out by key. */
  motions: Motion[];
  attendees: AttendeeEntry[];
  /** The secretary, on minutes that can still be edited. */
  canRecord: boolean;
  onRecorded: () => Promise<void> | void;
}

export const SectionMotion: React.FC<SectionMotionProps> = ({
  minutesId,
  section,
  motions,
  attendees,
  canRecord,
  onRecorded,
}) => {
  const recorded = motions.filter((m) => m.section_key === section.key);
  const [text, setText] = useState(section.motion_text ?? '');
  const [movedBy, setMovedBy] = useState('');
  const [secondedBy, setSecondedBy] = useState('');
  const [result, setResult] = useState<MotionStatus>('passed');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!section.needs_motion && recorded.length === 0) return null;

  const record = async () => {
    const wording = text.trim();
    if (!wording) {
      setError('Write the motion first.');
      return;
    }
    if (movedBy.trim() && movedBy.trim().toLowerCase() === secondedBy.trim().toLowerCase()) {
      setError('The person who moved cannot also second.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await minutesService.addMotion(minutesId, {
        motion_text: wording,
        moved_by: movedBy.trim() || undefined,
        seconded_by: secondedBy.trim() || undefined,
        status: result,
        section_key: section.key,
        order: motions.length,
      });
      toast.success('Motion recorded');
      await onRecorded();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to record the motion'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-secondary mt-3 p-3" role="group" aria-label={`Motion for ${section.title}`}>
      <div className="mb-2 flex items-center gap-2">
        <Gavel className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
        <h4 className="text-theme-text-primary text-sm font-semibold">Motion</h4>
        {recorded.length === 0 && canRecord && (
          <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-400">
            Needs a motion and a second
          </span>
        )}
      </div>

      {recorded.map((motion) => (
        <div key={motion.id} className="mb-2">
          <p className="text-theme-text-primary text-sm">{motion.motion_text}</p>
          <div className="text-theme-text-muted mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span>Moved by: {motion.moved_by || 'not recorded'}</span>
            <span>Seconded by: {motion.seconded_by || 'not recorded'}</span>
            <span className={`rounded-sm px-2 py-0.5 font-medium ${RESULT_BADGE[motion.status]}`}>{motion.status}</span>
          </div>
        </div>
      ))}

      {recorded.length === 0 && !canRecord && (
        <p className="text-theme-text-muted text-sm italic">No motion was recorded for this section.</p>
      )}

      {recorded.length === 0 && canRecord && (
        <div className="space-y-3">
          {error && (
            <p className="alert-danger text-sm" role="alert">
              {error}
            </p>
          )}
          <div>
            <label htmlFor={`motion-text-${section.key}`} className="form-label">
              Motion
            </label>
            <textarea
              id={`motion-text-${section.key}`}
              rows={2}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="form-input"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <PersonPicker
              id={`motion-moved-${section.key}`}
              label="Moved by"
              value={movedBy}
              onChange={setMovedBy}
              attendees={attendees}
            />
            <PersonPicker
              id={`motion-seconded-${section.key}`}
              label="Seconded by"
              value={secondedBy}
              onChange={setSecondedBy}
              attendees={attendees}
              exclude={movedBy}
            />
            <div>
              <label htmlFor={`motion-result-${section.key}`} className="form-label">
                Result
              </label>
              <select
                id={`motion-result-${section.key}`}
                value={result}
                onChange={(e) => setResult(e.target.value as MotionStatus)}
                className="form-input"
              >
                {RESULTS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void record();
            }}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Recording…' : 'Record motion'}
          </button>
        </div>
      )}
    </div>
  );
};

export default SectionMotion;
