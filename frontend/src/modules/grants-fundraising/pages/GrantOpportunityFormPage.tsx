/**
 * New / Edit Grant Opportunity
 *
 * Adds a grant program to the department's opportunity library
 * (`POST /grants`, `fundraising.manage`), or corrects one at
 * `/grants/opportunities/:id/edit` (`PUT /grants/{id}`). The library is what an
 * application is started from, so this is where a program the pre-loaded list
 * does not carry — a state grant, a local foundation — gets in, and where a
 * mistyped deadline gets fixed (W68-10).
 *
 * On create, blank optional fields are omitted; on edit every field is sent
 * and a cleared one is null, so the clear is stored (pitfall #1). URLs are
 * checked by the backend (http/https only); its refusal is what the toast
 * shows.
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { grantsService } from '../services/api';
import { DeadlineType, GrantCategory } from '../types';
import type { GrantOpportunity, GrantOpportunityCreatePayload, GrantOpportunityUpdatePayload } from '../types';
import { getErrorMessage } from '@/utils/errorHandling';
import { blankToNull } from '@/utils/formValues';
import { GRANT_CATEGORY_LABELS } from '../utils/labels';

const DEADLINE_TYPE_LABELS: Record<DeadlineType, string> = {
  [DeadlineType.FIXED]: 'Fixed date',
  [DeadlineType.RECURRING]: 'Recurring (each cycle)',
  [DeadlineType.ROLLING]: 'Rolling — no deadline',
};

interface FormState {
  name: string;
  agency: string;
  category: string;
  description: string;
  eligibleUses: string;
  eligibilityCriteria: string;
  typicalAwardMin: string;
  typicalAwardMax: string;
  matchRequired: boolean;
  matchPercentage: string;
  matchDescription: string;
  deadlineType: string;
  deadlineDate: string;
  applicationUrl: string;
  programUrl: string;
  federalProgramCode: string;
  notes: string;
}

const EMPTY: FormState = {
  name: '',
  agency: '',
  category: GrantCategory.OTHER,
  description: '',
  eligibleUses: '',
  eligibilityCriteria: '',
  typicalAwardMin: '',
  typicalAwardMax: '',
  matchRequired: false,
  matchPercentage: '',
  matchDescription: '',
  deadlineType: '',
  deadlineDate: '',
  applicationUrl: '',
  programUrl: '',
  federalProgramCode: '',
  notes: '',
};

const isAmount = (value: string) => value.trim() === '' || (Number.isFinite(Number(value)) && Number(value) >= 0);

function validateOpportunity(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'Enter the program name.';
  if (!isAmount(form.typicalAwardMin)) errors.typicalAwardMin = 'Enter an amount of zero or more.';
  if (!isAmount(form.typicalAwardMax)) errors.typicalAwardMax = 'Enter an amount of zero or more.';
  if (
    !errors.typicalAwardMin &&
    !errors.typicalAwardMax &&
    form.typicalAwardMin.trim() &&
    form.typicalAwardMax.trim() &&
    Number(form.typicalAwardMin) > Number(form.typicalAwardMax)
  ) {
    errors.typicalAwardMax = 'The largest award cannot be below the smallest.';
  }
  if (form.matchRequired && form.matchPercentage.trim()) {
    const pct = Number(form.matchPercentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) errors.matchPercentage = 'Enter a percentage from 0 to 100.';
  }
  if (form.deadlineType === DeadlineType.FIXED && !form.deadlineDate) {
    errors.deadlineDate = 'A fixed deadline needs its date.';
  }
  return errors;
}

function toOpportunityPayload(form: FormState): GrantOpportunityCreatePayload {
  const rolling = form.deadlineType === DeadlineType.ROLLING;
  return {
    name: form.name.trim(),
    agency: form.agency.trim() || undefined,
    category: (form.category || undefined) as GrantCategory | undefined,
    description: form.description.trim() || undefined,
    eligibleUses: form.eligibleUses.trim() || undefined,
    eligibilityCriteria: form.eligibilityCriteria.trim() || undefined,
    typicalAwardMin: form.typicalAwardMin.trim() || undefined,
    typicalAwardMax: form.typicalAwardMax.trim() || undefined,
    matchRequired: form.matchRequired,
    matchPercentage: (form.matchRequired && form.matchPercentage.trim()) || undefined,
    matchDescription: (form.matchRequired && form.matchDescription.trim()) || undefined,
    deadlineType: (form.deadlineType || undefined) as DeadlineType | undefined,
    // A rolling program has no deadline; a date typed before switching to
    // rolling would otherwise surface it on the dashboard's deadline list.
    deadlineDate: (!rolling && form.deadlineDate) || undefined,
    applicationUrl: form.applicationUrl.trim() || undefined,
    programUrl: form.programUrl.trim() || undefined,
    federalProgramCode: form.federalProgramCode.trim() || undefined,
    notes: form.notes.trim() || undefined,
  };
}

function toOpportunityUpdatePayload(form: FormState): GrantOpportunityUpdatePayload {
  const rolling = form.deadlineType === DeadlineType.ROLLING;
  return {
    name: form.name.trim(),
    agency: blankToNull(form.agency),
    category: (form.category || null) as GrantCategory | null,
    description: blankToNull(form.description),
    eligibleUses: blankToNull(form.eligibleUses),
    eligibilityCriteria: blankToNull(form.eligibilityCriteria),
    typicalAwardMin: blankToNull(form.typicalAwardMin),
    typicalAwardMax: blankToNull(form.typicalAwardMax),
    matchRequired: form.matchRequired,
    // Unticking "match required" clears what only described the match.
    matchPercentage: form.matchRequired ? blankToNull(form.matchPercentage) : null,
    matchDescription: form.matchRequired ? blankToNull(form.matchDescription) : null,
    deadlineType: (form.deadlineType || null) as DeadlineType | null,
    deadlineDate: rolling ? null : form.deadlineDate || null,
    applicationUrl: blankToNull(form.applicationUrl),
    programUrl: blankToNull(form.programUrl),
    federalProgramCode: blankToNull(form.federalProgramCode),
    notes: blankToNull(form.notes),
  };
}

const text = (value: string | number | null | undefined) => (value == null ? '' : String(value));

function toFormState(opp: GrantOpportunity): FormState {
  return {
    name: opp.name,
    agency: text(opp.agency),
    category: text(opp.category),
    description: text(opp.description),
    eligibleUses: text(opp.eligibleUses),
    eligibilityCriteria: text(opp.eligibilityCriteria),
    typicalAwardMin: text(opp.typicalAwardMin),
    typicalAwardMax: text(opp.typicalAwardMax),
    matchRequired: opp.matchRequired,
    matchPercentage: text(opp.matchPercentage),
    matchDescription: text(opp.matchDescription),
    deadlineType: text(opp.deadlineType),
    deadlineDate: text(opp.deadlineDate),
    applicationUrl: text(opp.applicationUrl),
    programUrl: text(opp.programUrl),
    federalProgramCode: text(opp.federalProgramCode),
    notes: text(opp.notes),
  };
}

const GrantOpportunityFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const opp = await grantsService.getOpportunity(id);
        if (!cancelled) setForm(toFormState(opp));
      } catch (err: unknown) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load the opportunity'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const set =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = validateOpportunity(form);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error('Fix the fields marked below.');
      return;
    }
    void save();
  };

  const save = async () => {
    setSaving(true);
    try {
      if (id) {
        await grantsService.updateOpportunity(id, toOpportunityUpdatePayload(form));
        toast.success('Opportunity saved');
      } else {
        await grantsService.createOpportunity(toOpportunityPayload(form));
        toast.success('Opportunity added');
      }
      void navigate('/grants/opportunities');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, id ? 'Could not save the opportunity' : 'Could not add the opportunity'));
    } finally {
      setSaving(false);
    }
  };

  const errorText = (field: keyof FormState) =>
    errors[field] ? (
      <p id={`opportunity-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  const describedBy = (field: keyof FormState) => (errors[field] ? `opportunity-${field}-error` : undefined);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        to="/grants/opportunities"
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Opportunities
      </Link>
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">
          {isEditing ? 'Edit Grant Opportunity' : 'Add Grant Opportunity'}
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          A grant program the department may apply to. Applications can then be started from it.
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-red-500" aria-hidden="true" />
          <span className="sr-only">Loading the opportunity</span>
        </div>
      )}
      {loadError && (
        <div role="alert" className="alert-danger text-sm">
          {loadError}
        </div>
      )}

      {!loading && !loadError && (
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <section className="card space-y-4 p-6" aria-labelledby="opportunity-program-heading">
            <h2 id="opportunity-program-heading" className="text-theme-text-primary font-semibold">
              Program
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="opportunity-name" className="form-label">
                  Program name
                </label>
                <input
                  id="opportunity-name"
                  type="text"
                  maxLength={255}
                  className="form-input"
                  value={form.name}
                  onChange={(e) => set('name')(e.target.value)}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={describedBy('name')}
                />
                {errorText('name')}
              </div>
              <div>
                <label htmlFor="opportunity-agency" className="form-label">
                  Agency or funder <span className="text-theme-text-secondary font-normal">(optional)</span>
                </label>
                <input
                  id="opportunity-agency"
                  type="text"
                  maxLength={255}
                  className="form-input"
                  value={form.agency}
                  onChange={(e) => set('agency')(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="opportunity-category" className="form-label">
                  Category
                </label>
                <select
                  id="opportunity-category"
                  className="form-input"
                  value={form.category}
                  onChange={(e) => set('category')(e.target.value)}
                >
                  {Object.values(GrantCategory).map((value) => (
                    <option key={value} value={value}>
                      {GRANT_CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="opportunity-code" className="form-label">
                  Federal program code <span className="text-theme-text-secondary font-normal">(optional)</span>
                </label>
                <input
                  id="opportunity-code"
                  type="text"
                  maxLength={50}
                  placeholder="e.g. 97.044"
                  className="form-input"
                  value={form.federalProgramCode}
                  onChange={(e) => set('federalProgramCode')(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="opportunity-description" className="form-label">
                Description <span className="text-theme-text-secondary font-normal">(optional)</span>
              </label>
              <textarea
                id="opportunity-description"
                rows={3}
                className="form-input"
                value={form.description}
                onChange={(e) => set('description')(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="opportunity-uses" className="form-label">
                  Eligible uses <span className="text-theme-text-secondary font-normal">(optional)</span>
                </label>
                <textarea
                  id="opportunity-uses"
                  rows={3}
                  className="form-input"
                  value={form.eligibleUses}
                  onChange={(e) => set('eligibleUses')(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="opportunity-eligibility" className="form-label">
                  Who is eligible <span className="text-theme-text-secondary font-normal">(optional)</span>
                </label>
                <textarea
                  id="opportunity-eligibility"
                  rows={3}
                  className="form-input"
                  value={form.eligibilityCriteria}
                  onChange={(e) => set('eligibilityCriteria')(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="card space-y-4 p-6" aria-labelledby="opportunity-funding-heading">
            <h2 id="opportunity-funding-heading" className="text-theme-text-primary font-semibold">
              Funding
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="opportunity-award-min" className="form-label">
                  Smallest typical award <span className="text-theme-text-secondary font-normal">(optional)</span>
                </label>
                <input
                  id="opportunity-award-min"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="form-input"
                  value={form.typicalAwardMin}
                  onChange={(e) => set('typicalAwardMin')(e.target.value)}
                  aria-invalid={Boolean(errors.typicalAwardMin)}
                  aria-describedby={describedBy('typicalAwardMin')}
                />
                {errorText('typicalAwardMin')}
              </div>
              <div>
                <label htmlFor="opportunity-award-max" className="form-label">
                  Largest typical award <span className="text-theme-text-secondary font-normal">(optional)</span>
                </label>
                <input
                  id="opportunity-award-max"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="form-input"
                  value={form.typicalAwardMax}
                  onChange={(e) => set('typicalAwardMax')(e.target.value)}
                  aria-invalid={Boolean(errors.typicalAwardMax)}
                  aria-describedby={describedBy('typicalAwardMax')}
                />
                {errorText('typicalAwardMax')}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={form.matchRequired}
                onChange={(e) => set('matchRequired')(e.target.checked)}
              />
              <span className="text-theme-text-primary">The department must contribute a local match</span>
            </label>
            {form.matchRequired && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="opportunity-match-pct" className="form-label">
                    Match percentage <span className="text-theme-text-secondary font-normal">(optional)</span>
                  </label>
                  <input
                    id="opportunity-match-pct"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    className="form-input"
                    value={form.matchPercentage}
                    onChange={(e) => set('matchPercentage')(e.target.value)}
                    aria-invalid={Boolean(errors.matchPercentage)}
                    aria-describedby={describedBy('matchPercentage')}
                  />
                  {errorText('matchPercentage')}
                </div>
                <div>
                  <label htmlFor="opportunity-match-description" className="form-label">
                    About the match <span className="text-theme-text-secondary font-normal">(optional)</span>
                  </label>
                  <input
                    id="opportunity-match-description"
                    type="text"
                    maxLength={500}
                    className="form-input"
                    value={form.matchDescription}
                    onChange={(e) => set('matchDescription')(e.target.value)}
                  />
                </div>
              </div>
            )}
          </section>

          <section className="card space-y-4 p-6" aria-labelledby="opportunity-deadline-heading">
            <h2 id="opportunity-deadline-heading" className="text-theme-text-primary font-semibold">
              Deadline and links
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="opportunity-deadline-type" className="form-label">
                  Deadline
                </label>
                <select
                  id="opportunity-deadline-type"
                  className="form-input"
                  value={form.deadlineType}
                  onChange={(e) => set('deadlineType')(e.target.value)}
                >
                  <option value="">Not known</option>
                  {Object.values(DeadlineType).map((value) => (
                    <option key={value} value={value}>
                      {DEADLINE_TYPE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              {form.deadlineType !== DeadlineType.ROLLING && (
                <div>
                  <label htmlFor="opportunity-deadline-date" className="form-label">
                    {form.deadlineType === DeadlineType.RECURRING ? 'Next deadline' : 'Deadline date'}
                    {form.deadlineType !== DeadlineType.FIXED && (
                      <span className="text-theme-text-secondary font-normal"> (optional)</span>
                    )}
                  </label>
                  <input
                    id="opportunity-deadline-date"
                    type="date"
                    className="form-input"
                    value={form.deadlineDate}
                    onChange={(e) => set('deadlineDate')(e.target.value)}
                    aria-invalid={Boolean(errors.deadlineDate)}
                    aria-describedby={describedBy('deadlineDate')}
                  />
                  {errorText('deadlineDate')}
                </div>
              )}
              <div>
                <label htmlFor="opportunity-application-url" className="form-label">
                  Application link <span className="text-theme-text-secondary font-normal">(optional)</span>
                </label>
                <input
                  id="opportunity-application-url"
                  type="url"
                  inputMode="url"
                  maxLength={500}
                  placeholder="https://"
                  className="form-input"
                  value={form.applicationUrl}
                  onChange={(e) => set('applicationUrl')(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="opportunity-program-url" className="form-label">
                  Program information link <span className="text-theme-text-secondary font-normal">(optional)</span>
                </label>
                <input
                  id="opportunity-program-url"
                  type="url"
                  inputMode="url"
                  maxLength={500}
                  placeholder="https://"
                  className="form-input"
                  value={form.programUrl}
                  onChange={(e) => set('programUrl')(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="opportunity-notes" className="form-label">
                Notes <span className="text-theme-text-secondary font-normal">(optional)</span>
              </label>
              <textarea
                id="opportunity-notes"
                rows={3}
                className="form-input"
                value={form.notes}
                onChange={(e) => set('notes')(e.target.value)}
              />
            </div>
          </section>

          <div className="flex flex-wrap justify-end gap-3">
            <Link to="/grants/opportunities" className="btn-secondary">
              Cancel
            </Link>
            <button type="submit" disabled={saving} className="btn-primary">
              {isEditing ? 'Save changes' : 'Add opportunity'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default GrantOpportunityFormPage;
