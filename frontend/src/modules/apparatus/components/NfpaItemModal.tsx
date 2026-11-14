/**
 * NFPA Compliance Item Modal
 *
 * Adds or edits one record on an apparatus's NFPA compliance list: the
 * standard and section it answers to, where it stands, and when it was last
 * checked and is next due.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField, type FieldControlProps } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { apparatusNfpaService } from '../services/api';
import { NfpaComplianceStatus } from '../types';
import type { ApparatusNfpaCompliance, ApparatusNfpaComplianceUpdate } from '../types';

interface NfpaItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  apparatusId: string;
  editItem?: ApparatusNfpaCompliance | null;
}

interface FormData {
  standardCode: string;
  sectionReference: string;
  requirementDescription: string;
  complianceStatus: NfpaComplianceStatus;
  lastCheckedDate: string;
  nextDueDate: string;
  notes: string;
  exemptionReason: string;
}

const EMPTY: FormData = {
  standardCode: 'NFPA 1911',
  sectionReference: '',
  requirementDescription: '',
  complianceStatus: NfpaComplianceStatus.PENDING,
  lastCheckedDate: '',
  nextDueDate: '',
  notes: '',
  exemptionReason: '',
};

const STATUS_OPTIONS: { value: NfpaComplianceStatus; label: string }[] = [
  { value: NfpaComplianceStatus.PENDING, label: 'Pending' },
  { value: NfpaComplianceStatus.COMPLIANT, label: 'Compliant' },
  { value: NfpaComplianceStatus.NON_COMPLIANT, label: 'Not compliant' },
  { value: NfpaComplianceStatus.EXEMPT, label: 'Exempt' },
];

type NfpaField = keyof FormData;

/**
 * How the compliance endpoints' field names land on this dialog (forms review
 * F-2); `max_length`s from `ApparatusNFPAComplianceBase`. The schema takes
 * camelCase and snake_case both. Ordered as on screen, so the first refusal
 * takes focus.
 */
const NFPA_FIELDS: Record<NfpaField, ServerFieldSpec & { id: string }> = {
  standardCode: { label: 'Standard', maxLength: 50, id: 'nfpa-standard' },
  sectionReference: { label: 'Section', maxLength: 100, id: 'nfpa-section' },
  requirementDescription: { label: 'Requirement', id: 'nfpa-requirement' },
  complianceStatus: { label: 'Status', id: 'nfpa-status' },
  lastCheckedDate: { label: 'Last checked', id: 'nfpa-last-checked' },
  nextDueDate: { label: 'Next due', id: 'nfpa-next-due' },
  exemptionReason: { label: 'Why exempt', id: 'nfpa-exemption' },
  notes: { label: 'Notes', id: 'nfpa-notes' },
};

export const NfpaItemModal: React.FC<NfpaItemModalProps> = ({ isOpen, onClose, onSaved, apparatusId, editItem }) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<NfpaField, string>>>({});
  // What the form held when it opened (or last saved), so Escape, the X and
  // Cancel ask before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const isDirty = baseline !== '' && JSON.stringify(f) !== baseline;
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    if (!isOpen) return;
    const seeded: FormData = editItem
      ? {
          standardCode: editItem.standardCode,
          sectionReference: editItem.sectionReference,
          requirementDescription: editItem.requirementDescription,
          complianceStatus: editItem.complianceStatus,
          lastCheckedDate: editItem.lastCheckedDate?.split('T')[0] ?? '',
          nextDueDate: editItem.nextDueDate?.split('T')[0] ?? '',
          notes: editItem.notes ?? '',
          exemptionReason: editItem.exemptionReason ?? '',
        }
      : EMPTY;
    setF(seeded);
    setBaseline(JSON.stringify(seeded));
    setErrors({});
  }, [editItem, isOpen]);

  const up = <K extends keyof FormData>(k: K, v: FormData[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<NfpaField, string>>) => {
    setErrors(next);
    const first = (Object.keys(NFPA_FIELDS) as NfpaField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(NFPA_FIELDS[first].id)?.focus(), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<NfpaField, string>> = {};
    if (!f.standardCode.trim()) missing.standardCode = 'Enter the standard, such as NFPA 1911.';
    if (!f.sectionReference.trim()) missing.sectionReference = 'Enter the section it answers to.';
    if (!f.requirementDescription.trim()) missing.requirementDescription = 'Describe the requirement.';
    // A new item is not added until every field is fixed; an edit saves the
    // rest and keeps the stored value of a refused one (below).
    if (!editItem && Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }
    setSaving(true);
    try {
      if (editItem) {
        // Every field the form owns, with an explicit null for a cleared one,
        // so emptying a date actually clears it (CLAUDE.md pitfall 1).
        const payload: ApparatusNfpaComplianceUpdate = {
          standardCode: f.standardCode.trim(),
          sectionReference: f.sectionReference.trim(),
          requirementDescription: f.requirementDescription.trim(),
          complianceStatus: f.complianceStatus,
          lastCheckedDate: blankToNull(f.lastCheckedDate),
          nextDueDate: blankToNull(f.nextDueDate),
          notes: blankToNull(f.notes),
          exemptionReason: blankToNull(f.exemptionReason),
        };
        // Single-save rule (owner, 2026-11-05): a refused value's key is left
        // out, which the backend reads as "leave alone", so its stored value
        // is kept while the rest saves, and the field stays flagged.
        let refused: Partial<Record<NfpaField, string>> = missing;
        const send = (skip: Partial<Record<NfpaField, string>>) => {
          const rest: Record<string, unknown> = { ...payload };
          for (const key of Object.keys(skip)) delete rest[key];
          return apparatusNfpaService.updateItem(editItem.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = mapServerFieldErrors(err, NFPA_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          // The list refreshes behind the dialog, which stays open; only the
          // flagged fields still count as unsaved.
          onSaved();
          showErrors(refused);
          const stored = JSON.parse(baseline) as FormData;
          const keys = Object.keys(refused) as NfpaField[];
          setBaseline(JSON.stringify({ ...f, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) }));
          const first = (Object.keys(NFPA_FIELDS) as NfpaField[]).find((k) => refused[k]);
          if (first) {
            toast.error(
              `Item saved, except ${NFPA_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
            );
          }
          return;
        }
        toast.success('Compliance item updated');
      } else {
        await apparatusNfpaService.createItem({
          apparatusId,
          standardCode: f.standardCode.trim(),
          sectionReference: f.sectionReference.trim(),
          requirementDescription: f.requirementDescription.trim(),
          complianceStatus: f.complianceStatus,
          lastCheckedDate: f.lastCheckedDate || undefined,
          nextDueDate: f.nextDueDate || undefined,
          notes: f.notes.trim() || undefined,
          exemptionReason: f.exemptionReason.trim() || undefined,
        });
        toast.success('Compliance item added');
      }
      onSaved();
      onClose();
    } catch (err) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new item is not added until it is fixed.
      const mapped = mapServerFieldErrors(err, NFPA_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to save the compliance item'));
      }
    } finally {
      setSaving(false);
    }
  };

  /** One labelled control wired to its error and limit. */
  const field = (
    key: NfpaField,
    label: string,
    render: (props: FieldControlProps) => React.ReactNode,
    required?: boolean
  ) => (
    <FormField
      label={label}
      required={required}
      id={NFPA_FIELDS[key].id}
      error={errors[key]}
      maxLength={NFPA_FIELDS[key].maxLength}
      count={NFPA_FIELDS[key].maxLength ? f[key].length : undefined}
    >
      {render}
    </FormField>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={editItem ? 'Edit Compliance Item' : 'Add Compliance Item'}
      size="md"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : editItem ? 'Save Changes' : 'Add Item'}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field(
            'standardCode',
            'Standard',
            (props) => (
              <input
                {...props}
                type="text"
                className="form-input"
                value={f.standardCode}
                onChange={(e) => up('standardCode', e.target.value)}
                placeholder="e.g. NFPA 1911"
              />
            ),
            true
          )}
          {field(
            'sectionReference',
            'Section',
            (props) => (
              <input
                {...props}
                type="text"
                className="form-input"
                value={f.sectionReference}
                onChange={(e) => up('sectionReference', e.target.value)}
                placeholder="e.g. Chapter 6"
              />
            ),
            true
          )}
        </div>

        {field(
          'requirementDescription',
          'Requirement',
          (props) => (
            <textarea
              {...props}
              className="form-input"
              rows={2}
              value={f.requirementDescription}
              onChange={(e) => up('requirementDescription', e.target.value)}
              placeholder="e.g. Annual inspection of the chassis and body"
            />
          ),
          true
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {field('complianceStatus', 'Status', (props) => (
            <select
              {...props}
              className="form-input"
              value={f.complianceStatus}
              onChange={(e) => up('complianceStatus', e.target.value as NfpaComplianceStatus)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ))}
          {field('lastCheckedDate', 'Last checked', (props) => (
            <input
              {...props}
              type="date"
              className="form-input"
              value={f.lastCheckedDate}
              onChange={(e) => up('lastCheckedDate', e.target.value)}
            />
          ))}
          {field('nextDueDate', 'Next due', (props) => (
            <input
              {...props}
              type="date"
              className="form-input"
              value={f.nextDueDate}
              onChange={(e) => up('nextDueDate', e.target.value)}
            />
          ))}
        </div>

        {f.complianceStatus === NfpaComplianceStatus.EXEMPT &&
          field('exemptionReason', 'Why exempt', (props) => (
            <textarea
              {...props}
              className="form-input"
              rows={2}
              value={f.exemptionReason}
              onChange={(e) => up('exemptionReason', e.target.value)}
            />
          ))}

        {field('notes', 'Notes', (props) => (
          <textarea
            {...props}
            className="form-input"
            rows={2}
            value={f.notes}
            onChange={(e) => up('notes', e.target.value)}
          />
        ))}
      </div>
    </Modal>
  );
};

export default NfpaItemModal;
