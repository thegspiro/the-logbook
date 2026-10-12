/**
 * Skill Evaluations — the department's list of skills that need a sign-off.
 *
 * A skill score on a shift report becomes a checkoff, competency history and
 * pipeline progress only when the skill's name matches one defined here,
 * ignoring case. Nothing used to create these, so every score stopped at the
 * report and every apparatus skill tag in Shift Report settings read amber.
 *
 * Rendered as Training Admin → Setup → Skill Evaluations.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Award, Loader2, Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../components/Modal';
import { EmptyState } from '../../components/ux/EmptyState';
import { useConfirm } from '../../contexts/ConfirmContext';
import { roleService } from '../../services/api';
import { skillEvaluationService } from '../../services/skillEvaluationService';
import { useMemberSearch } from '../../hooks/useMemberSearch';
import { getErrorMessage } from '../../utils/errorHandling';
import { describeEvaluators } from '../../utils/skillEvaluators';
import type { Role } from '../../types/role';
import type {
  SkillEvaluation,
  SkillEvaluationCreate,
  SkillEvaluationUpdate,
  SkillEvaluators,
} from '../../types/skillEvaluation';

type EvaluatorMode = 'default' | 'roles' | 'specific_users';

interface FormState {
  name: string;
  category: string;
  description: string;
  criteria: string;
  passingRequirements: string;
  evaluatorMode: EvaluatorMode;
  roles: string[];
  members: { id: string; name: string }[];
}

const emptyForm: FormState = {
  name: '',
  category: '',
  description: '',
  criteria: '',
  passingRequirements: '',
  evaluatorMode: 'default',
  roles: [],
  members: [],
};

function formFrom(skill: SkillEvaluation): FormState {
  const ev = skill.allowed_evaluators;
  return {
    name: skill.name,
    category: skill.category ?? '',
    description: skill.description ?? '',
    criteria: (skill.evaluation_criteria ?? []).join('\n'),
    passingRequirements: skill.passing_requirements ?? '',
    evaluatorMode: ev?.type ?? 'default',
    roles: ev?.type === 'roles' ? ev.roles : [],
    members: ev?.type === 'specific_users' ? skill.evaluator_members : [],
  };
}

function evaluatorsFrom(form: FormState): SkillEvaluators | null {
  if (form.evaluatorMode === 'roles') return { type: 'roles', roles: form.roles };
  if (form.evaluatorMode === 'specific_users') {
    return { type: 'specific_users', user_ids: form.members.map((m) => m.id) };
  }
  return null;
}

function criteriaFrom(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const EvaluatorMemberPicker: React.FC<{
  members: { id: string; name: string }[];
  onChange: (members: { id: string; name: string }[]) => void;
}> = ({ members, onChange }) => {
  const [query, setQuery] = useState('');
  const { results, loading, tooShort } = useMemberSearch(query);
  const chosen = new Set(members.map((m) => m.id));
  return (
    <div className="space-y-2">
      {members.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Named evaluators">
          {members.map((m) => (
            <li key={m.id} className="badge bg-theme-surface-secondary text-theme-text-primary gap-1">
              {m.name}
              <button
                type="button"
                className="touch:min-h-11 touch:min-w-11 inline-flex items-center justify-center"
                aria-label={`Remove ${m.name}`}
                onClick={() => onChange(members.filter((x) => x.id !== m.id))}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="search"
        className="form-input"
        placeholder="Search members by name"
        aria-label="Search members to add as evaluators"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!tooShort && (
        <ul className="border-theme-surface-border divide-theme-surface-border max-h-48 divide-y overflow-y-auto rounded-md border">
          {loading && <li className="text-theme-text-muted p-2 text-sm">Searching…</li>}
          {!loading && results.length === 0 && <li className="text-theme-text-muted p-2 text-sm">No matches</li>}
          {results
            .filter((r) => !chosen.has(r.id))
            .map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="hover:bg-theme-surface-hover touch:min-h-11 w-full p-2 text-left text-sm"
                  onClick={() => {
                    onChange([...members, r]);
                    setQuery('');
                  }}
                >
                  {r.name}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
};

const SkillEvaluationsTab: React.FC = () => {
  const { confirm } = useConfirm();
  const [skills, setSkills] = useState<SkillEvaluation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<SkillEvaluation | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSkills(await skillEvaluationService.list(showInactive));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load skills'));
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  // Positions for the evaluator editor. Best effort: reading them needs
  // positions.view, and an officer without it can still use the other rules.
  useEffect(() => {
    void (async () => {
      try {
        setRoles(await roleService.getRoles());
      } catch {
        setRoles([]);
      }
    })();
  }, []);

  const openNew = () => {
    setForm(emptyForm);
    setEditing('new');
  };

  const openEdit = (skill: SkillEvaluation) => {
    setForm(formFrom(skill));
    setEditing(skill);
  };

  const close = () => {
    if (!saving) setEditing(null);
  };

  const evaluatorRuleIncomplete =
    (form.evaluatorMode === 'roles' && form.roles.length === 0) ||
    (form.evaluatorMode === 'specific_users' && form.members.length === 0);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (evaluatorRuleIncomplete) {
      toast.error(form.evaluatorMode === 'roles' ? 'Choose at least one position' : 'Add at least one member');
      return;
    }
    setSaving(true);
    try {
      if (editing === 'new') {
        // Create: blanks are omitted (Pitfall #1).
        const payload: SkillEvaluationCreate = {
          name: form.name.trim(),
          category: form.category.trim() || undefined,
          description: form.description.trim() || undefined,
          evaluation_criteria: criteriaFrom(form.criteria),
          passing_requirements: form.passingRequirements.trim() || undefined,
          allowed_evaluators: evaluatorsFrom(form),
        };
        await skillEvaluationService.create(payload);
        toast.success('Skill added');
      } else if (editing) {
        // Update: every field the form owns is sent, cleared ones as null, so
        // emptying a box actually clears it.
        const payload: SkillEvaluationUpdate = {
          name: form.name.trim(),
          category: form.category.trim() || null,
          description: form.description.trim() || null,
          evaluation_criteria: criteriaFrom(form.criteria),
          passing_requirements: form.passingRequirements.trim() || null,
          allowed_evaluators: evaluatorsFrom(form),
        };
        await skillEvaluationService.update(editing.id, payload);
        toast.success('Skill saved');
      }
      setEditing(null);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save skill'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (skill: SkillEvaluation) => {
    if (skill.active) {
      const ok = await confirm({
        title: 'Deactivate skill?',
        message: `Shift-report scores for "${skill.name}" will stop creating sign-offs. Its history is kept, and you can reactivate it later.`,
        confirmLabel: 'Deactivate',
        cancelLabel: 'Keep it active',
        variant: 'warning',
      });
      if (!ok) return;
    }
    try {
      await skillEvaluationService.update(skill.id, { active: !skill.active });
      toast.success(skill.active ? 'Skill deactivated' : 'Skill reactivated');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update skill'));
    }
  };

  const remove = async (skill: SkillEvaluation) => {
    const ok = await confirm({
      title: 'Delete skill?',
      message: `"${skill.name}" has no sign-offs yet, so nothing is lost. This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await skillEvaluationService.remove(skill.id);
      toast.success('Skill deleted');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete skill'));
    }
  };

  return (
    <div className="space-y-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-theme-text-primary text-lg font-semibold">Skill Evaluations</h2>
          <p className="text-theme-text-secondary text-sm">
            Skills that need a sign-off. A skill score on a shift report counts toward competency and pipeline progress
            only when its name matches a skill here (capitals don&apos;t matter).
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={openNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add skill
        </button>
      </div>

      <label className="text-theme-text-secondary touch:min-h-11 inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="form-checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        Show inactive skills
      </label>

      {loading ? (
        <div className="flex h-32 items-center justify-center" role="status">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading skills</span>
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No skills defined yet"
          description="Add the skills your officers sign off on shift reports, using the same names as your apparatus skill lists."
          actions={[{ label: 'Add skill', onClick: openNew, icon: Plus }]}
        />
      ) : (
        <ul className="card-grid">
          {skills.map((skill) => (
            <li key={skill.id} className="card flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-theme-text-primary font-semibold break-words">{skill.name}</h3>
                  {skill.category && <p className="text-theme-text-muted text-xs">{skill.category}</p>}
                </div>
                {!skill.active && (
                  <span className="badge bg-theme-surface-secondary text-theme-text-secondary">Inactive</span>
                )}
              </div>
              {skill.description && <p className="text-theme-text-secondary text-sm">{skill.description}</p>}
              <dl className="text-theme-text-secondary space-y-1 text-sm">
                <div>
                  <dt className="sr-only">Who can sign off</dt>
                  <dd>{describeEvaluators(skill, roles)}</dd>
                </div>
                <div>
                  <dt className="sr-only">Criteria and sign-offs</dt>
                  <dd>
                    {(skill.evaluation_criteria ?? []).length} criteria · {skill.checkoff_count} sign-off
                    {skill.checkoff_count === 1 ? '' : 's'}
                  </dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => openEdit(skill)}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit
                </button>
                <button type="button" className="btn-secondary" onClick={() => void toggleActive(skill)}>
                  <Power className="h-4 w-4" aria-hidden="true" />
                  {skill.active ? 'Deactivate' : 'Reactivate'}
                </button>
                {skill.checkoff_count === 0 && (
                  <button type="button" className="btn-secondary" onClick={() => void remove(skill)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={editing !== null}
        onClose={close}
        title={editing === 'new' ? 'Add skill' : 'Edit skill'}
        size="lg"
        onSubmit={(e) => void handleSubmit(e)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={close} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="skill-name" className="form-label">
              Name
            </label>
            <input
              id="skill-name"
              className="form-input"
              required
              maxLength={255}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {editing !== 'new' && editing && form.name.trim().toLowerCase() !== editing.name.toLowerCase() && (
              <p className="text-theme-text-muted mt-1 text-xs">
                Renaming unlinks apparatus skill lists that use the old name until they are renamed too.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="skill-category" className="form-label">
              Category (optional)
            </label>
            <input
              id="skill-category"
              className="form-input"
              maxLength={100}
              placeholder="e.g. Driver, EMS, Firefighting"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="skill-description" className="form-label">
              Description (optional)
            </label>
            <textarea
              id="skill-description"
              className="form-input"
              rows={2}
              maxLength={5000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="skill-criteria" className="form-label">
              Criteria (one per line, optional)
            </label>
            <textarea
              id="skill-criteria"
              className="form-input"
              rows={4}
              value={form.criteria}
              onChange={(e) => setForm({ ...form, criteria: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="skill-passing" className="form-label">
              What counts as passing (optional)
            </label>
            <textarea
              id="skill-passing"
              className="form-input"
              rows={2}
              maxLength={5000}
              value={form.passingRequirements}
              onChange={(e) => setForm({ ...form, passingRequirements: e.target.value })}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="form-label">Who can sign this skill off</legend>
            {(
              [
                ['default', 'Anyone with training management (default)'],
                ['roles', 'Members holding these positions'],
                ['specific_users', 'These named members'],
              ] as const
            ).map(([mode, label]) => (
              <label key={mode} className="text-theme-text-primary touch:min-h-11 flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="evaluator-mode"
                  className="form-checkbox"
                  checked={form.evaluatorMode === mode}
                  onChange={() => setForm({ ...form, evaluatorMode: mode })}
                />
                {label}
              </label>
            ))}
            {form.evaluatorMode === 'roles' &&
              (roles.length === 0 ? (
                <p className="text-theme-text-muted text-sm">
                  Positions could not be loaded. Viewing them needs the positions permission.
                </p>
              ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {roles.map((role) => (
                    <label
                      key={role.id}
                      className="text-theme-text-secondary touch:min-h-11 flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="form-checkbox"
                        checked={form.roles.includes(role.slug)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            roles: e.target.checked
                              ? [...form.roles, role.slug]
                              : form.roles.filter((s) => s !== role.slug),
                          })
                        }
                      />
                      {role.name}
                    </label>
                  ))}
                </div>
              ))}
            {form.evaluatorMode === 'specific_users' && (
              <EvaluatorMemberPicker members={form.members} onChange={(members) => setForm({ ...form, members })} />
            )}
          </fieldset>
        </div>
      </Modal>
    </div>
  );
};

export default SkillEvaluationsTab;
