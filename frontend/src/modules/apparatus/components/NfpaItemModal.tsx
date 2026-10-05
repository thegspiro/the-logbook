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

export const NfpaItemModal: React.FC<NfpaItemModalProps> = ({ isOpen, onClose, onSaved, apparatusId, editItem }) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editItem) {
      setF({
        standardCode: editItem.standardCode,
        sectionReference: editItem.sectionReference,
        requirementDescription: editItem.requirementDescription,
        complianceStatus: editItem.complianceStatus,
        lastCheckedDate: editItem.lastCheckedDate?.split('T')[0] ?? '',
        nextDueDate: editItem.nextDueDate?.split('T')[0] ?? '',
        notes: editItem.notes ?? '',
        exemptionReason: editItem.exemptionReason ?? '',
      });
    } else {
      setF(EMPTY);
    }
  }, [editItem, isOpen]);

  const up = <K extends keyof FormData>(k: K, v: FormData[K]) => setF((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        await apparatusNfpaService.updateItem(editItem.id, payload);
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
      toast.error(getErrorMessage(err, 'Failed to save the compliance item'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editItem ? 'Edit Compliance Item' : 'Add Compliance Item'}
      size="md"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="form-label" htmlFor="nfpa-standard">
              Standard *
            </label>
            <input
              id="nfpa-standard"
              type="text"
              className="form-input"
              value={f.standardCode}
              onChange={(e) => up('standardCode', e.target.value)}
              placeholder="e.g. NFPA 1911"
              maxLength={50}
              required
            />
          </div>
          <div>
            <label className="form-label" htmlFor="nfpa-section">
              Section *
            </label>
            <input
              id="nfpa-section"
              type="text"
              className="form-input"
              value={f.sectionReference}
              onChange={(e) => up('sectionReference', e.target.value)}
              placeholder="e.g. Chapter 6"
              maxLength={100}
              required
            />
          </div>
        </div>

        <div>
          <label className="form-label" htmlFor="nfpa-requirement">
            Requirement *
          </label>
          <textarea
            id="nfpa-requirement"
            className="form-input"
            rows={2}
            value={f.requirementDescription}
            onChange={(e) => up('requirementDescription', e.target.value)}
            placeholder="e.g. Annual inspection of the chassis and body"
            required
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="form-label" htmlFor="nfpa-status">
              Status
            </label>
            <select
              id="nfpa-status"
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
          </div>
          <div>
            <label className="form-label" htmlFor="nfpa-last-checked">
              Last checked
            </label>
            <input
              id="nfpa-last-checked"
              type="date"
              className="form-input"
              value={f.lastCheckedDate}
              onChange={(e) => up('lastCheckedDate', e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="nfpa-next-due">
              Next due
            </label>
            <input
              id="nfpa-next-due"
              type="date"
              className="form-input"
              value={f.nextDueDate}
              onChange={(e) => up('nextDueDate', e.target.value)}
            />
          </div>
        </div>

        {f.complianceStatus === NfpaComplianceStatus.EXEMPT && (
          <div>
            <label className="form-label" htmlFor="nfpa-exemption">
              Why exempt
            </label>
            <textarea
              id="nfpa-exemption"
              className="form-input"
              rows={2}
              value={f.exemptionReason}
              onChange={(e) => up('exemptionReason', e.target.value)}
            />
          </div>
        )}

        <div>
          <label className="form-label" htmlFor="nfpa-notes">
            Notes
          </label>
          <textarea
            id="nfpa-notes"
            className="form-input"
            rows={2}
            value={f.notes}
            onChange={(e) => up('notes', e.target.value)}
          />
        </div>

        <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
          <button
            type="button"
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : editItem ? 'Save Changes' : 'Add Item'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default NfpaItemModal;
