/**
 * Operator Modal
 *
 * Modal form for adding and editing certified operators on an apparatus.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { apparatusOperatorService } from '../services/api';
import type {
  ApparatusOperator,
  ApparatusOperatorCreate,
  ApparatusOperatorUpdate,
} from '../types';

interface OperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  apparatusId: string;
  editOperator?: ApparatusOperator | null;
}

interface FormData {
  userId: string;
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

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

export const OperatorModal: React.FC<OperatorModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  apparatusId,
  editOperator,
}) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editOperator) {
      setF({
        userId: editOperator.userId,
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
      });
    } else {
      setF(EMPTY);
    }
  }, [editOperator, isOpen]);

  const up = (k: keyof FormData, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editOperator && !f.userId) {
      toast.error('Please enter a user ID');
      return;
    }

    setSaving(true);
    try {
      if (editOperator) {
        const payload: ApparatusOperatorUpdate = {
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
        await apparatusOperatorService.updateOperator(editOperator.id, payload);
        toast.success('Operator updated');
      } else {
        const payload: ApparatusOperatorCreate = {
          apparatusId,
          userId: f.userId,
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
      toast.error(getErrorMessage(err, 'Failed to save operator'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editOperator ? 'Edit Operator' : 'Add Operator'}
      size="md"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {/* User ID - only for new operators */}
        {!editOperator && (
          <div>
            <label className={labelClass}>User ID *</label>
            <input
              type="text"
              className={inputClass}
              value={f.userId}
              onChange={(e) => up('userId', e.target.value)}
              placeholder="Enter user ID"
              required
            />
          </div>
        )}

        {/* Certification */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={f.isCertified}
              onChange={(e) => up('isCertified', e.target.checked)}
              className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-theme-text-secondary">Certified to operate</span>
          </label>

          {f.isCertified && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6">
              <div>
                <label className={labelClass}>Certification Date</label>
                <input type="date" className={inputClass} value={f.certificationDate} onChange={(e) => up('certificationDate', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Certification Expiration</label>
                <input type="date" className={inputClass} value={f.certificationExpiration} onChange={(e) => up('certificationExpiration', e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* License */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>License Type Required</label>
            <input type="text" className={inputClass} value={f.licenseTypeRequired} onChange={(e) => up('licenseTypeRequired', e.target.value)} placeholder="e.g. CDL Class B" />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer pt-6">
              <input
                type="checkbox"
                checked={f.licenseVerified}
                onChange={(e) => up('licenseVerified', e.target.checked)}
                className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-theme-text-secondary">License verified</span>
            </label>
          </div>
        </div>

        {f.licenseVerified && (
          <div className="pl-6">
            <label className={labelClass}>License Verified Date</label>
            <input type="date" className={inputClass} value={f.licenseVerifiedDate} onChange={(e) => up('licenseVerifiedDate', e.target.value)} />
          </div>
        )}

        {/* Restrictions */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={f.hasRestrictions}
              onChange={(e) => up('hasRestrictions', e.target.checked)}
              className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-theme-text-secondary">Has operating restrictions</span>
          </label>

          {f.hasRestrictions && (
            <div className="pl-6">
              <label className={labelClass}>Restriction Notes</label>
              <textarea className={inputClass} rows={2} value={f.restrictionNotes} onChange={(e) => up('restrictionNotes', e.target.value)} placeholder="Describe restrictions..." />
            </div>
          )}
        </div>

        {/* Active Status */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={f.isActive}
            onChange={(e) => up('isActive', e.target.checked)}
            className="w-4 h-4 rounded border-theme-surface-border text-red-600 focus:ring-red-500"
          />
          <span className="text-sm text-theme-text-secondary">Active operator</span>
        </label>

        {/* Notes */}
        <div>
          <label className={labelClass}>Notes</label>
          <textarea className={inputClass} rows={2} value={f.notes} onChange={(e) => up('notes', e.target.value)} />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
          <button type="button" onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary px-6 py-2">
            {saving ? 'Saving...' : editOperator ? 'Update Operator' : 'Add Operator'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default OperatorModal;
