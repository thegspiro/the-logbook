/**
 * "Undo this step" for one committed step of a historical import.
 *
 * Removes what the step wrote so it can be decided again and recommitted. A
 * record an officer changed since the import is kept, and listed here after
 * the undo; a step a later one builds on waits for that step (the server
 * decides both, and this control only reports them).
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { historicalImportService } from '../../../modules/integrations/services/historicalImportApi';
import type {
  HistoricalUndoStep,
  UndoKeptRecord,
  UndoStepPreview,
} from '../../../modules/integrations/types/historicalImport';
import { formatNumber } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

/** Fired after any step is undone, so the other steps' controls re-read
 * whether they are still blocked. */
const UNDONE_EVENT = 'historical-import-step-undone';

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

interface StepUndoProps {
  importId: string;
  step: HistoricalUndoStep;
  /** What the step wrote, in the plural: "Admin Hours entries". */
  noun: string;
  /** Called after a successful undo, to reload the section. */
  onUndone: () => void;
}

const StepUndo: React.FC<StepUndoProps> = ({ importId, step, noun, onUndone }) => {
  const { confirm } = useConfirm();
  const [preview, setPreview] = useState<UndoStepPreview | null>(null);
  const [membersCreated, setMembersCreated] = useState(0);
  const [kept, setKept] = useState<{ total: number; examples: UndoKeptRecord[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await historicalImportService.getUndoPreview(importId);
      setPreview(view.steps[step] ?? null);
      setMembersCreated(view.members_created);
    } catch {
      // The step's own panel still works; only the undo is unavailable.
      setPreview(null);
    }
  }, [importId, step]);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener(UNDONE_EVENT, reload);
    return () => window.removeEventListener(UNDONE_EVENT, reload);
  }, [load]);

  if (!preview?.committed) {
    return kept && kept.total > 0 ? <KeptList kept={kept} noun={noun} /> : null;
  }

  const blocked = Boolean(preview.blocked_reason) || preview.blocked_by.length > 0;

  const undo = async () => {
    const lines = [
      `${plural(preview.removable, 'record is', 'records are')} removed.`,
      preview.kept_total > 0
        ? `${plural(preview.kept_total, 'record was', 'records were')} changed since the import and ${
            preview.kept_total === 1 ? 'is' : 'are'
          } kept.`
        : '',
      preview.reused
        ? `${plural(preview.reused, 'shift or seat it used but did not make is', 'shifts and seats it used but did not make are')} left as ${
            preview.reused === 1 ? 'it is' : 'they are'
          }${preview.positions_restored ? '.' : '; a member it moved to another seat keeps that seat.'}`
        : '',
      preview.positions_restored
        ? `${plural(preview.positions_restored, 'member it moved to another seat goes', 'members it moved to another seat go')} back to the seat they had.`
        : '',
      membersCreated > 0
        ? 'Former members this import created are removed too, unless something else still refers to them.'
        : '',
      'You can then change the decisions and commit the step again.',
    ];
    const ok = await confirm({
      title: `Undo the ${noun}?`,
      message: lines.filter(Boolean).join(' '),
      confirmLabel: 'Undo this step',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await historicalImportService.undoStep(importId, step);
      setKept({ total: preview.kept_total, examples: preview.kept });
      toast.success(
        `${plural(result.removed, 'record', 'records')} removed${
          result.members_removed ? `, and ${plural(result.members_removed, 'former member', 'former members')}` : ''
        }`
      );
      setPreview(result.preview.steps[step] ?? null);
      window.dispatchEvent(new Event(UNDONE_EVENT));
      onUndone();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not undo this step'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="split-row gap-3 sm:items-center">
      <p className="split-row-main text-theme-text-secondary text-sm">
        {blocked
          ? (preview.blocked_reason ??
            `To undo this step, first undo the ${preview.blocked_by.join(' and ')} step, which builds on it.`)
          : `Undoing removes the ${noun} this step wrote, so you can change the decisions and commit it again.`}
      </p>
      <button
        type="button"
        className="split-row-aside btn-secondary"
        disabled={busy || blocked}
        onClick={() => void undo()}
      >
        Undo this step
      </button>
    </div>
  );
};

const KeptList: React.FC<{ kept: { total: number; examples: UndoKeptRecord[] }; noun: string }> = ({ kept, noun }) => (
  <div role="status" className="alert-info space-y-1 text-sm">
    <p>
      {plural(kept.total, 'record was', 'records were')} kept because {kept.total === 1 ? 'it was' : 'they were'}{' '}
      changed after the import. Committing again leaves {kept.total === 1 ? 'it' : 'them'} as{' '}
      {kept.total === 1 ? 'it is' : 'they are'}; correct or delete {kept.total === 1 ? 'it' : 'them'} among the {noun}{' '}
      by hand.
    </p>
    <ul className="list-disc pl-5 text-xs">
      {kept.examples.map((k) => (
        <li key={k.record_id}>{k.label}</li>
      ))}
      {kept.total > kept.examples.length && <li>and {formatNumber(kept.total - kept.examples.length)} more</li>}
    </ul>
  </div>
);

export default StepUndo;
