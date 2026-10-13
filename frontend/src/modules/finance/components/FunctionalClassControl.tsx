/**
 * A payment's functional classification (program, management & general,
 * fundraising), on its detail page.
 *
 * The class shown is the backend's `effectiveFunctionalClass` — the payment's
 * own override, else its budget category's, else the nearest parent's — the
 * same reading the Functional expenses report counts (CLAUDE.md pitfall #29).
 * A `finance.manage` holder can override it for this one payment; clearing the
 * override returns it to the category's class. Members raising requests do not
 * see it: it is the finance office's bookkeeping, not part of their request.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { getErrorMessage } from '@/utils/errorHandling';
import { FUNCTIONAL_CLASS_LABELS, FunctionalClass, isFunctionalClass } from '../types';

interface FunctionalClassControlProps {
  /** This payment's own override, if any. */
  value?: FunctionalClass | null | undefined;
  /** The class it takes once its category's applies. */
  effective?: FunctionalClass | null | undefined;
  /** What the control is for, for its accessible name, e.g. "Helmets". */
  subject: string;
  onChange: (next: FunctionalClass | null) => Promise<void>;
  /** Drop the visible label, for a table cell whose header already says it. */
  compact?: boolean;
}

const label = (fc: FunctionalClass | null | undefined) => (fc ? FUNCTIONAL_CLASS_LABELS[fc] : 'Not classified');

export const FunctionalClassControl: React.FC<FunctionalClassControlProps> = ({
  value,
  effective,
  subject,
  onChange,
  compact = false,
}) => {
  const canEdit = useAuthStore((s) => s.checkPermission('finance.manage'));
  const canSee = useAuthStore((s) => s.checkPermission('finance.view') || s.checkPermission('finance.manage'));
  const [saving, setSaving] = useState(false);

  if (!canSee) return null;

  const fromCategory = !value;
  const withLabel = (control: React.ReactNode) =>
    compact ? (
      control
    ) : (
      <div>
        <p className="text-theme-text-secondary text-xs">Expense classification</p>
        {control}
      </div>
    );

  if (!canEdit) {
    return withLabel(
      <span className="text-theme-text-primary text-sm">
        {label(effective)}
        {fromCategory && effective && (
          <span className="text-theme-text-secondary text-xs"> (from its budget category)</span>
        )}
      </span>
    );
  }

  const change = async (raw: string) => {
    setSaving(true);
    try {
      await onChange(isFunctionalClass(raw) ? raw : null);
      toast.success('Classification saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the classification'));
    } finally {
      setSaving(false);
    }
  };

  // While no override is set, the effective class is the category's.
  const categoryClass = fromCategory ? effective : null;

  return withLabel(
    <select
      className={compact ? 'form-input-sm w-full' : 'form-input-sm mt-0.5'}
      aria-label={`Expense classification for ${subject}`}
      value={value ?? ''}
      disabled={saving}
      onChange={(e) => void change(e.target.value)}
    >
      <option value="">
        {fromCategory ? `Category's class (${label(categoryClass)})` : "Use the category's class"}
      </option>
      {Object.values(FunctionalClass).map((fc) => (
        <option key={fc} value={fc}>
          {FUNCTIONAL_CLASS_LABELS[fc]}
        </option>
      ))}
    </select>
  );
};

export default FunctionalClassControl;
