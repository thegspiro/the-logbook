/**
 * Footers Panel
 *
 * The department's library of closing blocks. Each template names the footer
 * it uses, so the wording is edited once here instead of in every template —
 * and mail to members, mail to the public, and notices that go on a member's
 * record can each close differently.
 *
 * The contact switches show the department's actual phone, email, website and
 * mailing address beside them, and `DepartmentContactCard` above the list
 * edits those values in place — without them an admin ticking "phone" could
 * not tell which number would print, or that a blank one would print nothing.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { SkeletonPage } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useFootersStore } from '../store/footersStore';
import DepartmentContactCard from './DepartmentContactCard';
import type { EmailFooter, EmailFooterContactDetails } from '../types';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';

/** Mirrors the backend's key pattern, so a bad key is caught before the save. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_FOOTERS = 12;
const MAX_LINES = 6;

/** `EmailFooter` in schemas/email_template.py. */
const NAME_MAX = 100;
const DESCRIPTION_MAX = 300;
const LINE_MAX = 300;

type FooterField = 'name' | 'description' | 'key' | 'lines';
type FooterErrors = Partial<Record<FooterField, string>>;
const FOOTER_FIELD_ORDER: FooterField[] = ['name', 'description', 'key', 'lines'];
const FOOTER_LABELS: Record<FooterField, string> = {
  name: 'Footer name',
  description: 'Footer description',
  key: 'Key',
  lines: 'Lines',
};

const footerFieldId = (index: number, field: FooterField) => `footer-${index}-${field}`;

/**
 * The library saves whole, so a refusal names a card by its place in the list
 * (`footers.2.name`, `footers.0.lines.3`). These specs let mapServerFieldErrors
 * put each one on the card and field it belongs to.
 */
function footerServerFields(count: number): Record<string, ServerFieldSpec> {
  const specs: Record<string, ServerFieldSpec> = {};
  for (let i = 0; i < count; i += 1) {
    specs[`${i}.name`] = { label: FOOTER_LABELS.name, maxLength: NAME_MAX, api: `footers.${i}.name` };
    specs[`${i}.description`] = {
      label: FOOTER_LABELS.description,
      maxLength: DESCRIPTION_MAX,
      api: `footers.${i}.description`,
    };
    specs[`${i}.key`] = { label: FOOTER_LABELS.key, maxLength: 32, api: `footers.${i}.key` };
    specs[`${i}.lines`] = {
      label: 'A line',
      maxLength: LINE_MAX,
      api: [`footers.${i}.lines`, ...Array.from({ length: MAX_LINES }, (_, m) => `footers.${i}.lines.${m}`)],
    };
  }
  return specs;
}

type ContactFlag = 'show_phone' | 'show_email' | 'show_website';

const CONTACT_PARTS: { flag: ContactFlag; label: string; detail: keyof EmailFooterContactDetails }[] = [
  { flag: 'show_phone', label: 'Phone', detail: 'phone' },
  { flag: 'show_email', label: 'Email', detail: 'email' },
  { flag: 'show_website', label: 'Website', detail: 'website' },
];

function blankFooter(existingKeys: string[]): EmailFooter {
  let key = 'footer';
  let suffix = 2;
  while (existingKeys.includes(key)) {
    key = `footer_${suffix}`;
    suffix += 1;
  }
  return {
    key,
    name: 'New footer',
    description: '',
    lines: ['Sent by {{organization_name}}.'],
    show_contact: true,
    show_phone: true,
    show_email: true,
    show_website: true,
    show_mailing_address: false,
  };
}

interface ContactToggleProps {
  label: string;
  value: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}

const ContactToggle: React.FC<ContactToggleProps> = ({ label, value, checked, onToggle }) => (
  <label className="flex items-start gap-2 text-sm">
    <input
      type="checkbox"
      className="form-checkbox mt-0.5"
      checked={checked}
      onChange={(e) => onToggle(e.target.checked)}
    />
    <span className="min-w-0">
      <span className="text-theme-text-primary font-medium">{label}</span>
      {value ? (
        <span className="text-theme-text-secondary block break-words whitespace-pre-line">{value}</span>
      ) : (
        <span className="text-theme-text-muted block italic">Not set, so it will not appear</span>
      )}
    </span>
  </label>
);

interface FooterCardProps {
  index: number;
  footer: EmailFooter;
  /** Refusals from the last save attempt, by field. */
  errors: FooterErrors;
  contactDetails: EmailFooterContactDetails;
  isDefault: boolean;
  usageCount: number;
  keyError: string | null;
  canDelete: boolean;
  onChange: (next: EmailFooter) => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}

const FooterCard: React.FC<FooterCardProps> = ({
  index: cardIndex,
  footer,
  errors,
  contactDetails,
  isDefault,
  usageCount,
  keyError,
  canDelete,
  onChange,
  onMakeDefault,
  onDelete,
}) => {
  const setLine = (index: number, value: string) => {
    const lines = [...footer.lines];
    lines[index] = value;
    onChange({ ...footer, lines });
  };

  const setContactPart = (flag: ContactFlag, checked: boolean) => {
    const next = { ...footer, [flag]: checked };
    // show_contact is the pre-split single switch; keep it meaning "any part".
    onChange({ ...next, show_contact: next.show_phone || next.show_email || next.show_website });
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <FormField
            id={footerFieldId(cardIndex, 'name')}
            label={<span className="sr-only">Footer name</span>}
            labelClassName=""
            required
            error={errors.name}
            maxLength={NAME_MAX}
            count={footer.name.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={footer.name}
                onChange={(e) => onChange({ ...footer, name: e.target.value })}
                className="form-input font-semibold"
              />
            )}
          </FormField>
          <FormField
            id={footerFieldId(cardIndex, 'description')}
            label={<span className="sr-only">Footer description</span>}
            labelClassName=""
            error={errors.description}
            maxLength={DESCRIPTION_MAX}
            count={(footer.description ?? '').length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={footer.description ?? ''}
                onChange={(e) => onChange({ ...footer, description: e.target.value })}
                className="form-input-sm"
                placeholder="When to use this one (optional)"
              />
            )}
          </FormField>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDefault ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs text-green-800 dark:text-green-400">
              <Check className="h-3 w-3" />
              Default
            </span>
          ) : (
            <button
              type="button"
              onClick={onMakeDefault}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-2.5 py-1 text-xs transition-colors"
              title="Templates that have not chosen a footer use the default"
            >
              Make default
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={!canDelete}
            className="text-red-700 transition-colors hover:text-red-800 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
            title={canDelete ? 'Delete this footer' : 'The default footer cannot be deleted'}
            aria-label={`Delete footer ${footer.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id={footerFieldId(cardIndex, 'key')}
          label="Key"
          error={keyError ?? errors.key}
          hint={(keyError ?? errors.key) ? undefined : 'How templates refer to this footer. Recipients never see it.'}
          maxLength={32}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              autoComplete="off"
              value={footer.key}
              onChange={(e) => onChange({ ...footer, key: e.target.value })}
              className="form-input font-mono"
            />
          )}
        </FormField>
        <div className="flex items-end">
          <p className="text-theme-text-muted text-xs">
            {usageCount === 0
              ? 'No templates close with this footer.'
              : `${usageCount} template${usageCount === 1 ? '' : 's'} close${usageCount === 1 ? 's' : ''} with this footer.`}
          </p>
        </div>
      </div>

      <div
        role="group"
        aria-labelledby={`${footerFieldId(cardIndex, 'lines')}-label`}
        {...(errors.lines ? { 'aria-describedby': `${footerFieldId(cardIndex, 'lines')}-error` } : {})}
      >
        <span id={`${footerFieldId(cardIndex, 'lines')}-label`} className="form-label">
          Lines
        </span>
        <div className="space-y-2">
          {footer.lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                id={index === 0 ? footerFieldId(cardIndex, 'lines') : undefined}
                type="text"
                value={line}
                onChange={(e) => setLine(index, e.target.value)}
                className="form-input flex-1"
                placeholder="A sentence to close with"
                aria-label={`Footer line ${index + 1}`}
                maxLength={LINE_MAX}
              />
              <button
                type="button"
                onClick={() => onChange({ ...footer, lines: footer.lines.filter((_, i) => i !== index) })}
                className="btn-icon text-theme-text-muted hover:text-red-600"
                aria-label={`Remove line ${index + 1}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        {errors.lines && (
          <p id={`${footerFieldId(cardIndex, 'lines')}-error`} className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
            {errors.lines}
          </p>
        )}
        {footer.lines.length < MAX_LINES && (
          <button
            type="button"
            onClick={() => onChange({ ...footer, lines: [...footer.lines, ''] })}
            className="text-theme-text-secondary hover:text-theme-text-primary mt-2 flex items-center gap-1.5 text-xs transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add a line
          </button>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="form-label">Contact details</legend>
        <p className="text-theme-text-muted text-xs">
          Tick the details this footer shows. The values are the department contact details above.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTACT_PARTS.map((part) => (
            <ContactToggle
              key={part.flag}
              label={part.label}
              value={contactDetails[part.detail]}
              checked={footer[part.flag]}
              onToggle={(checked) => setContactPart(part.flag, checked)}
            />
          ))}
          <ContactToggle
            label="Mailing address"
            value={contactDetails.mailing_address}
            checked={footer.show_mailing_address}
            onToggle={(checked) => onChange({ ...footer, show_mailing_address: checked })}
          />
        </div>
      </fieldset>
    </div>
  );
};

const FootersPanel: React.FC = () => {
  const {
    footers,
    defaultKey,
    variables,
    usage,
    contactDetails,
    isLoading,
    isSaving,
    error,
    hasLoaded,
    fetchFooters,
    saveFooters,
    refreshContactDetails,
    clearError,
  } = useFootersStore();
  const { confirm } = useConfirm();

  const [draft, setDraft] = useState<EmailFooter[]>([]);
  const [draftDefault, setDraftDefault] = useState('');
  // Refusals from the last save attempt, one entry per card; cleared on the
  // card's next edit, so a fixed field stops showing its old reason.
  const [cardErrors, setCardErrors] = useState<FooterErrors[]>([]);

  useEffect(() => {
    if (!hasLoaded) void fetchFooters();
  }, [hasLoaded, fetchFooters]);

  useEffect(() => {
    setDraft(footers);
    setDraftDefault(defaultKey);
  }, [footers, defaultKey]);

  const keyErrors = useMemo(() => {
    const seen = new Map<string, number>();
    draft.forEach((footer) => seen.set(footer.key, (seen.get(footer.key) ?? 0) + 1));
    return draft.map((footer) => {
      if (!KEY_PATTERN.test(footer.key)) {
        return 'Lowercase letters, numbers, dashes and underscores only.';
      }
      if ((seen.get(footer.key) ?? 0) > 1) return 'Another footer already uses this key.';
      return null;
    });
  }, [draft]);

  const isDirty = draftDefault !== defaultKey || JSON.stringify(draft) !== JSON.stringify(footers);

  const focusFirst = (errors: FooterErrors[]) => {
    for (let i = 0; i < errors.length; i += 1) {
      const field = FOOTER_FIELD_ORDER.find((f) => errors[i]?.[f]);
      if (field) {
        window.setTimeout(() => document.getElementById(footerFieldId(i, field))?.focus(), 0);
        return;
      }
    }
  };

  const handleSave = async () => {
    // The library is one value, saved whole, so nothing saves until every
    // card is right; each reason is said on its card's field rather than by
    // a Save button greyed out with no word why (forms review F-3).
    const local: FooterErrors[] = draft.map((footer, i) => ({
      ...(footer.name.trim() ? {} : { name: 'Name this footer.' }),
      ...(keyErrors[i] ? { key: keyErrors[i] } : {}),
    }));
    if (local.some((e) => Object.keys(e).length > 0)) {
      setCardErrors(local);
      focusFirst(local);
      return;
    }
    try {
      await saveFooters(draftDefault, draft);
      setCardErrors([]);
      toast.success('Footers saved');
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, footerServerFields(draft.length));
      const placed = mapped ? Object.keys(mapped.fieldErrors) : [];
      if (mapped && placed.length > 0) {
        const next: FooterErrors[] = draft.map(() => ({}));
        for (const key of placed) {
          const [i, field] = key.split('.') as [string, FooterField];
          const card = next[Number(i)];
          const message = mapped.fieldErrors[key];
          if (card && message && !card[field]) card[field] = message;
        }
        setCardErrors(next);
        focusFirst(next);
        // The store's banner would repeat what the fields now say.
        if (mapped.unmatched.length === 0) clearError();
      } else {
        toast.error('Failed to save footers');
      }
    }
  };

  const handleDelete = async (index: number) => {
    const footer = draft[index];
    if (!footer) return;
    const count = usage[footer.key] ?? 0;
    const consequence =
      count > 0
        ? ` ${count} template${count === 1 ? '' : 's'} currently close${count === 1 ? 's' : ''} with it; ${count === 1 ? 'it' : 'they'} will fall back to the default footer.`
        : '';
    const ok = await confirm({
      title: 'Delete this footer?',
      message: `"${footer.name}" will be removed.${consequence}`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    setDraft((prev) => prev.filter((_, i) => i !== index));
    setCardErrors((prev) => prev.filter((_, i) => i !== index));
  };

  if (isLoading && !hasLoaded) {
    return <SkeletonPage rows={4} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-theme-text-primary text-lg font-semibold">Footers</h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            The closing block on every email. Each template picks the footer it uses, so mail to members, mail to people
            outside the department, and notices that go on a member's record can each close differently. Templates that
            have not picked one use the default.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={() => {
                setDraft(footers);
                setDraftDefault(defaultKey);
                setCardErrors([]);
              }}
              disabled={isSaving}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Discard
            </button>
          )}
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={!isDirty || isSaving}
            className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-danger flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="flex-1 text-sm">{error}</p>
          <button onClick={clearError} aria-label="Dismiss error">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {variables.length > 0 && (
        <div className="card-secondary px-4 py-3">
          <p className="text-theme-text-muted text-xs">
            A footer line may use these variables:{' '}
            {variables.map((variable, index) => (
              <React.Fragment key={variable.name}>
                {index > 0 && ', '}
                <span className="text-theme-text-secondary font-mono" title={variable.description}>
                  {`{{${variable.name}}}`}
                </span>
              </React.Fragment>
            ))}
          </p>
        </div>
      )}

      <DepartmentContactCard onSaved={refreshContactDetails} />

      <div className="space-y-4">
        {draft.map((footer, index) => (
          <FooterCard
            key={index}
            index={index}
            footer={footer}
            errors={cardErrors[index] ?? {}}
            contactDetails={contactDetails}
            isDefault={footer.key === draftDefault}
            usageCount={usage[footer.key] ?? 0}
            keyError={keyErrors[index] ?? null}
            canDelete={draft.length > 1 && footer.key !== draftDefault}
            onChange={(next) => {
              setDraft((prev) => prev.map((f, i) => (i === index ? next : f)));
              setCardErrors((prev) => prev.map((e, i) => (i === index ? {} : e)));
              // Keep the default pointing at this footer when its key is
              // renamed, otherwise the save is rejected for naming a footer
              // that no longer exists.
              if (footer.key === draftDefault) setDraftDefault(next.key);
            }}
            onMakeDefault={() => setDraftDefault(footer.key)}
            onDelete={() => {
              void handleDelete(index);
            }}
          />
        ))}
      </div>

      {draft.length < MAX_FOOTERS && (
        <button
          type="button"
          onClick={() => setDraft((prev) => [...prev, blankFooter(prev.map((f) => f.key))])}
          className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-sm transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add a footer
        </button>
      )}
    </div>
  );
};

export default FootersPanel;
