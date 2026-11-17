/**
 * Dual-approval threshold
 *
 * At or above this amount, a purchase request, check request or expense
 * report is approved only once two different people have approved it. The
 * value shown is the server's reading (`GET /finance/settings`), never a local
 * default, so the screen cannot claim a rule the approval path does not apply.
 *
 * Writing goes through the organization settings endpoint and needs
 * `settings.manage`: the rule binds the finance officers themselves, so they
 * can read it here but only a settings administrator can change it — the same
 * arrangement as the admin-hours review rules.
 *
 * Owner decisions of 2026-11-01 add two refinements, read and written the
 * same way: a threshold per request type (a type left on "same as above"
 * follows the department figure, so nothing changes until one is set), and
 * the office whose holder must be one of the two approvers.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/contexts/ConfirmContext';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { formatCurrency } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import { financeSettingsService } from '../services/api';
import type { ApproverOption } from '../hooks/useApproverOptions';
import { ApprovalEntityType } from '../types';
import type { DualApprovalTypeThreshold, FinanceSettings } from '../types';

/** Whole dollars, as the settings schema accepts. */
const MAX_THRESHOLD = 9_999_999_999;
/** `FinanceSettingsUpdate.second_approver_position` in schemas/organization.py. */
const MAX_OFFICE = 100;

/** In the order the server reports them. */
const TYPE_LABELS: ReadonlyArray<[ApprovalEntityType, string]> = [
  [ApprovalEntityType.PURCHASE_REQUEST, 'Purchase requests'],
  [ApprovalEntityType.CHECK_REQUEST, 'Check requests'],
  [ApprovalEntityType.EXPENSE_REPORT, 'Expense reports'],
];

type TypeMode = 'default' | 'own' | 'off';
interface TypeDraft {
  mode: TypeMode;
  amount: string;
}
type TypeDrafts = Record<ApprovalEntityType, TypeDraft>;

/** The three forms on this card; each reports a refusal inside itself. */
type DualForm = 'threshold' | 'types' | 'office';

/** A request type's key stands for its own threshold amount. */
type DualField = 'threshold' | ApprovalEntityType | 'office';

/**
 * The organization settings endpoint names a refusal by its path under
 * `finance` (`FinanceSettingsUpdate`, snake_case keys), so each field lists
 * the path it answers for.
 */
const DUAL_FIELDS: Record<DualField, ServerFieldSpec> = {
  threshold: { label: 'Threshold', api: 'finance.dual_approval_threshold' },
  [ApprovalEntityType.PURCHASE_REQUEST]: {
    label: 'Purchase requests threshold',
    api: `finance.dual_approval_thresholds.${ApprovalEntityType.PURCHASE_REQUEST}`,
  },
  [ApprovalEntityType.CHECK_REQUEST]: {
    label: 'Check requests threshold',
    api: `finance.dual_approval_thresholds.${ApprovalEntityType.CHECK_REQUEST}`,
  },
  [ApprovalEntityType.EXPENSE_REPORT]: {
    label: 'Expense reports threshold',
    api: `finance.dual_approval_thresholds.${ApprovalEntityType.EXPENSE_REPORT}`,
  },
  office: { label: 'Second approval from', maxLength: MAX_OFFICE, api: 'finance.second_approver_position' },
};

const fieldId = (field: DualField): string =>
  field === 'threshold'
    ? 'dual-approval-threshold'
    : field === 'office'
      ? 'dual-approval-office'
      : `dual-approval-amount-${field}`;

/** In the order the card shows them, for moving focus to the first refusal. */
const FIELD_ORDER: readonly DualField[] = ['threshold', ...TYPE_LABELS.map(([type]) => type), 'office'];

const WHOLE_DOLLARS_MESSAGE = 'Enter a whole-dollar amount of $1 or more.';

const isWholeDollars = (value: string): boolean => {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_THRESHOLD;
};

function typeDraftsFrom(rows: DualApprovalTypeThreshold[] | undefined): TypeDrafts {
  const drafts = {} as TypeDrafts;
  for (const [type] of TYPE_LABELS) {
    const row = rows?.find((r) => r.entityType === type);
    if (!row || row.followsDefault) drafts[type] = { mode: 'default', amount: '' };
    else if (row.threshold === null) drafts[type] = { mode: 'off', amount: '' };
    else drafts[type] = { mode: 'own', amount: String(Math.round(Number(row.threshold))) };
  }
  return drafts;
}

/** What the server reads a type's rule as, in words. */
function describeType(row: DualApprovalTypeThreshold | undefined): string {
  if (!row || row.threshold === null) return 'Off';
  const amount = `${formatCurrency(row.threshold)} or more`;
  return row.followsDefault ? `${amount} (same as above)` : amount;
}

function describeOffice(settings: FinanceSettings): string {
  const slug = settings.secondApproverPosition ?? null;
  if (slug === null) return 'Any finance approver other than the first may give the second approval.';
  const name = settings.secondApproverPositionName ?? null;
  if (name === null) {
    return `The ${slug} position no longer exists, so large requests cannot be completed until this is changed.`;
  }
  return `One of the two approvers must hold the ${name} position.`;
}

interface DualApprovalSettingsCardProps {
  /** Positions to choose the office from; null when they could not be listed. */
  positions?: ApproverOption[] | null | undefined;
}

export const DualApprovalSettingsCard: React.FC<DualApprovalSettingsCardProps> = ({ positions = null }) => {
  const canEdit = useAuthStore(
    (s) => s.checkPermission('settings.manage') || s.checkPermission('organization.update_settings')
  );
  const { confirm } = useConfirm();
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [typeDrafts, setTypeDrafts] = useState<TypeDrafts>(() => typeDraftsFrom(undefined));
  const [officeDraft, setOfficeDraft] = useState('');
  const [errors, setErrors] = useState<Partial<Record<DualField, string>>>({});
  // A refusal no field answers for (a 403, a lost connection) is said inside
  // the form that sent it, not only in a toast that fades (forms review F-5).
  const [formError, setFormError] = useState<{ form: DualForm; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await financeSettingsService.get();
      setSettings(next);
      setDraft(next.dualApprovalThreshold === null ? '' : String(Math.round(Number(next.dualApprovalThreshold))));
      setTypeDrafts(typeDraftsFrom(next.dualApprovalThresholds));
      setOfficeDraft(next.secondApproverPosition ?? '');
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load the dual-approval rule'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Names each refusal under its field and moves focus to the first (forms review F-3). */
  const flag = (next: Partial<Record<DualField, string>>) => {
    setErrors(next);
    const first = FIELD_ORDER.find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(fieldId(first))?.focus(), 0);
  };

  const clearError = (field: DualField) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  // Each form sends its one setting whole, and the server validates the
  // request before storing any of it, so a refusal saves nothing and nothing
  // here is sent without it: this is a control on approvals, and only its
  // presentation and error handling are this form's to change.
  const write = async (form: DualForm, finance: Record<string, unknown>, done: string) => {
    setSaving(true);
    setFormError(null);
    try {
      await organizationService.updateSettings({ finance });
      // Re-read rather than trusting the value sent, so the screen shows what
      // the approval path will actually enforce.
      await load();
      toast.success(done);
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, DUAL_FIELDS);
      const placed = mapped ? Object.keys(mapped.fieldErrors).length > 0 : false;
      if (mapped && placed) flag(mapped.fieldErrors);
      const rest = mapped && placed ? mapped.unmatched : [];
      if (!placed || rest.length > 0) {
        const message =
          rest.length > 0 ? rest.join(' ') : getErrorMessage(err, 'Could not save the dual-approval rule');
        setFormError({ form, message });
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  const save = (threshold: number | null) =>
    write(
      'threshold',
      { dual_approval_threshold: threshold },
      threshold === null ? 'Dual approval turned off' : 'Dual-approval threshold saved'
    );

  const submitTypes = (e: React.FormEvent) => {
    e.preventDefault();
    // null follows the department threshold, 0 is off for the type. Every
    // type is sent on every save, so a type switched back to "same as above"
    // actually clears its own figure (Pitfall #1, update payloads).
    const body: Record<string, number | null> = {};
    const refused: Partial<Record<DualField, string>> = {};
    for (const [type] of TYPE_LABELS) {
      const { mode, amount } = typeDrafts[type];
      if (mode === 'own') {
        if (!isWholeDollars(amount)) refused[type] = WHOLE_DOLLARS_MESSAGE;
        body[type] = Number(amount);
      } else {
        body[type] = mode === 'off' ? 0 : null;
      }
    }
    if (Object.keys(refused).length > 0) {
      flag(refused);
      return;
    }
    setErrors({});
    void write('types', { dual_approval_thresholds: body }, 'Request-type thresholds saved');
  };

  const submitOffice = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = officeDraft.trim() || null;
    if (slug !== null && slug.length > MAX_OFFICE) {
      flag({ office: `Keep the position slug to ${String(MAX_OFFICE)} characters.` });
      return;
    }
    clearError('office');
    void write(
      'office',
      { second_approver_position: slug },
      slug === null ? 'Any finance approver may give the second approval' : 'Second approver saved'
    );
  };

  const setTypeDraft = (type: ApprovalEntityType, next: Partial<TypeDraft>) => {
    setTypeDrafts((prev) => ({ ...prev, [type]: { ...prev[type], ...next } }));
    clearError(type);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWholeDollars(draft)) {
      flag({ threshold: WHOLE_DOLLARS_MESSAGE });
      return;
    }
    clearError('threshold');
    void save(Number(draft));
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: 'Turn off dual approval',
      message: 'Every request will again be approved by a single approver, however large.',
      confirmLabel: 'Turn it off',
      cancelLabel: 'Keep it on',
      variant: 'warning',
    });
    if (ok) void save(null);
  };

  const formAlert = (form: DualForm) =>
    formError?.form === form ? (
      <p role="alert" className={`w-full text-sm ${FIELD_ERROR_CLASS}`}>
        {formError.message}
      </p>
    ) : null;

  const threshold = settings?.dualApprovalThreshold ?? null;

  return (
    <section className="card p-6" aria-labelledby="dual-approval-title">
      <h2 id="dual-approval-title" className="text-theme-text-primary text-lg font-semibold">
        Second approver for large requests
      </h2>
      {loadError ? (
        <p role="alert" className={`mt-2 text-sm ${FIELD_ERROR_CLASS}`}>
          {loadError}
        </p>
      ) : settings === null ? (
        <p className="text-theme-text-secondary mt-2 text-sm">Loading…</p>
      ) : (
        <p className="text-theme-text-primary mt-2 text-sm">
          {threshold === null
            ? 'Off: one approval completes any request.'
            : `Requests of ${formatCurrency(threshold)} or more need two different approvers.`}
        </p>
      )}
      <p className="text-theme-text-secondary mt-1 text-sm">
        Applies to purchase requests, check requests and expense reports, whether or not an approval chain covers them.
        The request waits after its first approval until someone else approves it, and the members who could give the
        second approval are emailed. Many departments use $1,000.
      </p>

      {canEdit ? (
        settings !== null && (
          <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3" noValidate>
            <FormField id={fieldId('threshold')} label="Threshold (whole dollars)" error={errors.threshold}>
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  className="form-input w-40"
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    clearError('threshold');
                  }}
                />
              )}
            </FormField>
            <button type="submit" className="btn-primary" disabled={saving}>
              Save
            </button>
            {threshold !== null && (
              <button type="button" className="btn-secondary" disabled={saving} onClick={() => void turnOff()}>
                Turn off
              </button>
            )}
            {formAlert('threshold')}
          </form>
        )
      ) : (
        <p className="text-theme-text-secondary mt-3 text-sm">
          Only a settings administrator can change this, because it applies to the finance officers themselves.
        </p>
      )}

      {settings !== null && (
        <>
          <h3 className="text-theme-text-primary mt-6 text-base font-semibold">By request type</h3>
          <ul className="text-theme-text-primary mt-2 space-y-1 text-sm">
            {TYPE_LABELS.map(([type, label]) => (
              <li key={type}>
                {label}: {describeType(settings.dualApprovalThresholds?.find((r) => r.entityType === type))}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form onSubmit={submitTypes} className="mt-3 space-y-3" noValidate aria-label="Thresholds by request type">
              {TYPE_LABELS.map(([type, label]) => {
                const typeDraft = typeDrafts[type];
                return (
                  <div key={type} className="flex flex-wrap items-start gap-3">
                    <FormField id={`dual-approval-mode-${type}`} label={label}>
                      {(field) => (
                        <select
                          {...field}
                          className="form-input w-56"
                          value={typeDraft.mode}
                          onChange={(e) => setTypeDraft(type, { mode: e.target.value as TypeMode })}
                        >
                          <option value="default">Same as above</option>
                          <option value="own">Its own threshold</option>
                          <option value="off">Off for this type</option>
                        </select>
                      )}
                    </FormField>
                    {typeDraft.mode === 'own' && (
                      <FormField id={fieldId(type)} label={`${label} threshold (whole dollars)`} error={errors[type]}>
                        {(field) => (
                          <input
                            {...field}
                            type="number"
                            inputMode="numeric"
                            min="1"
                            step="1"
                            className="form-input w-40"
                            value={typeDraft.amount}
                            onChange={(e) => setTypeDraft(type, { amount: e.target.value })}
                          />
                        )}
                      </FormField>
                    )}
                  </div>
                );
              })}
              <button type="submit" className="btn-primary" disabled={saving}>
                Save request types
              </button>
              {formAlert('types')}
            </form>
          )}

          <h3 className="text-theme-text-primary mt-6 text-base font-semibold">Who gives the second approval</h3>
          <p className="text-theme-text-primary mt-2 text-sm">{describeOffice(settings)}</p>
          <p className="text-theme-text-secondary mt-1 text-sm">
            When an office is named, a request it has not yet approved waits for one of its holders, and they are the
            ones emailed. Its holders also need permission to approve finance requests.
          </p>
          {canEdit && (
            <form onSubmit={submitOffice} className="mt-3 flex flex-wrap items-end gap-3" noValidate>
              <FormField
                id={fieldId('office')}
                label="Second approval from"
                error={errors.office}
                // The slug is typed only when positions could not be listed; a
                // select needs no limit.
                maxLength={positions === null ? MAX_OFFICE : undefined}
                count={positions === null ? officeDraft.length : undefined}
              >
                {(field) =>
                  positions === null ? (
                    <input
                      {...field}
                      type="text"
                      autoComplete="off"
                      className="form-input w-56"
                      placeholder="Position slug, or blank for anyone"
                      value={officeDraft}
                      onChange={(e) => {
                        setOfficeDraft(e.target.value);
                        clearError('office');
                      }}
                    />
                  ) : (
                    <select
                      {...field}
                      className="form-input w-56"
                      value={officeDraft}
                      onChange={(e) => {
                        setOfficeDraft(e.target.value);
                        clearError('office');
                      }}
                    >
                      <option value="">Any finance approver</option>
                      {officeDraft !== '' && !positions.some((p) => p.value === officeDraft) && (
                        <option value={officeDraft}>{officeDraft} (no longer exists)</option>
                      )}
                      {positions.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )
                }
              </FormField>
              <button type="submit" className="btn-primary" disabled={saving}>
                Save second approver
              </button>
              {formAlert('office')}
            </form>
          )}
        </>
      )}
    </section>
  );
};

export default DualApprovalSettingsCard;
