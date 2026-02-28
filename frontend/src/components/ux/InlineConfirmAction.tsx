/**
 * InlineConfirmAction
 *
 * A two-step inline confirmation pattern used throughout the scheduling module.
 * Shows a trigger button initially; when clicked, replaces it with a
 * "Label? [Yes] [No]" prompt. Useful for decline/remove/cancel actions where
 * a full modal dialog is overkill.
 */

import React, { useState } from "react";
import { Loader2 } from "lucide-react";

interface InlineConfirmActionProps {
  /** The label shown in the confirmation prompt (e.g., "Decline?", "Remove?") */
  confirmLabel: string;
  /** Callback when the user confirms the action */
  onConfirm: () => void | Promise<void>;
  /** Optional callback when the user cancels the confirmation */
  onCancel?: () => void;
  /** Whether the action is currently in progress */
  loading?: boolean;
  /** Render the initial trigger button. Receives an onClick handler. */
  trigger: (onClick: () => void) => React.ReactNode;
  /** Whether the confirm prompt is controlled externally */
  isOpen?: boolean;
  /** External open state setter (for controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** Color theme for the confirm prompt. Defaults to "red". */
  variant?: "red" | "amber";
}

export const InlineConfirmAction: React.FC<InlineConfirmActionProps> = ({
  confirmLabel,
  onConfirm,
  onCancel,
  loading = false,
  trigger,
  isOpen: controlledOpen,
  onOpenChange,
  variant = "red",
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const setOpen = (open: boolean) => {
    if (isControlled) {
      onOpenChange?.(open);
    } else {
      setInternalOpen(open);
    }
  };

  if (!isOpen) {
    return <>{trigger(() => setOpen(true))}</>;
  }

  const textColor = variant === "amber" ? "text-amber-500" : "text-red-500";
  const btnBg =
    variant === "amber"
      ? "bg-amber-600 hover:bg-amber-700"
      : "bg-red-600 hover:bg-red-700";

  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs ${textColor}`}>{confirmLabel}</span>
      <button
        onClick={() => {
          const result = onConfirm();
          if (result instanceof Promise) {
            void result;
          }
        }}
        disabled={loading}
        className={`px-2 py-1 text-xs ${btnBg} text-white rounded-md disabled:opacity-50`}
        aria-label={`Confirm: ${confirmLabel}`}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
      </button>
      <button
        onClick={() => {
          setOpen(false);
          onCancel?.();
        }}
        className="px-2 py-1 text-xs text-theme-text-muted hover:text-theme-text-primary"
        aria-label={`Cancel: ${confirmLabel}`}
      >
        No
      </button>
    </div>
  );
};

export default InlineConfirmAction;
