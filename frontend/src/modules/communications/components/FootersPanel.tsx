/**
 * Footers Panel
 *
 * The department's library of closing blocks. Each template names the footer
 * it uses, so the wording is edited once here instead of in every template —
 * and mail to members, mail to the public, and notices that go on a member's
 * record can each close differently.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { SkeletonPage } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useFootersStore } from '../store/footersStore';
import type { EmailFooter } from '../types';

/** Mirrors the backend's key pattern, so a bad key is caught before the save. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_FOOTERS = 12;
const MAX_LINES = 6;

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
    show_mailing_address: false,
  };
}

interface FooterCardProps {
  footer: EmailFooter;
  isDefault: boolean;
  usageCount: number;
  keyError: string | null;
  canDelete: boolean;
  onChange: (next: EmailFooter) => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}

const FooterCard: React.FC<FooterCardProps> = ({
  footer,
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

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <input
            type="text"
            value={footer.name}
            onChange={(e) => onChange({ ...footer, name: e.target.value })}
            className="form-input font-semibold"
            aria-label="Footer name"
            maxLength={100}
          />
          <input
            type="text"
            value={footer.description ?? ''}
            onChange={(e) => onChange({ ...footer, description: e.target.value })}
            className="form-input-sm"
            placeholder="When to use this one (optional)"
            aria-label="Footer description"
            maxLength={300}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDefault ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs text-green-700 dark:text-green-400">
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
        <div>
          <label className="form-label" htmlFor={`footer-key-${footer.key}`}>
            Key
          </label>
          <input
            id={`footer-key-${footer.key}`}
            type="text"
            value={footer.key}
            onChange={(e) => onChange({ ...footer, key: e.target.value })}
            className={`form-input font-mono ${keyError ? 'border-red-500' : ''}`}
            maxLength={32}
            aria-invalid={!!keyError}
          />
          {keyError ? (
            <p className="mt-1 text-xs text-red-500">{keyError}</p>
          ) : (
            <p className="text-theme-text-muted mt-1 text-xs">
              How templates refer to this footer. Recipients never see it.
            </p>
          )}
        </div>
        <div className="flex items-end">
          <p className="text-theme-text-muted text-xs">
            {usageCount === 0
              ? 'No templates close with this footer.'
              : `${usageCount} template${usageCount === 1 ? '' : 's'} close${usageCount === 1 ? 's' : ''} with this footer.`}
          </p>
        </div>
      </div>

      <div>
        <span className="form-label">Lines</span>
        <div className="space-y-2">
          {footer.lines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={line}
                onChange={(e) => setLine(index, e.target.value)}
                className="form-input flex-1"
                placeholder="A sentence to close with"
                aria-label={`Footer line ${index + 1}`}
                maxLength={300}
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

      <div className="flex flex-wrap gap-4">
        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={footer.show_contact}
            onChange={(e) => onChange({ ...footer, show_contact: e.target.checked })}
          />
          Phone, email and website
        </label>
        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={footer.show_mailing_address}
            onChange={(e) => onChange({ ...footer, show_mailing_address: e.target.checked })}
          />
          Mailing address
        </label>
      </div>
    </div>
  );
};

const FootersPanel: React.FC = () => {
  const {
    footers,
    defaultKey,
    variables,
    usage,
    isLoading,
    isSaving,
    error,
    hasLoaded,
    fetchFooters,
    saveFooters,
    clearError,
  } = useFootersStore();
  const { confirm } = useConfirm();

  const [draft, setDraft] = useState<EmailFooter[]>([]);
  const [draftDefault, setDraftDefault] = useState('');

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
  const hasErrors = keyErrors.some(Boolean) || draft.some((f) => !f.name.trim());

  const handleSave = async () => {
    if (hasErrors) return;
    try {
      await saveFooters(draftDefault, draft);
      toast.success('Footers saved');
    } catch {
      toast.error('Failed to save footers');
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
            disabled={!isDirty || isSaving || hasErrors}
            className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-error flex items-start gap-3">
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

      <div className="space-y-4">
        {draft.map((footer, index) => (
          <FooterCard
            key={index}
            footer={footer}
            isDefault={footer.key === draftDefault}
            usageCount={usage[footer.key] ?? 0}
            keyError={keyErrors[index] ?? null}
            canDelete={draft.length > 1 && footer.key !== draftDefault}
            onChange={(next) => {
              setDraft((prev) => prev.map((f, i) => (i === index ? next : f)));
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
