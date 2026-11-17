/**
 * "Who can charge your lines" — a budget owner's own control over which of
 * their categories are open to every requester and which are kept for them
 * and the positions they choose (a Quartermaster keeping officer brass for
 * themselves and opening boot reimbursement to everyone).
 *
 * Which categories the caller may set, and the rule each is under, are the
 * backend's answer (`GET /finance/charge-access`); a member who manages none
 * gets an empty list and this renders nothing.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, ShieldCheck } from 'lucide-react';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { budgetCategoryService } from '../services/api';
import type { BudgetCategory, ChargeAccessSettings } from '../types';
import { categoryPathLabel } from '../utils/budgetCategoryTree';
import {
  chargeAccessPayloadOf,
  chargeAccessValueOf,
  chargeRuleSummary,
  inheritedChargeHint,
  type ChargeAccessValue,
} from '../utils/chargeAccess';
import { refusalsOnFields } from '../utils/fieldRefusals';
import { ChargeAccessFields, type ChargeAccessFieldErrors } from './ChargeAccessFields';

type ChargeField = keyof ChargeAccessFieldErrors;

/**
 * `BudgetCategoryChargeAccessUpdate` (schemas/finance.py) names a refusal by
 * its snake_case field (`loc_by_alias=False`); the defaults read both
 * spellings. The position list is capped at 200 ids there.
 */
const SERVER_FIELDS: Record<ChargeField, ServerFieldSpec> = {
  chargeAccess: { label: 'Who can charge these lines' },
  chargePositionIds: { label: 'Also allow these positions' },
};
const FIELD_ORDER: readonly ChargeField[] = ['chargeAccess', 'chargePositionIds'];
const ID_PREFIX = 'owner-charge';
/** The ids ChargeAccessFields gives each part under ID_PREFIX. */
const FIELD_IDS: Record<ChargeField, string> = {
  chargeAccess: `${ID_PREFIX}-access`,
  chargePositionIds: `${ID_PREFIX}-positions`,
};

interface ChargeAccessDialogProps {
  category: BudgetCategory;
  parent: BudgetCategory | undefined;
  positions: ChargeAccessSettings['positions'];
  onClose: () => void;
  onSaved: () => void;
}

const ChargeAccessDialog: React.FC<ChargeAccessDialogProps> = ({ category, parent, positions, onClose, onSaved }) => {
  const [initial] = useState<ChargeAccessValue>(() => chargeAccessValueOf(category));
  const [value, setValue] = useState<ChargeAccessValue>(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ChargeAccessFieldErrors>({});
  // A refusal no field answers for (a position that no longer exists, a lost
  // connection) is said in the dialog, not only in a toast (forms review F-5).
  const [formError, setFormError] = useState<string | null>(null);
  // Escape, the X and Cancel ask before throwing a changed choice away (F-6).
  const isDirty =
    value.access !== initial.access ||
    value.positionIds.length !== initial.positionIds.length ||
    value.positionIds.some((id) => !initial.positionIds.includes(id));
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    // The whole setting is replaced at once, so a refusal saves none of it
    // and the dialog stays open on the choice that was refused.
    budgetCategoryService
      .setChargeAccess(category.id, chargeAccessPayloadOf(value))
      .then(() => {
        toast.success('Saved');
        onSaved();
      })
      .catch((err: unknown) => {
        const mapped = refusalsOnFields(err, SERVER_FIELDS);
        if (mapped) {
          setErrors(mapped.fieldErrors);
          const first = FIELD_ORDER.find((field) => mapped.fieldErrors[field]);
          if (first) document.getElementById(FIELD_IDS[first])?.focus();
          if (mapped.unmatched.length > 0) setFormError(mapped.unmatched.join(' '));
          return;
        }
        const message = getErrorMessage(err, 'Could not save who can charge these lines');
        setFormError(message);
        toast.error(message);
      })
      .finally(() => setSaving(false));
  };

  const change = (next: ChargeAccessValue) => {
    setValue(next);
    setErrors({});
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={`Who can charge ${categoryPathLabel(category)}`}
      titleId="charge-access-title"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <ChargeAccessFields
          idPrefix={ID_PREFIX}
          value={value}
          onChange={change}
          positions={positions}
          isTopLevel={!category.parentCategoryId}
          inheritedHint={inheritedChargeHint(parent?.name, parent?.effectiveChargeAccess)}
          errors={errors}
        />
        {formError && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {formError}
          </p>
        )}
      </div>
    </Modal>
  );
};

export const ChargeAccessSection: React.FC = () => {
  const [settings, setSettings] = useState<ChargeAccessSettings | null>(null);
  const [editing, setEditing] = useState<BudgetCategory | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await budgetCategoryService.chargeAccessSettings());
    } catch {
      // Optional on this page: the lines above still show without it.
      setSettings(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings || settings.categories.length === 0) return null;

  const positionNames = new Map(settings.positions.map((p) => [p.id, p.name]));
  const byId = new Map(settings.categories.map((c) => [c.id, c]));

  return (
    <section aria-labelledby="charge-access-heading" className="card p-4">
      <h2 id="charge-access-heading" className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
        Who can charge your lines
      </h2>
      <p className="text-theme-text-secondary mt-1 text-sm">
        Open a line to everyone who submits purchase, check and expense requests, or keep it for your position and the
        positions you choose. A sub-line follows its parent unless you set it.
      </p>
      <ul className="divide-theme-surface-border mt-3 divide-y">
        {settings.categories.map((category) => (
          <li key={category.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-theme-text-primary text-sm font-medium break-words">{categoryPathLabel(category)}</p>
              <p className="text-theme-text-secondary text-xs">{chargeRuleSummary(category, positionNames)}</p>
            </div>
            <button
              type="button"
              onClick={() => setEditing(category)}
              aria-label={`Change who can charge ${categoryPathLabel(category)}`}
              className="btn-icon text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary rounded-lg"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <ChargeAccessDialog
          key={editing.id}
          category={editing}
          parent={editing.parentCategoryId ? byId.get(editing.parentCategoryId) : undefined}
          positions={settings.positions}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </section>
  );
};
