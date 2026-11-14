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
 * checked by the backend (http/https only); its refusal is shown under the
 * link it refused. A new opportunity is added only once nothing is refused;
 * an edit saves the rest and keeps a refused field flagged (owner rule of
 * 2026-11-05 for a single-save form).
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { grantsService } from '../services/api';
import { DeadlineType, GrantCategory } from '../types';
import type { GrantOpportunity, GrantOpportunityCreatePayload, GrantOpportunityUpdatePayload } from '../types';
import { getErrorMessage } from '@/utils/errorHandling';
import { FormField } from '@/components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
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

type FieldErrors = Partial<Record<keyof FormState, string>>;

/** Labels and the `GrantOpportunityCreate` max_length of each field; each key is also its payload key. */
const SERVER_FIELDS: Record<keyof FormState, ServerFieldSpec> = {
  name: { label: 'Program name', maxLength: 255 },
  agency: { label: 'Agency or funder', maxLength: 255 },
  category: { label: 'Category' },
  description: { label: 'Description' },
  eligibleUses: { label: 'Eligible uses' },
  eligibilityCriteria: { label: 'Who is eligible' },
  typicalAwardMin: { label: 'Smallest typical award' },
  typicalAwardMax: { label: 'Largest typical award' },
  matchRequired: { label: 'Local match' },
  matchPercentage: { label: 'Match percentage' },
  matchDescription: { label: 'About the match', maxLength: 500 },
  deadlineType: { label: 'Deadline' },
  deadlineDate: { label: 'Deadline date' },
  applicationUrl: { label: 'Application link', maxLength: 500 },
  programUrl: { label: 'Program information link', maxLength: 500 },
  federalProgramCode: { label: 'Federal program code', maxLength: 50 },
  notes: { label: 'Notes' },
};

const fieldId = (key: keyof FormState) => `opportunity-field-${key}`;

const isAmount = (value: string) => value.trim() === '' || (Number.isFinite(Number(value)) && Number(value) >= 0);

function validateOpportunity(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
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
  const [errors, setErrors] = useState<FieldErrors>({});
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
    (value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    };
  const focusField = (key: keyof FormState | undefined) => {
    if (key) document.getElementById(fieldId(key))?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = validateOpportunity(form);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error('Fix the fields marked below.');
      focusField((Object.keys(next) as (keyof FormState)[])[0]);
      return;
    }
    void save();
  };

  const save = async () => {
    setSaving(true);
    try {
      if (id) {
        const payload = toOpportunityUpdatePayload(form);
        let refused: FieldErrors = {};
        try {
          await grantsService.updateOpportunity(id, payload);
        } catch (err: unknown) {
          // Owner rule (2026-11-05) for a single-save form: a value the
          // opportunity cannot hold is not written, the rest saves, and the
          // field keeps what was typed, flagged, until it is fixed. Anything
          // the form has no field for is a real failure and is reported as one.
          const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
          const keys = Object.keys(mapped?.fieldErrors ?? {}) as (keyof FormState)[];
          if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
          refused = mapped.fieldErrors;
          const rest: GrantOpportunityUpdatePayload = { ...payload };
          for (const key of keys) delete rest[key];
          await grantsService.updateOpportunity(id, rest);
        }
        const firstRefused = (Object.keys(refused) as (keyof FormState)[])[0];
        if (firstRefused) {
          // Stays on the page, so the refused field can be fixed and saved again.
          setErrors(refused);
          toast.error(
            `Opportunity saved, except ${SERVER_FIELDS[firstRefused].label.toLowerCase()}: ${refused[firstRefused] ?? ''} Fix it and save again.`
          );
          focusField(firstRefused);
          return;
        }
        toast.success('Opportunity saved');
      } else {
        await grantsService.createOpportunity(toOpportunityPayload(form));
        toast.success('Opportunity added');
      }
      void navigate('/grants/opportunities');
    } catch (err: unknown) {
      // A new opportunity is added only once nothing is refused, so each
      // refusal goes on its field (forms review F-2).
      const mapped = id ? null : mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as (keyof FormState)[];
      if (mapped && keys[0]) {
        setErrors(mapped.fieldErrors);
        focusField(keys[0]);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, id ? 'Could not save the opportunity' : 'Could not add the opportunity'));
    } finally {
      setSaving(false);
    }
  };

  const optional = <span className="text-theme-text-secondary font-normal">(optional)</span>;
  type TextKey = {
    [K in keyof FormState]: FormState[K] extends string ? K : never;
  }[keyof FormState];
  /** A text, number, date or URL input bound to one string field. */
  const input = (
    key: TextKey,
    label: React.ReactNode,
    attrs: React.InputHTMLAttributes<HTMLInputElement> & { required?: boolean } = {}
  ) => {
    const { required, ...rest } = attrs;
    const { maxLength } = SERVER_FIELDS[key];
    return (
      <FormField
        id={fieldId(key)}
        label={label}
        required={required}
        error={errors[key]}
        maxLength={maxLength}
        count={maxLength ? form[key].length : undefined}
      >
        {(field) => (
          <input
            type="text"
            {...rest}
            {...field}
            className="form-input"
            value={form[key]}
            onChange={(e) => set(key)(e.target.value)}
          />
        )}
      </FormField>
    );
  };
  const textarea = (key: TextKey, label: React.ReactNode) => (
    <FormField id={fieldId(key)} label={label} error={errors[key]}>
      {(field) => (
        <textarea
          {...field}
          rows={3}
          className="form-input"
          value={form[key]}
          onChange={(e) => set(key)(e.target.value)}
        />
      )}
    </FormField>
  );

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
              {input('name', 'Program name', { required: true, autoComplete: 'off' })}
              {input('agency', <>Agency or funder {optional}</>, { autoComplete: 'off' })}
              <FormField id={fieldId('category')} label="Category" error={errors.category}>
                {(field) => (
                  <select
                    {...field}
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
                )}
              </FormField>
              {input('federalProgramCode', <>Federal program code {optional}</>, {
                placeholder: 'e.g. 97.044',
                autoComplete: 'off',
              })}
            </div>
            {textarea('description', <>Description {optional}</>)}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {textarea('eligibleUses', <>Eligible uses {optional}</>)}
              {textarea('eligibilityCriteria', <>Who is eligible {optional}</>)}
            </div>
          </section>

          <section className="card space-y-4 p-6" aria-labelledby="opportunity-funding-heading">
            <h2 id="opportunity-funding-heading" className="text-theme-text-primary font-semibold">
              Funding
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {input('typicalAwardMin', <>Smallest typical award {optional}</>, {
                type: 'number',
                inputMode: 'decimal',
                min: '0',
                step: '0.01',
              })}
              {input('typicalAwardMax', <>Largest typical award {optional}</>, {
                type: 'number',
                inputMode: 'decimal',
                min: '0',
                step: '0.01',
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                id={fieldId('matchRequired')}
                type="checkbox"
                className="form-checkbox"
                checked={form.matchRequired}
                onChange={(e) => set('matchRequired')(e.target.checked)}
                aria-invalid={errors.matchRequired ? true : undefined}
              />
              <span className="text-theme-text-primary">The department must contribute a local match</span>
            </label>
            {errors.matchRequired && (
              <p role="alert" className="text-sm text-red-800 dark:text-red-300">
                {errors.matchRequired}
              </p>
            )}
            {form.matchRequired && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {input('matchPercentage', <>Match percentage {optional}</>, {
                  type: 'number',
                  inputMode: 'decimal',
                  min: '0',
                  max: '100',
                  step: '0.01',
                })}
                {input('matchDescription', <>About the match {optional}</>, { autoComplete: 'off' })}
              </div>
            )}
          </section>

          <section className="card space-y-4 p-6" aria-labelledby="opportunity-deadline-heading">
            <h2 id="opportunity-deadline-heading" className="text-theme-text-primary font-semibold">
              Deadline and links
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField id={fieldId('deadlineType')} label="Deadline" error={errors.deadlineType}>
                {(field) => (
                  <select
                    {...field}
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
                )}
              </FormField>
              {form.deadlineType !== DeadlineType.ROLLING &&
                input(
                  'deadlineDate',
                  form.deadlineType === DeadlineType.FIXED ? (
                    'Deadline date'
                  ) : (
                    <>
                      {form.deadlineType === DeadlineType.RECURRING ? 'Next deadline' : 'Deadline date'} {optional}
                    </>
                  ),
                  { type: 'date', required: form.deadlineType === DeadlineType.FIXED }
                )}
              {input('applicationUrl', <>Application link {optional}</>, {
                type: 'url',
                inputMode: 'url',
                placeholder: 'https://',
                autoComplete: 'url',
              })}
              {input('programUrl', <>Program information link {optional}</>, {
                type: 'url',
                inputMode: 'url',
                placeholder: 'https://',
                autoComplete: 'url',
              })}
            </div>
            {textarea('notes', <>Notes {optional}</>)}
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
