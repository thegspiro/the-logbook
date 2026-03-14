/**
 * IP Exception Request Form
 *
 * Allows users to request an IP exception for geo-blocked access.
 */

import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { IPExceptionUseCase, IP_EXCEPTION_USE_CASE_LABELS } from '../../../constants/enums';
import type { IPExceptionRequestCreate } from '../types';

interface IPExceptionRequestFormProps {
  onSubmit: (data: IPExceptionRequestCreate) => Promise<void>;
  isSaving: boolean;
}

const inputClass = 'form-input';
const labelClass = 'form-label';

export const IPExceptionRequestForm: React.FC<IPExceptionRequestFormProps> = ({
  onSubmit,
  isSaving,
}) => {
  const [ipAddress, setIpAddress] = useState('');
  const [reason, setReason] = useState('');
  const [useCase, setUseCase] = useState('');
  const [durationDays, setDurationDays] = useState(7);
  const [description, setDescription] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDescription = description.trim();
    await onSubmit({
      ipAddress: ipAddress.trim(),
      reason: reason.trim(),
      useCase: useCase.trim(),
      requestedDurationDays: durationDays,
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
    });
    setIpAddress('');
    setReason('');
    setUseCase('');
    setDurationDays(7);
    setDescription('');
  };

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
      <div>
        <label htmlFor="ip-address" className={labelClass}>IP Address</label>
        <input
          id="ip-address"
          type="text"
          value={ipAddress}
          onChange={(e) => setIpAddress(e.target.value)}
          placeholder="e.g. 203.0.113.50"
          className={inputClass}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="use-case" className={labelClass}>Use Case</label>
          <select
            id="use-case"
            value={useCase}
            onChange={(e) => setUseCase(e.target.value)}
            className={inputClass}
            required
          >
            <option value="">Select use case...</option>
            {Object.values(IPExceptionUseCase).map((uc) => (
              <option key={uc} value={uc}>
                {IP_EXCEPTION_USE_CASE_LABELS[uc] ?? uc}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="duration" className={labelClass}>Duration (days)</label>
          <input
            id="duration"
            type="number"
            value={durationDays}
            onChange={(e) => setDurationDays(Number(e.target.value))}
            min={1}
            max={90}
            className={inputClass}
            required
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason" className={labelClass}>Justification</label>
        <textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why do you need this IP exception?"
          className={inputClass}
          rows={3}
          required
        />
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>Additional Details (optional)</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Any additional context..."
          className={inputClass}
          rows={2}
        />
      </div>

      <button
        type="submit"
        disabled={isSaving || !ipAddress.trim() || !reason.trim() || !useCase}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Send className="w-4 h-4" />
        {isSaving ? 'Submitting...' : 'Submit Request'}
      </button>
    </form>
  );
};
