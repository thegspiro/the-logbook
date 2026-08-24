import React from 'react';
import { Check, Info } from 'lucide-react';
import type { Receipt } from './submitFormatting';

export const SubmissionReceipt: React.FC<{
  receipt: Receipt;
  onSubmitAnother: () => void;
  onDone: () => void;
}> = ({ receipt, onSubmitAnother, onDone }) => (
  <div className="card animate-scale-in mx-auto flex max-w-md flex-col gap-4 p-5">
    <div className="flex items-start gap-3.5">
      <span className="bg-theme-alert-success-bg text-theme-alert-success-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
        <Check className="h-6 w-6" />
      </span>
      <div>
        <h2 className="text-theme-text-primary text-xl font-semibold">Training Submitted</h2>
        <p className="text-theme-text-muted text-sm">
          {receipt.approved ? 'Recorded on your training record.' : 'Sent to the training officer for review.'}
        </p>
      </div>
    </div>

    <dl className="border-theme-surface-border divide-theme-surface-border divide-y rounded-lg border">
      {receipt.rows.map((row) => (
        <div key={row.key} className="flex items-baseline justify-between gap-4 px-3.5 py-2.5">
          <dt className="text-theme-text-muted text-xs font-bold tracking-[0.08em] uppercase">{row.key}</dt>
          <dd className="text-theme-text-primary text-right text-sm font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>

    <div className="alert-info flex items-start gap-2.5">
      <Info className="text-theme-alert-info-icon mt-0.5 h-4 w-4 shrink-0" />
      <p className="text-theme-alert-info-text text-sm">
        {receipt.approved
          ? 'These hours count toward your requirements now. An officer can still review the entry later.'
          : 'Most submissions are reviewed within a week. You can edit or delete it until an officer approves it. The hours count toward your requirements once approved.'}
      </p>
    </div>

    <div className="flex gap-3">
      <button type="button" onClick={onSubmitAnother} className="btn-primary flex-1 text-sm font-semibold">
        Submit Another
      </button>
      <button type="button" onClick={onDone} className="btn-secondary flex-1 text-sm">
        Back to Training
      </button>
    </div>
  </div>
);
