/**
 * Payment Options
 *
 * The "how do I pay this" block on a member's order: one prominent action for
 * the method they chose at checkout, with every other configured method beside
 * it — each carrying the handle or address that *is* its instruction.
 *
 * Every accepted method is offered, not just the one picked at checkout. A
 * member reading this on their phone may not have the app they selected a week
 * ago, and from the department's side the money only has to arrive — by what
 * route is the member's business.
 *
 * The alternatives stay on screen rather than behind a tap. Methods with
 * nothing to open (Zelle, cash, check) have no button to press, so a control
 * that only reveals their handle would hide the entire instruction behind an
 * interaction that looks like it does something else.
 */

import React, { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { formatCurrency } from '../../../utils/dateFormatting';
import type { StorePaymentInstructions, StorePaymentOption } from '../types';
import { isSafeExternalUrl } from '../../../utils/safeUrl';

interface PaymentOptionsProps {
  instructions: StorePaymentInstructions;
  amount: number;
  /** Omitted once the member has already reported paying. */
  onReport?: (() => void) | undefined;
  /** Set false where the surrounding block already states the reference —
   *  saying "reference ORD-…" twice in one box reads as two instructions. */
  showReference?: boolean | undefined;
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
      className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-1 self-start font-mono text-xs underline decoration-dotted"
      aria-label={`Copy ${label} handle ${value}`}
    >
      {value}
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
};

/** Handle, reference and any free-text instruction for one method. */
const OptionDetail: React.FC<{
  option: StorePaymentOption;
  reference?: string | null | undefined;
}> = ({ option, reference }) => (
  <>
    {option.handle && <CopyHandle value={option.handle} label={option.label} />}
    {/* Only nag about the reference when the link will not carry it. */}
    {reference && !option.prefillsReference && (
      <p className="text-theme-text-secondary text-xs">
        Reference <strong className="font-mono">{reference}</strong>
      </p>
    )}
    {option.instructions && (
      <p className="text-theme-text-secondary text-xs whitespace-pre-line">{option.instructions}</p>
    )}
  </>
);

export const PaymentOptions: React.FC<PaymentOptionsProps> = ({
  instructions,
  amount,
  onReport,
  showReference = true,
}) => {
  const options = instructions.options ?? [];
  const reference = showReference ? instructions.reference : null;
  // The server puts the method chosen at checkout first; it leads here.
  const [lead, ...alternatives] = options;

  if (!lead) {
    return (
      <div className="flex flex-col gap-2">
        {/* No method is configured yet. The reference is still the one thing
            that lets a treasurer match a payment, so it stays on screen. */}
        <p className="text-theme-text-secondary text-xs">
          {reference ? (
            <>
              Reference <strong className="font-mono">{reference}</strong> when you send payment.
            </>
          ) : (
            'Contact the department for payment details.'
          )}
        </p>
        {instructions.instructions && (
          <p className="text-theme-text-secondary text-xs whitespace-pre-line">{instructions.instructions}</p>
        )}
        {onReport && (
          <button type="button" className="btn-secondary btn-sm self-start" onClick={onReport}>
            I&apos;ve sent payment
          </button>
        )}
      </div>
    );
  }

  const leadUrl = lead.paymentUrl && isSafeExternalUrl(lead.paymentUrl) ? lead.paymentUrl : null;

  return (
    <div className="flex flex-col gap-2">
      {leadUrl ? (
        <a
          href={leadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary flex min-h-[44px] items-center justify-center gap-2 text-sm font-bold"
        >
          Pay {formatCurrency(amount)} with <span>{lead.label}</span>
          <ExternalLink className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
        </a>
      ) : (
        <p className="text-theme-text-primary text-sm font-semibold">
          Pay {formatCurrency(amount)} with <span>{lead.label}</span>
        </p>
      )}

      <div className="flex flex-col gap-0.5">
        <OptionDetail option={lead} reference={reference} />
      </div>

      {alternatives.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {alternatives.map((option) => {
            const url = option.paymentUrl && isSafeExternalUrl(option.paymentUrl) ? option.paymentUrl : null;
            return (
              <li
                key={option.method}
                className="border-theme-surface-border bg-theme-surface flex min-w-[120px] flex-1 flex-col gap-1 rounded-lg border p-2.5"
              >
                <span className="text-theme-text-primary text-[13px] font-semibold">{option.label}</span>
                <OptionDetail option={option} reference={reference} />
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary btn-sm mt-0.5 justify-center whitespace-nowrap"
                  >
                    Pay with {option.label}
                    <ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {instructions.instructions && (
        <p className="text-theme-text-secondary text-xs whitespace-pre-line">{instructions.instructions}</p>
      )}

      {onReport && (
        <button type="button" className="btn-secondary btn-sm" onClick={onReport}>
          I&apos;ve sent payment
        </button>
      )}
    </div>
  );
};

export default PaymentOptions;
