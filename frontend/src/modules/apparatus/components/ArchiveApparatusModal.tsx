/**
 * Archive Apparatus Modal
 *
 * Retires an apparatus from the fleet, recording how it left. The Archive
 * button on the detail header used to navigate to the apparatus module's *API*
 * archive path, which matches no route — so it fell through App.tsx's
 * catch-all and dropped the reader on the dashboard with the apparatus still
 * in service. Archiving is a POST carrying a disposal record, not a page, so
 * the fix is this form rather than a route.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { apparatusService } from '../services/api';
import type { ApparatusArchive } from '../types';

interface ArchiveApparatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onArchived: () => void;
  apparatusId: string;
  unitNumber: string;
}

interface FormData {
  disposalMethod: string;
  disposalReason: string;
  disposalDate: string;
  disposalNotes: string;
  soldDate: string;
  soldPrice: string;
  soldTo: string;
  soldToContact: string;
}

const EMPTY: FormData = {
  disposalMethod: 'sold',
  disposalReason: '',
  disposalDate: '',
  disposalNotes: '',
  soldDate: '',
  soldPrice: '',
  soldTo: '',
  soldToContact: '',
};

/** The four the API documents on `disposal_method`. */
const DISPOSAL_METHODS: { value: string; label: string }[] = [
  { value: 'sold', label: 'Sold' },
  { value: 'traded', label: 'Traded in' },
  { value: 'donated', label: 'Donated' },
  { value: 'scrapped', label: 'Scrapped' },
];

const inputClass = 'form-input px-3 focus:ring-red-500/50 focus:border-red-500';
const labelClass = 'form-label';

export const ArchiveApparatusModal: React.FC<ArchiveApparatusModalProps> = ({
  isOpen,
  onClose,
  onArchived,
  apparatusId,
  unitNumber,
}) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setF(EMPTY);
  }, [isOpen]);

  const up = (k: keyof FormData, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Sale details are only meaningful for a sale, and sending a buyer against a
  // scrapped truck would file a record nobody can explain later.
  const isSale = f.disposalMethod === 'sold';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.disposalMethod) {
      toast.error('Choose how the apparatus left the fleet');
      return;
    }

    setSaving(true);
    try {
      // `|| undefined` throughout: this is a create payload, so a blank box
      // must be omitted rather than sent as '' to a validator that rejects it.
      const payload: ApparatusArchive = {
        disposalMethod: f.disposalMethod,
        ...(f.disposalReason.trim() ? { disposalReason: f.disposalReason.trim() } : {}),
        ...(f.disposalDate ? { disposalDate: f.disposalDate } : {}),
        ...(f.disposalNotes.trim() ? { disposalNotes: f.disposalNotes.trim() } : {}),
        ...(isSale && f.soldDate ? { soldDate: f.soldDate } : {}),
        ...(isSale && f.soldPrice ? { soldPrice: Number(f.soldPrice) } : {}),
        ...(isSale && f.soldTo.trim() ? { soldTo: f.soldTo.trim() } : {}),
        ...(isSale && f.soldToContact.trim() ? { soldToContact: f.soldToContact.trim() } : {}),
      };

      await apparatusService.archiveApparatus(apparatusId, payload);
      toast.success(`${unitNumber} archived`);
      onArchived();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to archive this apparatus'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Archive ${unitNumber}`} size="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          Archiving retires {unitNumber} from the fleet. Its maintenance, fuel and equipment history is kept — it stops
          appearing in rosters and assignments.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="archive-disposal-method">
              Disposal Method *
            </label>
            <select
              id="archive-disposal-method"
              className={inputClass}
              value={f.disposalMethod}
              onChange={(e) => up('disposalMethod', e.target.value)}
              required
            >
              {DISPOSAL_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="archive-disposal-date">
              Disposal Date
            </label>
            <input
              id="archive-disposal-date"
              type="date"
              className={inputClass}
              value={f.disposalDate}
              onChange={(e) => up('disposalDate', e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="archive-disposal-reason">
            Reason
          </label>
          <input
            id="archive-disposal-reason"
            type="text"
            className={inputClass}
            value={f.disposalReason}
            onChange={(e) => up('disposalReason', e.target.value)}
            placeholder="Replaced by Engine 2"
          />
        </div>

        {isSale && (
          <div className="border-theme-surface-border space-y-4 rounded-lg border p-4">
            <h4 className="text-theme-text-primary text-sm font-semibold">Sale details</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="archive-sold-date">
                  Sold Date
                </label>
                <input
                  id="archive-sold-date"
                  type="date"
                  className={inputClass}
                  value={f.soldDate}
                  onChange={(e) => up('soldDate', e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="archive-sold-price">
                  Sale Price ($)
                </label>
                <input
                  id="archive-sold-price"
                  type="number"
                  step="0.01"
                  min="0"
                  className={inputClass}
                  value={f.soldPrice}
                  onChange={(e) => up('soldPrice', e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="archive-sold-to">
                  Buyer
                </label>
                <input
                  id="archive-sold-to"
                  type="text"
                  maxLength={200}
                  className={inputClass}
                  value={f.soldTo}
                  onChange={(e) => up('soldTo', e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="archive-sold-to-contact">
                  Buyer Contact
                </label>
                <input
                  id="archive-sold-to-contact"
                  type="text"
                  maxLength={200}
                  className={inputClass}
                  value={f.soldToContact}
                  onChange={(e) => up('soldToContact', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <div>
          <label className={labelClass} htmlFor="archive-disposal-notes">
            Notes
          </label>
          <textarea
            id="archive-disposal-notes"
            rows={3}
            className={inputClass}
            value={f.disposalNotes}
            onChange={(e) => up('disposalNotes', e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary rounded-lg px-4 py-2 text-sm"
          >
            Keep in service
          </button>
          <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-60">
            {saving ? 'Archiving…' : 'Archive apparatus'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ArchiveApparatusModal;
