/**
 * Payment Options
 *
 * The "how do I pay this" block on a member's order: one button per payment
 * app the department has actually configured.
 *
 * Every accepted method is offered, not just the one picked at checkout. A
 * member reading this on their phone may not have the app they selected a week
 * ago, and from the department's side the money only has to arrive — by what
 * route is the member's business.
 *
 * Methods with nothing to open (Zelle, cash, check) still appear, because the
 * handle or address is the whole instruction. Zelle in particular lives inside
 * each bank's own app and publishes no link, so a member is shown the handle
 * to type rather than a button that goes nowhere.
 */

import React, { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { formatCurrency } from '../../../utils/dateFormatting';
import type { StorePaymentInstructions, StorePaymentOption } from '../types';

interface PaymentOptionsProps {
  instructions: StorePaymentInstructions;
  amount: number;
  /** Omitted once the member has already reported paying. */
  onReport?: (() => void) | undefined;
}

const CopyHandle: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // Older and locked-down browsers have no clipboard API; the handle is
    // still on screen to read, so a failure here is not worth an error toast.
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 font-mono text-xs underline decoration-dotted"
      aria-label={`Copy ${label} handle ${value}`}
    >
      {value}
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
};

const OptionRow: React.FC<{
  option: StorePaymentOption;
  amount: number;
  reference?: string | null | undefined;
}> = ({ option, amount, reference }) => (
  <li className="border-theme-surface-border/60 flex flex-wrap items-center gap-2 border-t py-2 first:border-t-0">
    <div className="min-w-0 grow">
      <p className="text-theme-text-primary text-xs font-medium">{option.label}</p>
      {option.handle && (
        <p className="text-theme-text-muted text-xs">
          <CopyHandle value={option.handle} label={option.label} />
        </p>
      )}
      {/* Only nag about the reference when the link will not carry it. */}
      {reference && !option.prefillsReference && (
        <p className="text-theme-text-muted text-xs">
          Reference <strong>{reference}</strong>
        </p>
      )}
      {option.instructions && (
        <p className="text-theme-text-muted mt-0.5 text-xs whitespace-pre-line">{option.instructions}</p>
      )}
    </div>
    {option.paymentUrl && (
      <a href={option.paymentUrl} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm shrink-0">
        Pay {formatCurrency(amount)}
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    )}
  </li>
);

export const PaymentOptions: React.FC<PaymentOptionsProps> = ({ instructions, amount, onReport }) => {
  const options = instructions.options ?? [];

  return (
    <div className="mt-2">
      {options.length > 0 ? (
        <ul className="mb-2">
          {options.map((option) => (
            <OptionRow key={option.method} option={option} amount={amount} reference={instructions.reference} />
          ))}
        </ul>
      ) : (
        // No method is configured yet. The reference is still the one thing
        // that lets a treasurer match a payment, so it stays on screen.
        <p className="text-theme-text-muted text-xs">
          {instructions.reference ? (
            <>
              Reference <strong>{instructions.reference}</strong> when you send payment.
            </>
          ) : (
            'Contact the department for payment details.'
          )}
        </p>
      )}

      {instructions.instructions && (
        <p className="text-theme-text-muted mt-1 text-xs whitespace-pre-line">{instructions.instructions}</p>
      )}

      {onReport && (
        <button type="button" className="btn-secondary btn-sm mt-2" onClick={onReport}>
          I&apos;ve sent payment
        </button>
      )}
    </div>
  );
};

export default PaymentOptions;
