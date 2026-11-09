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

import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { exportMappingService } from '../services/api';
import { ExportMappingType } from '../types';
import type { ExportMapping, ExportMappingCreatePayload, ExportMappingUpdatePayload } from '../types';
import { firstErrorField, refusalsOnFields, updateExceptRefused, useDialogFieldErrors } from '../utils/fieldRefusals';

/** The width of every account column on `finance_export_mappings`. */
const MAX_ACCOUNT = 200;
const MAX_ACCOUNT_NUMBER = 50;

type MappingField = 'category' | 'account' | 'accountNumber' | 'offset' | 'mappingType';

/**
 * `ExportMappingCreate` / `ExportMappingUpdate` (schemas/finance.py). The
 * account number's 50 is its column's width; the schema sets no limit.
 */
const SERVER_FIELDS: Record<MappingField, ServerFieldSpec> = {
  category: { label: 'Budget category', maxLength: MAX_ACCOUNT, api: ['internal_category', 'internalCategory'] },
  account: { label: 'QuickBooks account', maxLength: MAX_ACCOUNT, api: ['qb_account_name', 'qbAccountName'] },
  accountNumber: {
    label: 'Account number',
    maxLength: MAX_ACCOUNT_NUMBER,
    api: ['qb_account_number', 'qbAccountNumber'],
  },
  offset: {
    label: 'Paid from account',
    maxLength: MAX_ACCOUNT,
    api: ['qb_offset_account_name', 'qbOffsetAccountName'],
  },
  mappingType: { label: 'Account type' },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as MappingField[];
const UPDATE_KEYS: Partial<Record<MappingField, readonly (keyof ExportMappingUpdatePayload)[]>> = {
  category: ['internalCategory'],
  account: ['qbAccountName'],
  accountNumber: ['qbAccountNumber'],
  offset: ['qbOffsetAccountName'],
  mappingType: ['mappingType'],
};
const FIELD_IDS: Record<MappingField, string> = {
  category: 'mapping-category',
  account: 'mapping-account',
  accountNumber: 'mapping-account-number',
  offset: 'mapping-offset',
  mappingType: 'mapping-type',
};

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
  const { errors, setErrors, clearError } = useDialogFieldErrors<MappingField>();
  const [saving, setSaving] = useState(false);
  // An edit that saved all but a refused field stays open on that field;
  // closing then still tells the page to reload.
  const partlySaved = useRef(false);
  const initial = useRef({ category, account, accountNumber, offset, mappingType });
  const isDirty =
    category !== initial.current.category ||
    account !== initial.current.account ||
    accountNumber !== initial.current.accountNumber ||
    offset !== initial.current.offset ||
    mappingType !== initial.current.mappingType;
  const close = () => {
    if (partlySaved.current) onSaved();
    onClose();
  };
  // Escape, the X and Cancel all ask before throwing away a changed mapping.
  const requestClose = useDiscardGuard({ isDirty, onClose: close });

  const flag = (next: Partial<Record<MappingField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  // A mapping saved against a name no category carries any more stays
  // selectable, so editing it does not silently move it to another category.
  const options = category && !categoryNames.includes(category) ? [category, ...categoryNames] : categoryNames;

  const validate = (): boolean => {
    const next: Partial<Record<MappingField, string>> = {};
    if (!category.trim()) next.category = 'Choose the budget category this mapping is for.';
    if (!account.trim()) next.account = 'Enter the QuickBooks account spending in this category posts to.';
    if (!offset.trim()) next.offset = 'Enter the QuickBooks account this category is paid from.';
    return flag(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (mapping) {
        // Every field the form owns goes on every save, blanks as null, so a
        // cleared account number is cleared (CLAUDE.md pitfall #1).
        // Owner rule (2026-11-05) for a single-save edit: a refused value is
        // not written, the rest saves, and the field stays flagged.
        const { refused } = await updateExceptRefused(
          (body: ExportMappingUpdatePayload) => exportMappingService.update(mapping.id, body),
          {
            internalCategory: category.trim(),
            qbAccountName: account.trim(),
            qbAccountNumber: blankToNull(accountNumber),
            qbOffsetAccountName: offset.trim(),
            mappingType,
          },
          SERVER_FIELDS,
          UPDATE_KEYS
        );
        const first = firstErrorField(refused, FIELD_ORDER);
        if (first) {
          partlySaved.current = true;
          flag(refused);
          toast.error(
            `Mapping saved, except ${SERVER_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
          );
          return;
        }
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
      // A new mapping is added only once nothing is refused.
      const mapped = mapping ? null : refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
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

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={isEdit ? 'Edit QuickBooks mapping' : 'Add QuickBooks mapping'}
      titleId="mapping-form-title"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save mapping' : 'Add mapping'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField id={FIELD_IDS.category} label="Budget category" error={errors.category}>
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                clearError('category');
              }}
            >
              <option value="">Choose a category</option>
              {options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.account}
          label="QuickBooks account"
          error={errors.account}
          hint="Exactly as named in your QuickBooks chart of accounts; a subaccount as Parent:Child. A category that names its own account uses that one instead."
          maxLength={MAX_ACCOUNT}
          count={account.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              placeholder="e.g. Vehicle Expense:Fuel"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                clearError('account');
              }}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.accountNumber}
          label="Account number"
          optional
          error={errors.accountNumber}
          maxLength={MAX_ACCOUNT_NUMBER}
          count={accountNumber.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              value={accountNumber}
              onChange={(e) => {
                setAccountNumber(e.target.value);
                clearError('accountNumber');
              }}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.offset}
          label="Paid from account"
          error={errors.offset}
          hint="The bank or credit card account payments in this category come out of. Each exported transaction is credited here, which balances the entry QuickBooks requires. Accounts Payable and Receivable can't be used: QuickBooks needs a vendor or customer on those lines."
          maxLength={MAX_ACCOUNT}
          count={offset.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              placeholder="e.g. Operating Checking"
              value={offset}
              onChange={(e) => {
                setOffset(e.target.value);
                clearError('offset');
              }}
            />
          )}
        </FormField>

        <FormField id={FIELD_IDS.mappingType} label="Account type" error={errors.mappingType}>
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={mappingType}
              onChange={(e) => {
                if (isMappingType(e.target.value)) setMappingType(e.target.value);
                clearError('mappingType');
              }}
            >
              {Object.values(ExportMappingType).map((value) => (
                <option key={value} value={value}>
                  {MAPPING_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
    </Modal>
  );
};
