/**
 * Officers Panel
 *
 * Records which member holds each department office so email templates can
 * be signed by the officeholder ({{president_name}}, {{chief_title}}, ...)
 * rather than by whoever generated the message.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Copy, Loader2, RefreshCw, RotateCcw, UserCheck, UserCog, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { SkeletonPage } from '../../../components/ux';
import { useOfficersStore } from '../store/officersStore';
import type { DepartmentOfficer } from '../types';
import { displayNameOf } from '../../../utils/memberName';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';

interface OfficersPanelProps {
  /** Org members, used to populate the "who holds this office" picker. */
  members: {
    id: string;
    full_name?: string | undefined;
    display_name?: string | undefined;
    first_name?: string | undefined;
    last_name?: string | undefined;
    preferred_name?: string | null | undefined;
    email?: string | undefined;
  }[];
  isLoadingMembers: boolean;
}

type OfficerField = 'user_id' | 'display_name' | 'title' | 'email' | 'phone';

/**
 * `OfficerUpdate` in schemas/officer.py. An assignment replaces the office's
 * whole override set on each save, so a refusal holds the save back rather
 * than keeping part of it. Ordered as on screen.
 */
const OFFICER_FIELDS: Record<OfficerField, ServerFieldSpec> = {
  user_id: { label: 'Member' },
  display_name: { label: 'Name override', maxLength: 200 },
  title: { label: 'Signature title', maxLength: 150 },
  email: { label: 'Email override', maxLength: 320 },
  phone: { label: 'Phone override', maxLength: 50 },
};
const OFFICER_ORDER = Object.keys(OFFICER_FIELDS) as OfficerField[];

const CATEGORY_LABELS: Record<string, string> = {
  operational: 'Operational (Line) Officers',
  administrative: 'Administrative (Corporate) Officers',
};

const SOURCE_BADGES: Record<DepartmentOfficer['source'], { label: string; className: string; title: string }> = {
  assigned: {
    label: 'Assigned',
    className: 'bg-green-500/10 text-green-800 dark:text-green-400 border-green-500/30',
    title: 'Pinned by an administrator on this screen',
  },
  auto: {
    label: 'Auto-detected',
    className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
    title: 'Inferred from the member who holds the matching position — assign someone to pin it',
  },
  unset: {
    label: 'Vacant',
    className: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
    title: 'Nobody holds this office — its variables render as blank',
  },
};

function memberLabel(member: OfficersPanelProps['members'][number]): string {
  return displayNameOf(member) || member.email || member.id;
}

interface OfficerRowProps {
  office: DepartmentOfficer;
  members: OfficersPanelProps['members'];
  isSaving: boolean;
  onSave: (
    officeKey: string,
    data: {
      user_id?: string | undefined;
      display_name?: string | undefined;
      title?: string | undefined;
      email?: string | undefined;
      phone?: string | undefined;
    }
  ) => Promise<void>;
  onClear: (officeKey: string) => Promise<void>;
  /** A refusal was shown on the row's own fields, so the panel's banner need not repeat it. */
  onFieldRefusal: () => void;
}

const OfficerRow: React.FC<OfficerRowProps> = ({ office, members, isSaving, onSave, onClear, onFieldRefusal }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [userId, setUserId] = useState(office.user_id ?? '');
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Partial<Record<OfficerField, string>>>({});
  const values: Record<OfficerField, string> = { user_id: userId, display_name: displayName, title, email, phone };
  const stored: Record<OfficerField, string> = {
    user_id: office.user_id ?? '',
    display_name: office.override_name ?? '',
    title: office.override_title ?? '',
    email: office.override_email ?? '',
    phone: office.override_phone ?? '',
  };
  const fieldId = (field: OfficerField) =>
    `officer-${field === 'user_id' ? 'member' : field === 'display_name' ? 'name' : field}-${office.office_key}`;
  // Cancel asks before typed changes are thrown away (forms review F-6); with
  // the form closed there is nothing to ask about.
  const closeEditor = () => {
    setIsEditing(false);
    setErrors({});
    setUserId(stored.user_id);
    setDisplayName(stored.display_name);
    setTitle(stored.title);
    setEmail(stored.email);
    setPhone(stored.phone);
  };
  const requestCancel = useDiscardGuard({
    isDirty: isEditing ? OFFICER_ORDER.some((f) => values[f] !== stored[f]) : undefined,
    onClose: closeEditor,
  });
  const edit = (field: OfficerField, setter: (v: string) => void) => (value: string) => {
    setter(value);
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Reset the draft whenever the persisted office changes (including after a
  // save round-trip), so the form never shows values the server rejected.
  // Seeded from the raw overrides rather than the resolved values — seeding
  // from the resolved ones would turn every inherited member field into an
  // override the moment an admin pressed Save.
  useEffect(() => {
    setUserId(office.user_id ?? '');
    setDisplayName(office.override_name ?? '');
    setTitle(office.override_title ?? '');
    setEmail(office.override_email ?? '');
    setPhone(office.override_phone ?? '');
  }, [office]);

  const badge = SOURCE_BADGES[office.source];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // `||` not `??`: an untouched field is '' and must be omitted from the
      // payload entirely, which `??` would let through as an empty string.
      await onSave(office.office_key, {
        user_id: userId || undefined,
        display_name: displayName.trim() || undefined,
        title: title.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setErrors({});
      setIsEditing(false);
    } catch (err: unknown) {
      // A refusal lands on its field and the form stays open with what was
      // typed (forms review F-2); it used to close and drop the entries.
      const mapped = mapServerFieldErrors(err, OFFICER_FIELDS);
      const first = mapped ? OFFICER_ORDER.find((f) => mapped.fieldErrors[f]) : undefined;
      if (mapped && first) {
        setErrors(mapped.fieldErrors);
        onFieldRefusal();
        document.getElementById(fieldId(first))?.focus();
      }
      if (!first || (mapped && mapped.unmatched.length > 0)) {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save officer'));
      }
    }
  };

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-theme-text-primary text-sm font-semibold">{office.label}</h4>
            <span title={badge.title} className={`badge border ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-theme-text-primary mt-1 text-sm">
            {office.name || <span className="text-theme-text-muted italic">No holder</span>}
            {office.name && office.title ? <span className="text-theme-text-muted"> — {office.title}</span> : null}
          </p>
          {(office.email || office.phone) && (
            <p className="text-theme-text-muted mt-0.5 text-xs">
              {[office.email, office.phone].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isSaving && <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />}
          {office.source === 'assigned' && !isEditing && (
            <button
              onClick={() => {
                void onClear(office.office_key);
              }}
              disabled={isSaving}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50"
              title="Remove this assignment and fall back to position auto-detection"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => (isEditing ? requestCancel() : setIsEditing(true))}
            disabled={isSaving}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50"
          >
            {isEditing ? <X className="h-3.5 w-3.5" /> : <UserCog className="h-3.5 w-3.5" />}
            {isEditing ? 'Cancel' : 'Assign'}
          </button>
        </div>
      </div>

      {isEditing && (
        <form
          noValidate
          onSubmit={(e) => void handleSave(e)}
          className="border-theme-surface-border mt-4 space-y-3 border-t pt-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              id={fieldId('user_id')}
              label="Member"
              error={errors.user_id}
              hint="Name, email, and phone follow this member's record."
            >
              {(field) => (
                <select
                  {...field}
                  value={userId}
                  onChange={(e) => edit('user_id', setUserId)(e.target.value)}
                  className="form-input"
                >
                  <option value="">— None (use the name below) —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {memberLabel(m)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>

            <FormField
              id={fieldId('display_name')}
              label="Name override"
              error={errors.display_name}
              maxLength={OFFICER_FIELDS.display_name.maxLength}
              count={displayName.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  autoComplete="off"
                  value={displayName}
                  onChange={(e) => edit('display_name', setDisplayName)(e.target.value)}
                  className="form-input"
                  placeholder="For an officeholder without a member account"
                />
              )}
            </FormField>

            <FormField
              id={fieldId('title')}
              label="Signature title"
              error={errors.title}
              maxLength={OFFICER_FIELDS.title.maxLength}
              count={title.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  autoComplete="off"
                  value={title}
                  onChange={(e) => edit('title', setTitle)(e.target.value)}
                  className="form-input"
                  placeholder={office.default_title}
                />
              )}
            </FormField>

            <FormField
              id={fieldId('email')}
              label="Email override"
              error={errors.email}
              maxLength={OFFICER_FIELDS.email.maxLength}
              count={email.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => edit('email', setEmail)(e.target.value)}
                  className="form-input"
                  placeholder="Office address, if not the holder's own"
                />
              )}
            </FormField>

            <FormField
              id={fieldId('phone')}
              label="Phone override"
              error={errors.phone}
              maxLength={OFFICER_FIELDS.phone.maxLength}
              count={phone.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="tel"
                  autoComplete="off"
                  value={phone}
                  onChange={(e) => edit('phone', setPhone)(e.target.value)}
                  className="form-input"
                  placeholder="Office phone, if not the holder's own"
                />
              )}
            </FormField>
          </div>

          {office.auto_candidates.length > 0 && (
            <p className="text-theme-text-muted flex items-start gap-1.5 text-xs">
              <Users className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Holds the {office.position_slugs.join(' / ')} position:{' '}
                {office.auto_candidates.map((c) => c.name).join(', ')}
              </span>
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary flex items-center gap-2 text-sm disabled:cursor-not-allowed"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

const OfficersPanel: React.FC<OfficersPanelProps> = ({ members, isLoadingMembers }) => {
  const {
    offices,
    variables,
    isLoading,
    savingOfficeKey,
    error,
    hasLoaded,
    fetchOfficers,
    setOfficer,
    clearOfficer,
    clearError,
  } = useOfficersStore();
  const [copiedVariable, setCopiedVariable] = useState<string | null>(null);

  useEffect(() => {
    void fetchOfficers();
  }, [fetchOfficers]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, typeof offices>();
    for (const office of offices) {
      const bucket = byCategory.get(office.category) ?? [];
      bucket.push(office);
      byCategory.set(office.category, bucket);
    }
    return Array.from(byCategory.entries());
  }, [offices]);

  const handleSave = async (
    officeKey: string,
    data: {
      user_id?: string | undefined;
      display_name?: string | undefined;
      title?: string | undefined;
      email?: string | undefined;
      phone?: string | undefined;
    }
  ) => {
    // A failure is the row's to report: it puts a refusal on the field that
    // caused it and keeps the form open with what was typed.
    await setOfficer(officeKey, data);
    toast.success('Officer saved');
  };

  const handleClear = async (officeKey: string) => {
    try {
      await clearOfficer(officeKey);
      toast.success('Assignment cleared');
    } catch {
      toast.error('Failed to clear assignment');
    }
  };

  const handleCopyVariable = async (name: string) => {
    const tag = `{{${name}}}`;
    try {
      await navigator.clipboard.writeText(tag);
      setCopiedVariable(name);
      window.setTimeout(() => setCopiedVariable(null), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  if (isLoading && !hasLoaded) {
    return <SkeletonPage rows={6} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-red-800 p-2">
          <UserCheck className="h-5 w-5 text-white" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-theme-text-primary text-lg font-semibold">Department Officers</h2>
          <p className="text-theme-text-muted text-sm">
            Record who holds each office so templates can sign a message with the officeholder&apos;s name, no matter
            which member generated it. Offices left unassigned fall back to the member holding the matching position.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start space-x-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
          <p className="flex-1 text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={clearError}
            className="text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {isLoadingMembers && (
        <p className="text-theme-text-muted flex items-center gap-2 text-xs">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Loading members…
        </p>
      )}

      {grouped.map(([category, categoryOffices]) => (
        <section key={category} className="space-y-3">
          <h3 className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">
            {CATEGORY_LABELS[category] ?? category}
          </h3>
          <div className="space-y-3">
            {categoryOffices.map((office) => (
              <OfficerRow
                key={office.office_key}
                office={office}
                members={members}
                isSaving={savingOfficeKey === office.office_key}
                onSave={handleSave}
                onClear={handleClear}
                onFieldRefusal={clearError}
              />
            ))}
          </div>
        </section>
      ))}

      {variables.length > 0 && (
        <section className="card-secondary p-4">
          <h3 className="text-theme-text-primary mb-1 text-sm font-semibold">
            Signature Variables ({variables.length})
          </h3>
          <p className="text-theme-text-muted mb-3 text-xs">
            Paste any of these into a template&apos;s subject or body. Click to copy.
          </p>
          <div className="flex flex-wrap gap-2">
            {variables.map((v) => (
              <button
                key={v.name}
                onClick={() => {
                  void handleCopyVariable(v.name);
                }}
                title={v.description}
                className="inline-flex items-center gap-1.5 rounded-sm border border-red-500/30 bg-red-500/10 px-2.5 py-1 font-mono text-xs text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-400"
              >
                {copiedVariable === v.name ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {`{{${v.name}}}`}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default OfficersPanel;
