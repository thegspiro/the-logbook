/**
 * Create or edit one QuickBooks export mapping.
 *
 * A mapping ties a budget category, by name, to the QuickBooks account its
 * spending posts to and the account it is paid from. The export writes every
 * transaction as a debit to the first and a credit to the second, and refuses
 * a category that is missing either — so the paid-from account is required
 * here even though the API accepts a mapping without one.
 *
 * The category is chosen from the department's categories rather than typed,
 * because the export matches it by name and a misspelling matches nothing.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { exportMappingService } from '../services/api';
import { ExportMappingType } from '../types';
import type { ExportMapping, ExportMappingCreatePayload } from '../types';

/** The width of every account column on `finance_export_mappings`. */
const MAX_ACCOUNT = 200;
const MAX_ACCOUNT_NUMBER = 50;

const MAPPING_TYPE_LABELS: Record<ExportMappingType, string> = {
  [ExportMappingType.EXPENSE]: 'Expense',
  [ExportMappingType.INCOME]: 'Income',
  [ExportMappingType.ASSET]: 'Asset',
};

const isMappingType = (value: string): value is ExportMappingType =>
  Object.values<string>(ExportMappingType).includes(value);

interface ExportMappingDialogProps {
  /** The mapping being edited; absent to create one. */
  mapping?: ExportMapping | undefined;
  /** The category a new mapping starts on, when opened from a category's row. */
  initialCategory?: string | undefined;
  /** The department's budget category names, offered as the mapping's category. */
  categoryNames: string[];
  onClose: () => void;
  /** Called after a save; the caller re-fetches what it shows. */
  onSaved: () => void;
}

export const ExportMappingDialog: React.FC<ExportMappingDialogProps> = ({
  mapping,
  initialCategory,
  categoryNames,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(mapping);
  const [category, setCategory] = useState(mapping?.internalCategory ?? initialCategory ?? '');
  const [account, setAccount] = useState(mapping?.qbAccountName ?? '');
  const [accountNumber, setAccountNumber] = useState(mapping?.qbAccountNumber ?? '');
  const [offset, setOffset] = useState(mapping?.qbOffsetAccountName ?? '');
  const [mappingType, setMappingType] = useState<ExportMappingType>(
    mapping && isMappingType(mapping.mappingType) ? mapping.mappingType : ExportMappingType.EXPENSE
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // A mapping saved against a name no category carries any more stays
  // selectable, so editing it does not silently move it to another category.
  const options = category && !categoryNames.includes(category) ? [category, ...categoryNames] : categoryNames;

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!category.trim()) next.category = 'Choose the budget category this mapping is for.';
    if (!account.trim()) next.account = 'Enter the QuickBooks account spending in this category posts to.';
    if (!offset.trim()) next.offset = 'Enter the QuickBooks account this category is paid from.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    setSaving(true);
    try {
      if (mapping) {
        // Every field the form owns goes on every save, blanks as null, so a
        // cleared account number is cleared (CLAUDE.md pitfall #1).
        await exportMappingService.update(mapping.id, {
          internalCategory: category.trim(),
          qbAccountName: account.trim(),
          qbAccountNumber: blankToNull(accountNumber),
          qbOffsetAccountName: offset.trim(),
          mappingType,
        });
        toast.success('Mapping saved');
      } else {
        const payload: ExportMappingCreatePayload = {
          internalCategory: category.trim(),
          qbAccountName: account.trim(),
          qbAccountNumber: accountNumber.trim() || undefined,
          qbOffsetAccountName: offset.trim(),
          mappingType,
        };
        await exportMappingService.create(payload);
        toast.success('Mapping added');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, isEdit ? 'Could not save the mapping' : 'Could not add the mapping'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    void save();
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`mapping-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  const describedBy = (field: string, hint?: string) =>
    [hint, errors[field] ? `mapping-${field}-error` : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit QuickBooks mapping' : 'Add QuickBooks mapping'}
      titleId="mapping-form-title"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save mapping' : 'Add mapping'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="mapping-category" className="form-label">
            Budget category
          </label>
          <select
            id="mapping-category"
            className="form-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-invalid={Boolean(errors.category)}
            aria-describedby={describedBy('category')}
          >
            <option value="">Choose a category</option>
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {errorText('category')}
        </div>

        <div>
          <label htmlFor="mapping-account" className="form-label">
            QuickBooks account
          </label>
          <input
            id="mapping-account"
            type="text"
            className="form-input"
            maxLength={MAX_ACCOUNT}
            placeholder="e.g. Vehicle Expense:Fuel"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            aria-invalid={Boolean(errors.account)}
            aria-describedby={describedBy('account', 'mapping-account-hint')}
          />
          <p id="mapping-account-hint" className="text-theme-text-secondary mt-1 text-xs">
            Exactly as named in your QuickBooks chart of accounts; a subaccount as Parent:Child. A category that names
            its own account uses that one instead.
          </p>
          {errorText('account')}
        </div>

        <div>
          <label htmlFor="mapping-account-number" className="form-label">
            Account number (optional)
          </label>
          <input
            id="mapping-account-number"
            type="text"
            className="form-input"
            maxLength={MAX_ACCOUNT_NUMBER}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="mapping-offset" className="form-label">
            Paid from account
          </label>
          <input
            id="mapping-offset"
            type="text"
            className="form-input"
            maxLength={MAX_ACCOUNT}
            placeholder="e.g. Operating Checking"
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            aria-invalid={Boolean(errors.offset)}
            aria-describedby={describedBy('offset', 'mapping-offset-hint')}
          />
          <p id="mapping-offset-hint" className="text-theme-text-secondary mt-1 text-xs">
            The bank or credit card account payments in this category come out of. Each exported transaction is credited
            here, which balances the entry QuickBooks requires. Accounts Payable and Receivable can&apos;t be used:
            QuickBooks needs a vendor or customer on those lines.
          </p>
          {errorText('offset')}
        </div>

        <div>
          <label htmlFor="mapping-type" className="form-label">
            Account type
          </label>
          <select
            id="mapping-type"
            className="form-input"
            value={mappingType}
            onChange={(e) => {
              if (isMappingType(e.target.value)) setMappingType(e.target.value);
            }}
          >
            {Object.values(ExportMappingType).map((value) => (
              <option key={value} value={value}>
                {MAPPING_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
};
