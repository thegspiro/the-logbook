/**
 * Picks the shift evaluation form a training program uses.
 *
 * Offers the department's active templates, plus the one already chosen even
 * if it has since been made inactive, so opening an older program does not
 * silently show "No evaluation form" for a form it still has.
 *
 * The value is a template id or '' for none; callers convert '' with `||
 * undefined` on create and `blankToNull` on update (Pitfall #1).
 */

import React, { useEffect, useState } from 'react';
import { shiftEvaluationTemplateService } from '../../services/api';
import type { ShiftEvaluationTemplate } from '../../types/training';

interface Props {
  id: string;
  value: string;
  onChange: (templateId: string) => void;
  /** Extra classes for the select, e.g. 'text-sm'. */
  className?: string | undefined;
}

export const ShiftEvaluationTemplateSelect: React.FC<Props> = ({ id, value, onChange, className }) => {
  const [templates, setTemplates] = useState<ShiftEvaluationTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    shiftEvaluationTemplateService
      .list()
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choices = (templates ?? []).filter((t) => t.is_active || t.id === value);
  const describedBy = `${id}-hint`;

  return (
    <div>
      <label htmlFor={id} className="form-label">
        Shift evaluation form
      </label>
      <select
        id={id}
        className={`form-input ${className ?? ''}`}
        value={value}
        disabled={templates === null || failed}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">No evaluation form</option>
        {/* Keeps the stored choice visible while the list loads or if it failed. */}
        {value && !choices.some((t) => t.id === value) && <option value={value}>Current form</option>}
        {choices.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.is_active ? '' : ' (inactive)'}
          </option>
        ))}
      </select>
      <p id={describedBy} className="text-theme-text-muted mt-1 text-xs">
        {failed
          ? 'Evaluation forms could not be loaded. The current choice is kept.'
          : 'Members enrolled in this program are evaluated on this form after a shift. Forms are built under Settings & Data → Shift Evaluations.'}
      </p>
    </div>
  );
};

export default ShiftEvaluationTemplateSelect;
