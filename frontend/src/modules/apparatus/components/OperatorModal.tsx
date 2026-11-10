/**
 * Operator Modal
 *
 * Modal form for adding and editing certified operators on an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { userService } from '../../../services/api';
import type { User } from '../../../types/user';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { blankToNull } from '../../../utils/formValues';
import { apparatusOperatorService, evocLevelService } from '../services/api';
import type { ApparatusOperator, ApparatusOperatorCreate, ApparatusOperatorUpdate, EvocLevel } from '../types';
import { displayNameOf } from '../../../utils/memberName';

interface OperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  apparatusId: string;
  editOperator?: ApparatusOperator | null;
}

interface FormData {
  userId: string;
  evocLevelId: string;
  isCertified: boolean;
  certificationDate: string;
  certificationExpiration: string;
  licenseTypeRequired: string;
  licenseVerified: boolean;
  licenseVerifiedDate: string;
  hasRestrictions: boolean;
  restrictionNotes: string;
  isActive: boolean;
  notes: string;
}

const EMPTY: FormData = {
  userId: '',
  evocLevelId: '',
  isCertified: false,
  certificationDate: '',
  certificationExpiration: '',
  licenseTypeRequired: '',
  licenseVerified: false,
  licenseVerifiedDate: '',
  hasRestrictions: false,
  restrictionNotes: '',
  isActive: true,
  notes: '',
};

type OperatorField =
  | 'userId'
  | 'evocLevelId'
  | 'certificationDate'
  | 'certificationExpiration'
  | 'licenseTypeRequired'
  | 'licenseVerifiedDate'
  | 'restrictionNotes'
  | 'notes';

/**
 * How the operator endpoints' field names land on this dialog (forms review
 * F-2), in screen order. The length is `ApparatusOperatorBase`'s max_length.
 */
const OPERATOR_FIELDS: Record<OperatorField, ServerFieldSpec> = {
  userId: { label: 'Member' },
  evocLevelId: { label: 'EVOC certification level' },
  certificationDate: { label: 'Certification date' },
  certificationExpiration: { label: 'Certification expiration' },
  licenseTypeRequired: { label: 'License type required', maxLength: 50 },
  licenseVerifiedDate: { label: 'License verified date' },
  restrictionNotes: { label: 'Restriction notes' },
  notes: { label: 'Notes' },
};

const IDS = {
  ...(Object.fromEntries(Object.keys(OPERATOR_FIELDS).map((k) => [k, `operator-${k}`])) as Record<
    OperatorField,
    string
  >),
  // Kept: other code and tests already address the picker by this id.
  userId: 'operator-member',
};

const inputClass = 'form-input px-3 focus:ring-red-500/50 focus:border-red-500';

export const OperatorModal: React.FC<OperatorModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  apparatusId,
  editOperator,
}) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [evocLevels, setEvocLevels] = useState<EvocLevel[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [errors, setErrors] = useState<Partial<Record<OperatorField, string>>>({});
  // What the form held when it opened (or last saved), so Escape, the X and
  // Cancel can ask before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const isDirty = baseline !== '' && JSON.stringify(f) !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    if (isOpen) {
      void evocLevelService
        .getLevels()
        .then(setEvocLevels)
        .catch(() => {
          /* EVOC levels may not be configured */
        });
      void userService
        .getUsers()
        .then(setMembers)
        .catch(() => {
          /* the picker falls back to disabled rather than to a UUID box */
        });
    }
  }, [isOpen]);

  useEffect(() => {
    let seeded: FormData = EMPTY;
    if (editOperator) {
      seeded = {
        userId: editOperator.userId,
        evocLevelId: editOperator.evocLevelId ?? '',
        isCertified: editOperator.isCertified,
        certificationDate: editOperator.certificationDate?.split('T')[0] ?? '',
        certificationExpiration: editOperator.certificationExpiration?.split('T')[0] ?? '',
        licenseTypeRequired: editOperator.licenseTypeRequired ?? '',
        licenseVerified: editOperator.licenseVerified,
        licenseVerifiedDate: editOperator.licenseVerifiedDate?.split('T')[0] ?? '',
        hasRestrictions: editOperator.hasRestrictions,
        restrictionNotes: editOperator.restrictionNotes ?? '',
        isActive: editOperator.isActive,
        notes: editOperator.notes ?? '',
      };
    }
    setF(seeded);
    setBaseline(JSON.stringify(seeded));
    setErrors({});
  }, [editOperator, isOpen]);

  const up = (k: keyof FormData, v: string | boolean) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k in OPERATOR_FIELDS) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<OperatorField, string>>) => {
    setErrors(next);
    const first = (Object.keys(OPERATOR_FIELDS) as OperatorField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(IDS[first])?.focus(), 0);
  };

  /** After a save that wrote everything but `refused`: flag those, and count only them as unsaved. */
  const keepRefused = (refused: Partial<Record<OperatorField, string>>) => {
    showErrors(refused);
    const stored = JSON.parse(baseline) as FormData;
    const keys = Object.keys(refused) as OperatorField[];
    setBaseline(JSON.stringify({ ...f, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) }));
    const first = (Object.keys(OPERATOR_FIELDS) as OperatorField[]).find((k) => refused[k]);
    if (first)
      toast.error(
        `Operator saved, except ${OPERATOR_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
      );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Only a new operator picks a member, so a new record is all this can refuse.
    const missing: Partial<Record<OperatorField, string>> = {};
    if (!editOperator && !f.userId) {
      showErrors({ userId: 'Select a member.' });
      return;
    }

    setSaving(true);
    try {
      if (editOperator) {
        // Every field the form owns, every save: the backend applies updates
        // with exclude_unset, so a blank left out of the payload would keep
        // the old value. A blank goes as null, which clears it.
        const payload: ApparatusOperatorUpdate = {
          evocLevelId: f.evocLevelId || null,
          isCertified: f.isCertified,
          certificationDate: f.certificationDate || null,
          certificationExpiration: f.certificationExpiration || null,
          licenseTypeRequired: blankToNull(f.licenseTypeRequired),
          licenseVerified: f.licenseVerified,
          licenseVerifiedDate: f.licenseVerifiedDate || null,
          hasRestrictions: f.hasRestrictions,
          restrictionNotes: blankToNull(f.restrictionNotes),
          isActive: f.isActive,
          notes: blankToNull(f.notes),
        };
        // Single-save rule (owner, 2026-11-05): a value the record cannot hold
        // is not written — its key is left out, which the backend reads as
        // "leave alone", so the stored value is kept — the rest saves, and the
        // field stays flagged until it is fixed.
        let refused: Partial<Record<OperatorField, string>> = missing;
        const send = (skip: Partial<Record<OperatorField, string>>) => {
          const rest: Record<string, unknown> = { ...payload };
          for (const key of Object.keys(skip)) delete rest[key];
          return apparatusOperatorService.updateOperator(editOperator.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = mapServerFieldErrors(err, OPERATOR_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          onSaved();
          keepRefused(refused);
          return;
        }
        toast.success('Operator updated');
      } else {
        const payload: ApparatusOperatorCreate = {
          apparatusId,
          userId: f.userId,
          evocLevelId: f.evocLevelId || undefined,
          isCertified: f.isCertified,
          licenseVerified: f.licenseVerified,
          hasRestrictions: f.hasRestrictions,
          isActive: f.isActive,
          ...(f.certificationDate ? { certificationDate: f.certificationDate } : {}),
          ...(f.certificationExpiration ? { certificationExpiration: f.certificationExpiration } : {}),
          ...(f.licenseTypeRequired ? { licenseTypeRequired: f.licenseTypeRequired } : {}),
          ...(f.licenseVerifiedDate ? { licenseVerifiedDate: f.licenseVerifiedDate } : {}),
          ...(f.restrictionNotes ? { restrictionNotes: f.restrictionNotes } : {}),
          ...(f.notes ? { notes: f.notes } : {}),
        };
        await apparatusOperatorService.createOperator(payload);
        toast.success('Operator added');
      }
      onSaved();
      onClose();
    } catch (err) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new record is not created until it is fixed.
      const mapped = mapServerFieldErrors(err, OPERATOR_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save operator'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={editOperator ? 'Edit Operator' : 'Add Operator'}
      size="md"
      onSubmit={(e) => void handleSubmit(e)}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : editOperator ? 'Save Changes' : 'Add Operator'}
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Member — only for new operators; an operator's member never changes */}
        {!editOperator && (
          <FormField label="Member" required error={errors.userId} id={IDS.userId}>
            {(field) => (
              <select {...field} className={inputClass} value={f.userId} onChange={(e) => up('userId', e.target.value)}>
                <option value="">Select a member...</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {displayNameOf(member)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        {/* EVOC Level */}
        {evocLevels.length > 0 && (
          <FormField label="EVOC Certification Level" error={errors.evocLevelId} id={IDS.evocLevelId}>
            {(field) => (
              <select
                {...field}
                className={inputClass}
                value={f.evocLevelId}
                onChange={(e) => up('evocLevelId', e.target.value)}
              >
                <option value="">No EVOC level</option>
                {evocLevels.map((level) => (
                  <option key={level.id} value={level.id}>
                    Level {level.levelNumber} — {level.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        {/* Certification */}
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={f.isCertified}
              onChange={(e) => up('isCertified', e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Certified to operate</span>
          </label>

          {f.isCertified && (
            <div className="grid grid-cols-1 gap-4 pl-6 sm:grid-cols-2">
              <FormField label="Certification Date" error={errors.certificationDate} id={IDS.certificationDate}>
                {(field) => (
                  <input
                    {...field}
                    className={inputClass}
                    type="date"
                    value={f.certificationDate}
                    onChange={(e) => up('certificationDate', e.target.value)}
                  />
                )}
              </FormField>
              <FormField
                label="Certification Expiration"
                error={errors.certificationExpiration}
                id={IDS.certificationExpiration}
              >
                {(field) => (
                  <input
                    {...field}
                    className={inputClass}
                    type="date"
                    value={f.certificationExpiration}
                    onChange={(e) => up('certificationExpiration', e.target.value)}
                  />
                )}
              </FormField>
            </div>
          )}
        </div>

        {/* License */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="License Type Required"
            error={errors.licenseTypeRequired}
            id={IDS.licenseTypeRequired}
            maxLength={OPERATOR_FIELDS.licenseTypeRequired.maxLength}
            count={f.licenseTypeRequired.length}
          >
            {(field) => (
              <input
                {...field}
                className={inputClass}
                type="text"
                placeholder="e.g. CDL Class B"
                value={f.licenseTypeRequired}
                onChange={(e) => up('licenseTypeRequired', e.target.value)}
              />
            )}
          </FormField>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 pt-6">
              <input
                type="checkbox"
                checked={f.licenseVerified}
                onChange={(e) => up('licenseVerified', e.target.checked)}
                className="form-checkbox"
              />
              <span className="text-theme-text-secondary text-sm">License verified</span>
            </label>
          </div>
        </div>

        {f.licenseVerified && (
          <div className="pl-6">
            <FormField label="License Verified Date" error={errors.licenseVerifiedDate} id={IDS.licenseVerifiedDate}>
              {(field) => (
                <input
                  {...field}
                  className={inputClass}
                  type="date"
                  value={f.licenseVerifiedDate}
                  onChange={(e) => up('licenseVerifiedDate', e.target.value)}
                />
              )}
            </FormField>
          </div>
        )}

        {/* Restrictions */}
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={f.hasRestrictions}
              onChange={(e) => up('hasRestrictions', e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Has operating restrictions</span>
          </label>

          {f.hasRestrictions && (
            <div className="pl-6">
              <FormField label="Restriction Notes" error={errors.restrictionNotes} id={IDS.restrictionNotes}>
                {(field) => (
                  <textarea
                    {...field}
                    className={inputClass}
                    rows={2}
                    placeholder="Describe restrictions..."
                    value={f.restrictionNotes}
                    onChange={(e) => up('restrictionNotes', e.target.value)}
                  />
                )}
              </FormField>
            </div>
          )}
        </div>

        {/* Active Status */}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={f.isActive}
            onChange={(e) => up('isActive', e.target.checked)}
            className="form-checkbox"
          />
          <span className="text-theme-text-secondary text-sm">Active operator</span>
        </label>

        {/* Notes */}
        <FormField label="Notes" error={errors.notes} id={IDS.notes}>
          {(field) => (
            <textarea
              {...field}
              className={inputClass}
              rows={2}
              value={f.notes}
              onChange={(e) => up('notes', e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};

export default OperatorModal;
