/**
 * Practical Skills Settings Panel
 *
 * Chooses which of the two practical-skills systems the department runs.
 * Skills Testing scores a member against station sheets and an officer
 * validates the result; shift-report sign-offs record skills a shift officer
 * saw demonstrated, which raise the member's competency. Running both left
 * officers unsure which one counted, so a department runs one and the other's
 * screens are hidden. Nothing is deleted when switching.
 *
 * Rendered as Training Admin → Settings & Data → Practical Skills, which the
 * hub already gates on training.manage — the grant the server requires to
 * change this setting.
 */

import React, { useEffect, useState } from 'react';
import { ClipboardCheck, FileText, Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { PracticalSkillsMethod } from '../../constants/enums';
import { trainingModuleConfigService } from '../../services/api';
import { usePracticalSkillsStore } from '../../stores/practicalSkillsStore';
import { getErrorMessage } from '../../utils/errorHandling';

interface MethodOption {
  value: PracticalSkillsMethod;
  label: string;
  icon: typeof ClipboardCheck;
  summary: string;
  includes: string[];
}

const OPTIONS: MethodOption[] = [
  {
    value: PracticalSkillsMethod.SKILLS_TESTING,
    label: 'Skills Testing',
    icon: ClipboardCheck,
    summary: 'Members are tested against station sheets, scored step by step, and an officer validates the result.',
    includes: [
      'Skills Test Templates and Skills Test Records',
      'Critical criteria, retest limits and practice tests',
      'Members see their results on My Training',
    ],
  },
  {
    value: PracticalSkillsMethod.SHIFT_SIGNOFFS,
    label: 'Shift report sign-offs',
    icon: FileText,
    summary:
      'The shift officer ticks the skills a member demonstrated on their shift report, which raises their competency.',
    includes: [
      'The skills list on shift reports',
      'The Skill Evaluations list those skills are matched against',
      'Competency levels that rise with each sign-off',
    ],
  },
];

const labelOf = (value: PracticalSkillsMethod): string =>
  OPTIONS.find((option) => option.value === value)?.label ?? value;

export const PracticalSkillsSettingsPanel: React.FC = () => {
  const { confirm } = useConfirm();
  const setStoredMethod = usePracticalSkillsStore((state) => state.setMethod);
  const [saved, setSaved] = useState<PracticalSkillsMethod | null>(null);
  const [selected, setSelected] = useState<PracticalSkillsMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    trainingModuleConfigService
      .getConfig()
      .then((config) => {
        if (cancelled) return;
        setSaved(config.practical_skills_method);
        setSelected(config.practical_skills_method);
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load settings');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    if (!selected || selected === saved) return;
    const hidden = OPTIONS.find((option) => option.value !== selected);
    const proceed = await confirm({
      title: `Switch to ${labelOf(selected)}?`,
      message: (
        <>
          <p>
            {hidden?.label} will be hidden from Training Administration, the navigation and My Training, and will stop
            recording anything new.
          </p>
          <p className="mt-2">
            Nothing is deleted. Past {hidden?.label.toLowerCase()} records stay on file, and switching back shows them
            again.
          </p>
        </>
      ),
      confirmLabel: `Switch to ${labelOf(selected)}`,
      cancelLabel: 'Keep current setting',
      variant: 'warning',
    });
    if (!proceed) return;

    setSaving(true);
    try {
      const result = await trainingModuleConfigService.updateConfig({ practical_skills_method: selected });
      setSaved(result.practical_skills_method);
      setSelected(result.practical_skills_method);
      setStoredMethod(result.practical_skills_method);
      toast.success(`${labelOf(result.practical_skills_method)} is now the department's practical skills method`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center" aria-busy="true">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading settings</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-6">
      <div>
        <h2 className="text-theme-text-primary text-lg font-semibold">Practical skills method</h2>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Choose how the department records practical skills. The other method is hidden everywhere and records nothing
          new; nothing already recorded is deleted.
        </p>
      </div>

      <div role="radiogroup" aria-label="Practical skills method" className="grid gap-4 md:grid-cols-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = selected === option.value;
          return (
            <label
              key={option.value}
              className={`card flex cursor-pointer flex-col gap-3 p-4 transition-colors ${
                isSelected ? 'border-red-800 ring-2 ring-red-800' : 'hover:bg-theme-surface-hover'
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  name="practical-skills-method"
                  value={option.value}
                  checked={isSelected}
                  onChange={() => setSelected(option.value)}
                  className="form-checkbox"
                />
                <span className="bg-theme-surface-secondary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="text-theme-accent-red h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-theme-text-primary font-semibold">
                  {option.label}
                  {saved === option.value && (
                    <span className="text-theme-text-muted ml-2 text-xs font-normal">Current</span>
                  )}
                </span>
              </span>
              <span className="text-theme-text-secondary text-sm">{option.summary}</span>
              <ul className="text-theme-text-secondary list-disc space-y-1 pl-5 text-sm">
                {option.includes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !selected || selected === saved}
          className="btn-primary flex items-center gap-2"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          Save
        </button>
      </div>
    </div>
  );
};

export default PracticalSkillsSettingsPanel;
