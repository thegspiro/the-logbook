/**
 * IP Exception Request Form
 *
 * Allows users to request an IP exception for geo-blocked access.
 */

import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { IPExceptionUseCase, IP_EXCEPTION_USE_CASE_LABELS } from '../../../constants/enums';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import type { IPExceptionRequestCreate } from '../types';

interface IPExceptionRequestFormProps {
  /**
   * Resolves true when the request was accepted; the form clears only then.
   * Rejects with a 422 for the form to put on its fields.
   */
  onSubmit: (data: IPExceptionRequestCreate) => Promise<boolean>;
  isSaving: boolean;
}

type RequestField = 'ipAddress' | 'useCase' | 'requestedDurationDays' | 'reason' | 'description';

/**
 * IPExceptionRequestCreate in schemas/ip_security.py reads snake_case
 * (`ip_address`); the default lookup covers both spellings.
 */
const REQUEST_FIELDS: Record<RequestField, ServerFieldSpec> = {
  ipAddress: { label: 'IP address', maxLength: 45 },
  useCase: { label: 'Use case', maxLength: 100 },
  requestedDurationDays: { label: 'Duration' },
  reason: { label: 'Justification' },
  description: { label: 'Additional details' },
};

/** In the order they appear, so the first failing one takes focus. */
const REQUEST_FIELD_IDS: Record<RequestField, string> = {
  ipAddress: 'ip-address',
  useCase: 'use-case',
  requestedDurationDays: 'duration',
  reason: 'reason',
  description: 'description',
};

const inputClass = 'form-input';

export const IPExceptionRequestForm: React.FC<IPExceptionRequestFormProps> = ({ onSubmit, isSaving }) => {
  const [ipAddress, setIpAddress] = useState('');
  const [reason, setReason] = useState('');
  const [useCase, setUseCase] = useState('');
  const [durationDays, setDurationDays] = useState(7);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Partial<Record<RequestField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const clearError = (field: RequestField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  const showErrors = (next: Partial<Record<RequestField, string>>) => {
    setErrors(next);
    const first = (Object.keys(REQUEST_FIELD_IDS) as RequestField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(REQUEST_FIELD_IDS[first])?.focus(), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Said on the field rather than by a submit button that stayed disabled
    // with no reason given (forms review F-3). Nothing is filed until fixed.
    const missing: Partial<Record<RequestField, string>> = {};
    if (!ipAddress.trim()) missing.ipAddress = 'Enter the IP address to allow.';
    if (!useCase) missing.useCase = 'Choose what the exception is for.';
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 90) {
      missing.requestedDurationDays = 'Choose a whole number of days from 1 to 90.';
    }
    if (!reason.trim()) missing.reason = 'Say why you need the exception.';
    if (Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }
    setFormError(null);
    const trimmedDescription = description.trim();
    let accepted: boolean;
    try {
      accepted = await onSubmit({
        ipAddress: ipAddress.trim(),
        reason: reason.trim(),
        useCase: useCase.trim(),
        requestedDurationDays: durationDays,
        ...(trimmedDescription ? { description: trimmedDescription } : {}),
      });
    } catch (err: unknown) {
      // A refused field is shown on that field, in its own words (forms review F-2).
      const mapped = mapServerFieldErrors(err, REQUEST_FIELDS);
      if (mapped) {
        showErrors(mapped.fieldErrors);
        setFormError(mapped.unmatched.length ? mapped.unmatched.join(' ') : null);
      }
      return;
    }
    if (!accepted) return;
    setIpAddress('');
    setReason('');
    setUseCase('');
    setDurationDays(7);
    setDescription('');
    setErrors({});
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      noValidate
      className="space-y-4"
    >
      {formError && (
        <p role="alert" className="alert-danger text-theme-text-primary text-sm">
          {formError}
        </p>
      )}
      <FormField
        label="IP Address"
        required
        error={errors.ipAddress}
        id="ip-address"
        maxLength={REQUEST_FIELDS.ipAddress.maxLength}
        count={ipAddress.length}
      >
        {(field) => (
          <input
            {...field}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={ipAddress}
            onChange={(e) => {
              setIpAddress(e.target.value);
              clearError('ipAddress');
            }}
            placeholder="e.g. 203.0.113.50"
            className={inputClass}
          />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Use Case" required error={errors.useCase} id="use-case">
          {(field) => (
            <select
              {...field}
              value={useCase}
              onChange={(e) => {
                setUseCase(e.target.value);
                clearError('useCase');
              }}
              className={inputClass}
            >
              <option value="">Select a use case</option>
              {Object.values(IPExceptionUseCase).map((uc) => (
                <option key={uc} value={uc}>
                  {IP_EXCEPTION_USE_CASE_LABELS[uc] ?? uc}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField label="Duration (days, 1–90)" required error={errors.requestedDurationDays} id="duration">
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="numeric"
              value={durationDays}
              onChange={(e) => {
                setDurationDays(Number(e.target.value));
                clearError('requestedDurationDays');
              }}
              min={1}
              max={90}
              className={inputClass}
            />
          )}
        </FormField>
      </div>

      <FormField label="Justification" required error={errors.reason} id="reason">
        {(field) => (
          <textarea
            {...field}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              clearError('reason');
            }}
            placeholder="Why do you need this IP exception?"
            className={inputClass}
            rows={3}
          />
        )}
      </FormField>

      <FormField label="Additional Details (optional)" error={errors.description} id="description">
        {(field) => (
          <textarea
            {...field}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              clearError('description');
            }}
            placeholder="Anything else the reviewer should know"
            className={inputClass}
            rows={2}
          />
        )}
      </FormField>

      <button
        type="submit"
        disabled={isSaving}
        className="flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {isSaving ? 'Submitting...' : 'Submit Request'}
      </button>
    </form>
  );
};
