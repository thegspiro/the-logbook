/**
 * Shift Evaluation Settings Panel
 *
 * The department's evaluation forms (a preceptor's "EMT Shift Evaluation",
 * a driver candidate's driver evaluation) and how they are used: which form is
 * the general one for members in no program, whether it is optional or
 * required, and whether one evaluation counts for several programs. A program
 * picks its own form on the program's edit screen.
 *
 * Rendered as Training Admin → Settings & Data → Shift Evaluations, which the
 * hub gates on training.manage; the server accepts training.manage or
 * training.configure.
 *
 * Nothing reads these forms on a shift yet — the shift report starts using
 * them in the next release — so the panel says so rather than letting a
 * department believe a form is already being filled out (Pitfall #19).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, FilePlus2, Info, Loader2, Pencil, Save, Sparkles, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ShiftEvaluationTemplateEditor } from '../../components/training/ShiftEvaluationTemplateEditor';
import { useConfirm } from '../../contexts/ConfirmContext';
import { shiftEvaluationTemplateService } from '../../services/api';
import {
  GeneralShiftEvaluationMode,
  type ShiftEvaluationSettings,
  type ShiftEvaluationTemplate,
  type ShiftEvaluationTemplateWrite,
} from '../../types/training';
import { getErrorMessage } from '../../utils/errorHandling';
import { blankShiftEvaluationTemplate } from '../../utils/shiftEvaluationTemplates';

interface EditorState {
  /** Absent for a template not saved yet. */
  id?: string | undefined;
  heading: string;
  body: ShiftEvaluationTemplateWrite;
}

const MODE_OPTIONS: { value: GeneralShiftEvaluationMode; label: string; hint: string }[] = [
  { value: GeneralShiftEvaluationMode.OFF, label: 'Off', hint: 'Only members in a program are evaluated.' },
  {
    value: GeneralShiftEvaluationMode.OPTIONAL,
    label: 'Optional',
    hint: 'The shift officer may evaluate members in the chosen seats.',
  },
  {
    value: GeneralShiftEvaluationMode.REQUIRED,
    label: 'Required',
    hint: 'Members in the chosen seats must be evaluated before the shift is closed out.',
  },
];

/** The fields a saved template sends back when it is edited. */
const toWrite = (template: ShiftEvaluationTemplate): ShiftEvaluationTemplateWrite => ({
  name: template.name,
  description: template.description ?? null,
  is_active: template.is_active,
  scale: template.scale,
  allow_not_applicable: template.allow_not_applicable,
  not_applicable_label: template.not_applicable_label,
  comment_required_at_or_below: template.comment_required_at_or_below,
  header_fields: template.header_fields,
  statistics: template.statistics,
  sections: template.sections,
  closing_comments_label: template.closing_comments_label ?? null,
  closing_comments_hint: template.closing_comments_hint ?? null,
  evaluator_rule: template.evaluator_rule,
  evaluated_seats: template.evaluated_seats,
});

const itemCount = (template: ShiftEvaluationTemplateWrite) =>
  template.sections.reduce((total, section) => total + section.items.length, 0);

const ShiftEvaluationSettingsPanel: React.FC = () => {
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ShiftEvaluationTemplate[]>([]);
  const [settings, setSettings] = useState<ShiftEvaluationSettings | null>(null);
  const [draftSettings, setDraftSettings] = useState<ShiftEvaluationSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);

  const load = useCallback(async () => {
    const [list, current] = await Promise.all([
      shiftEvaluationTemplateService.list(),
      shiftEvaluationTemplateService.getSettings(),
    ]);
    setTemplates(list);
    setSettings(current);
    setDraftSettings(current);
  }, []);

  const refreshTemplates = useCallback(async () => {
    setTemplates(await shiftEvaluationTemplateService.list());
  }, []);

  /**
   * A delete can change the saved settings too (the server turns the general
   * form off when it was that template). Take the new saved values as the
   * baseline, but keep the officer's unsaved choices, dropping only a choice
   * of the template that no longer exists.
   */
  const refreshAfterDelete = useCallback(async (deletedId: string) => {
    const [list, current] = await Promise.all([
      shiftEvaluationTemplateService.list(),
      shiftEvaluationTemplateService.getSettings(),
    ]);
    setTemplates(list);
    setSettings(current);
    setDraftSettings((prev) => {
      if (!prev) return current;
      if (prev.general_shift_evaluation_template_id === deletedId) {
        return {
          ...prev,
          general_shift_evaluation_template_id: null,
          general_shift_evaluation_mode: GeneralShiftEvaluationMode.OFF,
        };
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .catch(() => {
        if (!cancelled) toast.error('Failed to load shift evaluation settings');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const startFromExample = async () => {
    setLoadingExample(true);
    try {
      const example = await shiftEvaluationTemplateService.getExample();
      const taken = new Set(templates.map((t) => t.name.toLowerCase()));
      let name = example.name;
      for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${example.name} (${n})`;
      setEditor({ heading: 'New template from example', body: { ...example, name } });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load the example template'));
    } finally {
      setLoadingExample(false);
    }
  };

  const saveTemplate = async (body: ShiftEvaluationTemplateWrite) => {
    if (!editor) return;
    setSavingTemplate(true);
    try {
      if (editor.id) {
        await shiftEvaluationTemplateService.update(editor.id, body);
        toast.success('Template saved');
      } else {
        await shiftEvaluationTemplateService.create(body);
        toast.success('Template created');
      }
      setEditor(null);
      // Only the list: the settings card may hold unsaved choices.
      await refreshTemplates();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the template'));
    } finally {
      setSavingTemplate(false);
    }
  };

  const deleteTemplate = async (template: ShiftEvaluationTemplate) => {
    const consequences: string[] = [];
    if (template.program_names.length > 0) {
      consequences.push(`${template.program_names.join(', ')} will have no evaluation form.`);
    }
    if (template.is_general_form) consequences.push('The general shift evaluation will be turned off.');
    const ok = await confirm({
      title: `Delete ${template.name}?`,
      message: (
        <div className="space-y-2">
          <p>The template is removed for good.</p>
          {consequences.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ),
      confirmLabel: 'Delete template',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await shiftEvaluationTemplateService.remove(template.id);
      toast.success('Template deleted');
      await refreshAfterDelete(template.id);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete the template'));
    }
  };

  const saveSettings = async () => {
    if (!draftSettings) return;
    setSavingSettings(true);
    try {
      const saved = await shiftEvaluationTemplateService.updateSettings({
        general_shift_evaluation_template_id: draftSettings.general_shift_evaluation_template_id,
        general_shift_evaluation_mode: draftSettings.general_shift_evaluation_mode,
        one_shift_evaluation_for_multiple_programs: draftSettings.one_shift_evaluation_for_multiple_programs,
      });
      setSettings(saved);
      setDraftSettings(saved);
      toast.success('Shift evaluation settings saved');
      // The list's "General form" badge follows the saved choice.
      await refreshTemplates();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save settings'));
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" aria-busy="true">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (editor) {
    return (
      <div className="py-6">
        <ShiftEvaluationTemplateEditor
          initial={editor.body}
          heading={editor.heading}
          saving={savingTemplate}
          onSave={(body) => void saveTemplate(body)}
          onCancel={() => setEditor(null)}
        />
      </div>
    );
  }

  const generalChoices = templates.filter(
    (t) => t.is_active || t.id === draftSettings?.general_shift_evaluation_template_id
  );
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(draftSettings);
  const noGeneralForm = !draftSettings?.general_shift_evaluation_template_id;

  return (
    <div className="space-y-6 py-6">
      <div>
        <h2 className="text-theme-text-primary text-lg font-semibold">Shift Evaluations</h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          The forms a shift officer fills out to evaluate a member after a shift. A training program chooses its own
          form on the program&apos;s edit screen, so a driver candidate gets the driver evaluation.
        </p>
      </div>

      <div className="alert-info text-theme-alert-info-text flex gap-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="font-semibold">Not in use on shifts yet.</span> You can build forms and attach them to
          programs now. Shift reports start asking for them in an upcoming update; until then nobody is asked to fill
          one out.
        </p>
      </div>

      {/* Department settings */}
      {draftSettings && (
        <section className="card space-y-4 p-4" aria-labelledby="se-general-heading">
          <h3 id="se-general-heading" className="text-theme-text-primary font-semibold">
            General shift evaluation
          </h3>
          <p className="text-theme-text-muted text-sm">
            For members in no training program. Which seats are evaluated is set on the form itself.
          </p>
          <div>
            <label htmlFor="se-general-form" className="form-label">
              General form
            </label>
            <select
              id="se-general-form"
              className="form-input text-sm"
              value={draftSettings.general_shift_evaluation_template_id ?? ''}
              onChange={(e) =>
                setDraftSettings({
                  ...draftSettings,
                  general_shift_evaluation_template_id: e.target.value || null,
                  general_shift_evaluation_mode: e.target.value
                    ? draftSettings.general_shift_evaluation_mode
                    : GeneralShiftEvaluationMode.OFF,
                })
              }
            >
              <option value="">No general form</option>
              {generalChoices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_active ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </div>
          <fieldset disabled={noGeneralForm}>
            <legend className="form-label">When it is used</legend>
            <div className="space-y-2">
              {MODE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="se-general-mode"
                    className="form-checkbox mt-0.5"
                    checked={draftSettings.general_shift_evaluation_mode === option.value}
                    onChange={() => setDraftSettings({ ...draftSettings, general_shift_evaluation_mode: option.value })}
                  />
                  <span>
                    <span className="text-theme-text-primary font-medium">{option.label}</span>
                    <span className="text-theme-text-muted block text-xs">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={draftSettings.one_shift_evaluation_for_multiple_programs}
              onChange={(e) =>
                setDraftSettings({ ...draftSettings, one_shift_evaluation_for_multiple_programs: e.target.checked })
              }
            />
            <span>
              <span className="text-theme-text-primary font-medium">One evaluation counts for every program</span>
              <span className="text-theme-text-muted block text-xs">
                For a member in two programs on the same shift. When the programs use different forms, the shift officer
                picks which one to fill out. Off: one evaluation per program.
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary flex items-center gap-2"
              disabled={!settingsChanged || savingSettings}
              onClick={() => void saveSettings()}
            >
              {savingSettings ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save settings
            </button>
          </div>
        </section>
      )}

      {/* Templates */}
      <section className="card space-y-4 p-4" aria-labelledby="se-templates-heading">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="se-templates-heading" className="text-theme-text-primary flex-1 font-semibold">
            Evaluation templates
          </h3>
          <button
            type="button"
            className="btn-secondary flex items-center gap-2 text-sm"
            disabled={loadingExample}
            onClick={() => void startFromExample()}
          >
            {loadingExample ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Start from example
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-2 text-sm"
            onClick={() => setEditor({ heading: 'New template', body: blankShiftEvaluationTemplate() })}
          >
            <FilePlus2 className="h-4 w-4" /> New template
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="text-theme-text-muted flex flex-col items-center gap-2 py-8 text-center text-sm">
            <ClipboardList className="h-8 w-8" aria-hidden="true" />
            <p>No evaluation templates yet. Start from the example EMT form, or build your own.</p>
          </div>
        ) : (
          <ul className="divide-theme-surface-border divide-y">
            {templates.map((template) => (
              <li key={template.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-theme-text-primary font-medium">{template.name}</span>
                    {template.is_general_form && (
                      <span className="badge bg-theme-alert-info-bg text-theme-alert-info-text">General form</span>
                    )}
                    {!template.is_active && (
                      <span className="badge bg-theme-surface-secondary text-theme-text-secondary">Inactive</span>
                    )}
                  </div>
                  <p className="text-theme-text-muted text-xs">
                    {itemCount(template)} items · version {template.version}
                    {template.program_names.length > 0 ? ` · Used by ${template.program_names.join(', ')}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary flex items-center gap-1 text-sm"
                  aria-label={`Edit ${template.name}`}
                  onClick={() => setEditor({ id: template.id, heading: template.name, body: toWrite(template) })}
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Delete ${template.name}`}
                  onClick={() => void deleteTemplate(template)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default ShiftEvaluationSettingsPanel;
