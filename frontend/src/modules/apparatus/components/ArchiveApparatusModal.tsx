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
import { FormField, type FieldControlProps } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
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

type ArchiveField = keyof FormData;

/**
 * How `ApparatusArchive`'s field names land on this dialog (forms review F-2).
 * The schema takes camelCase and snake_case both, so either spelling of a
 * refusal finds its field; only the buyer fields carry a `max_length`.
 * Ordered as on screen, so the first refusal takes focus.
 */
const ARCHIVE_FIELDS: Record<ArchiveField, ServerFieldSpec & { id: string }> = {
  disposalMethod: { label: 'Disposal method', id: 'archive-disposal-method' },
  disposalDate: { label: 'Disposal date', id: 'archive-disposal-date' },
  disposalReason: { label: 'Reason', id: 'archive-disposal-reason' },
  soldDate: { label: 'Sold date', id: 'archive-sold-date' },
  soldPrice: { label: 'Sale price', id: 'archive-sold-price' },
  soldTo: { label: 'Buyer', maxLength: 200, id: 'archive-sold-to' },
  soldToContact: { label: 'Buyer contact', maxLength: 200, id: 'archive-sold-to-contact' },
  disposalNotes: { label: 'Notes', id: 'archive-disposal-notes' },
};

const inputClass = 'form-input px-3 focus:ring-red-500/50 focus:border-red-500';

export const ArchiveApparatusModal: React.FC<ArchiveApparatusModalProps> = ({
  isOpen,
  onClose,
  onArchived,
  apparatusId,
  unitNumber,
}) => {
  const [f, setF] = useState<FormData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ArchiveField, string>>>({});
  // A disposal record half typed is lost on close, so Escape, the X and "Keep
  // in service" ask first (forms review F-6).
  const isDirty = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const requestClose = useDiscardGuard({ isDirty, onClose });

  useEffect(() => {
    if (isOpen) {
      setF(EMPTY);
      setErrors({});
    }
  }, [isOpen]);

  const up = (k: ArchiveField, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<ArchiveField, string>>) => {
    setErrors(next);
    const first = (Object.keys(ARCHIVE_FIELDS) as ArchiveField[]).find((k) => next[k]);
    if (first) window.setTimeout(() => document.getElementById(ARCHIVE_FIELDS[first].id)?.focus(), 0);
  };

  // Sale details are only meaningful for a sale, and sending a buyer against a
  // scrapped truck would file a record nobody can explain later.
  const isSale = f.disposalMethod === 'sold';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.disposalMethod) {
      showErrors({ disposalMethod: 'Choose how the apparatus left the fleet.' });
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
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); nothing is archived until it is fixed.
      const mapped = mapServerFieldErrors(err, ARCHIVE_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        showErrors(mapped.fieldErrors);
        toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then archive again.');
      } else {
        toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Failed to archive this apparatus'));
      }
    } finally {
      setSaving(false);
    }
  };

  /** One labelled control wired to its error and limit. */
  const field = (
    key: ArchiveField,
    label: string,
    render: (props: FieldControlProps) => React.ReactNode,
    required?: boolean
  ) => (
    <FormField
      label={label}
      required={required}
      id={ARCHIVE_FIELDS[key].id}
      error={errors[key]}
      maxLength={ARCHIVE_FIELDS[key].maxLength}
      count={ARCHIVE_FIELDS[key].maxLength ? f[key].length : undefined}
    >
      {(props) => render(props)}
    </FormField>
  );

  const textInput =
    (key: ArchiveField, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) =>
    (props: FieldControlProps) => (
      <input {...props} {...extra} className={inputClass} value={f[key]} onChange={(e) => up(key, e.target.value)} />
    );

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={`Archive ${unitNumber}`}
      size="md"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary text-sm disabled:opacity-60">
            {saving ? 'Archiving…' : 'Archive apparatus'}
          </button>
          <button
            type="button"
            onClick={requestClose}
            className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary rounded-lg px-4 py-2 text-sm"
          >
            Keep in service
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          Archiving retires {unitNumber} from the fleet. Its maintenance, fuel and equipment history is kept — it stops
          appearing in rosters and assignments.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field(
            'disposalMethod',
            'Disposal Method',
            (props) => (
              <select
                {...props}
                className={inputClass}
                value={f.disposalMethod}
                onChange={(e) => up('disposalMethod', e.target.value)}
              >
                {DISPOSAL_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            ),
            true
          )}
          {field('disposalDate', 'Disposal Date', textInput('disposalDate', { type: 'date' }))}
        </div>

        {field(
          'disposalReason',
          'Reason',
          textInput('disposalReason', { type: 'text', placeholder: 'Replaced by Engine 2' })
        )}

        {isSale && (
          <div className="border-theme-surface-border space-y-4 rounded-lg border p-4">
            <h4 className="text-theme-text-primary text-sm font-semibold">Sale details</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field('soldDate', 'Sold Date', textInput('soldDate', { type: 'date' }))}
              {field(
                'soldPrice',
                'Sale Price ($)',
                textInput('soldPrice', { type: 'number', inputMode: 'decimal', step: '0.01', min: '0' })
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field('soldTo', 'Buyer', textInput('soldTo', { type: 'text' }))}
              {field('soldToContact', 'Buyer Contact', textInput('soldToContact', { type: 'text' }))}
            </div>
          </div>
        )}

        {field('disposalNotes', 'Notes', (props) => (
          <textarea
            {...props}
            rows={3}
            className={inputClass}
            value={f.disposalNotes}
            onChange={(e) => up('disposalNotes', e.target.value)}
          />
        ))}
      </div>
    </Modal>
  );
};

export default ArchiveApparatusModal;
