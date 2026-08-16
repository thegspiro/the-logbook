/**
 * EVOC Levels Settings Section
 *
 * Manages the department's EVOC (Emergency Vehicle Operator Course) ladder and
 * the training program that certifies each level.
 *
 * This screen is what makes driver qualification real. Each level can be linked
 * to a training program; when a member completes that program the backend
 * auto-creates operator records on every apparatus requiring that level or
 * lower (see `EvocLevelService.auto_add_operators_for_evoc_completion`). Until
 * levels exist, apparatus carry no EVOC requirement and the driver checks pass
 * everyone unconditionally.
 *
 * Self-contained: owns its own fetching and state rather than threading a dozen
 * props through SettingsPage.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, X, Check, Link2, ShieldCheck, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { evocLevelService } from '../../modules/apparatus/services/api';
import type { EvocLevel } from '../../modules/apparatus/types';
import { trainingProgramService } from '../../services/api';
import type { TrainingProgram } from '../../types/training';
import { getErrorMessage } from '../../utils/errorHandling';
import { useConfirm } from '../../contexts/ConfirmContext';

interface LevelForm {
  levelNumber: string;
  name: string;
  code: string;
  description: string;
  isCumulative: boolean;
  trainingProgramId: string;
  isActive: boolean;
}

const EMPTY_FORM: LevelForm = {
  levelNumber: '',
  name: '',
  code: '',
  description: '',
  isCumulative: true,
  trainingProgramId: '',
  isActive: true,
};

const toForm = (level: EvocLevel): LevelForm => ({
  levelNumber: String(level.levelNumber),
  name: level.name,
  code: level.code,
  description: level.description ?? '',
  isCumulative: level.isCumulative,
  trainingProgramId: level.trainingProgramId ?? '',
  isActive: level.isActive,
});

const EvocLevelsSettingsSection: React.FC = () => {
  const { confirm } = useConfirm();
  const [levels, setLevels] = useState<EvocLevel[]>([]);
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingLevel, setEditingLevel] = useState<EvocLevel | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<LevelForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadLevels = useCallback(async () => {
    // activeOnly false: deactivated levels must stay visible here, since this
    // screen is the only place to reactivate one.
    const data = await evocLevelService.getLevels({ activeOnly: false });
    setLevels([...data].sort((a, b) => a.levelNumber - b.levelNumber));
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        await Promise.all([
          loadLevels(),
          trainingProgramService.getPrograms().then((data) => {
            setPrograms(data.filter((program) => !program.is_template));
          }),
        ]);
      } catch (err) {
        toast.error(getErrorMessage(err, 'Failed to load EVOC levels'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [loadLevels]);

  const resetForm = () => {
    setEditingLevel(null);
    setAdding(false);
    setForm(EMPTY_FORM);
  };

  const nextLevelNumber = () => {
    const highest = levels.reduce((max, level) => Math.max(max, level.levelNumber), 0);
    return String(Math.min(highest + 1, 10));
  };

  const handleSave = async () => {
    const levelNumber = Number(form.levelNumber);
    if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > 10) {
      toast.error('Level number must be between 1 and 10');
      return;
    }

    setSaving(true);
    try {
      if (editingLevel) {
        // Update: send every field the form owns, using null (not an omitted
        // key) to clear, or the backend's exclude_unset leaves the old value.
        await evocLevelService.updateLevel(editingLevel.id, {
          levelNumber,
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          description: form.description.trim() || null,
          isCumulative: form.isCumulative,
          trainingProgramId: form.trainingProgramId || null,
          isActive: form.isActive,
        });
        toast.success('EVOC level updated');
      } else {
        // Create: omit blanks so empty strings never reach a validator.
        await evocLevelService.createLevel({
          levelNumber,
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          description: form.description.trim() || undefined,
          isCumulative: form.isCumulative,
          trainingProgramId: form.trainingProgramId || undefined,
          sortOrder: levelNumber,
          isActive: form.isActive,
        });
        toast.success('EVOC level created');
      }
      await loadLevels();
      resetForm();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save EVOC level'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (level: EvocLevel) => {
    const confirmed = await confirm({
      title: `Delete ${level.name}?`,
      message:
        'Members certified at this level keep their operator records, but the level is removed from ' +
        'the ladder and can no longer be required by any apparatus. To keep the history and just ' +
        'stop using it, deactivate it instead.',
      confirmLabel: 'Delete level',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;

    setDeletingId(level.id);
    try {
      await evocLevelService.deleteLevel(level.id);
      toast.success('EVOC level deleted');
      await loadLevels();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete EVOC level'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (level: EvocLevel) => {
    try {
      await evocLevelService.updateLevel(level.id, { isActive: !level.isActive });
      await loadLevels();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update EVOC level'));
    }
  };

  const programName = (programId: string | null) =>
    programId ? (programs.find((program) => program.id === programId)?.name ?? null) : null;

  const isFormValid = form.name.trim() !== '' && form.code.trim() !== '' && form.levelNumber !== '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-theme-text-primary text-lg font-semibold">EVOC Levels</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            The driving certification ladder for your apparatus. Link a level to the training program that certifies it
            and members are added as operators automatically when they finish.
          </p>
        </div>
        {!adding && !editingLevel && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setEditingLevel(null);
              setForm({ ...EMPTY_FORM, levelNumber: nextLevelNumber() });
            }}
            className="btn-info inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Level
          </button>
        )}
      </div>

      {(adding || editingLevel) && (
        <div className="border-theme-surface-border bg-theme-surface-secondary/50 rounded-lg border p-4">
          <p className="text-theme-text-primary mb-3 text-sm font-medium">
            {editingLevel ? `Edit ${editingLevel.name}` : 'New EVOC Level'}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            <div className="sm:col-span-1">
              <label htmlFor="evoc-number" className="text-theme-text-muted mb-1 block text-xs font-medium">
                Level
              </label>
              <input
                id="evoc-number"
                type="number"
                min={1}
                max={10}
                value={form.levelNumber}
                onChange={(e) => setForm((prev) => ({ ...prev, levelNumber: e.target.value }))}
                className="form-input"
              />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="evoc-name" className="text-theme-text-muted mb-1 block text-xs font-medium">
                Name
              </label>
              <input
                id="evoc-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. EVOC 3 - Engine / Pumper"
                className="form-input"
                maxLength={100}
                autoFocus
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="evoc-code" className="text-theme-text-muted mb-1 block text-xs font-medium">
                Code
              </label>
              <input
                id="evoc-code"
                type="text"
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. EVOC3"
                className="form-input"
                maxLength={50}
              />
            </div>
          </div>

          <div className="mt-3">
            <label htmlFor="evoc-description" className="text-theme-text-muted mb-1 block text-xs font-medium">
              Description
            </label>
            <input
              id="evoc-description"
              type="text"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Which apparatus this level covers"
              className="form-input"
            />
          </div>

          <div className="mt-3">
            <label htmlFor="evoc-program" className="text-theme-text-muted mb-1 block text-xs font-medium">
              Certifying training program
            </label>
            <select
              id="evoc-program"
              value={form.trainingProgramId}
              onChange={(e) => setForm((prev) => ({ ...prev, trainingProgramId: e.target.value }))}
              className="form-input"
            >
              <option value="">Not linked — certify operators manually</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.name}
                </option>
              ))}
            </select>
            <p className="text-theme-text-muted mt-1 text-xs">
              Completing this program adds the member as an operator on every apparatus requiring this level.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-4">
            <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isCumulative}
                onChange={(e) => setForm((prev) => ({ ...prev, isCumulative: e.target.checked }))}
                className="form-checkbox"
              />
              Cumulative — grants all lower levels
            </label>
            <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                className="form-checkbox"
              />
              Active
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSave();
              }}
              disabled={saving || !isFormValid}
              className="btn-info inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {editingLevel ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
        </div>
      ) : levels.length === 0 ? (
        <p className="text-theme-text-muted py-8 text-center text-sm">
          No EVOC levels configured. Without them, apparatus cannot carry a driving requirement.
        </p>
      ) : (
        <div className="space-y-1">
          {levels.map((level) => {
            const linkedProgram = programName(level.trainingProgramId);
            return (
              <div
                key={level.id}
                className={`hover:bg-theme-surface-secondary/50 group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  level.isActive ? '' : 'opacity-60'
                }`}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-xs font-bold text-violet-700 dark:text-violet-400">
                  {level.levelNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-theme-text-primary text-sm font-medium">{level.name}</p>
                    <code className="bg-theme-surface-secondary text-theme-text-muted rounded-sm px-1.5 py-0.5 text-xs">
                      {level.code}
                    </code>
                    {level.isCumulative && (
                      <span className="text-theme-text-muted inline-flex items-center gap-1 text-[11px]">
                        <ShieldCheck className="h-3 w-3" />
                        Cumulative
                      </span>
                    )}
                    {!level.isActive && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        <EyeOff className="h-3 w-3" />
                        Inactive
                      </span>
                    )}
                  </div>
                  {level.description && <p className="text-theme-text-muted mt-0.5 text-xs">{level.description}</p>}
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs">
                    <Link2 className="text-theme-text-muted h-3 w-3 shrink-0" />
                    {linkedProgram ? (
                      <span className="text-theme-text-secondary">
                        Certified by <span className="font-medium">{linkedProgram}</span>
                      </span>
                    ) : (
                      <span className="text-theme-text-muted">
                        No certifying program — operators must be added by hand
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      void handleToggleActive(level);
                    }}
                    className="text-theme-text-muted hover:text-theme-accent-blue hover:bg-theme-accent-blue-muted rounded-sm px-2 py-1.5 text-xs"
                  >
                    {level.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLevel(level);
                      setAdding(false);
                      setForm(toForm(level));
                    }}
                    className="text-theme-text-muted hover:text-theme-accent-blue hover:bg-theme-accent-blue-muted rounded-sm p-1.5"
                    aria-label={`Edit ${level.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDelete(level);
                    }}
                    disabled={deletingId === level.id}
                    className="text-theme-text-muted rounded-sm p-1.5 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                    aria-label={`Delete ${level.name}`}
                  >
                    {deletingId === level.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EvocLevelsSettingsSection;
