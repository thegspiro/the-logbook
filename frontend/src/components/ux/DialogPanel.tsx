import React, { ReactNode } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useDiscardGuard } from '../../hooks/useDiscardGuard';

interface DialogPanelProps {
  onClose: () => void;
  /** Layout classes for this dialog; `modal-panel` is applied for you. */
  className?: string;
  closeOnEscape?: boolean;
  /**
   * Whether the dialog's form holds unsaved changes. When it does, Escape asks
   * "Keep editing" / "Discard changes" before closing (forms review F-6). The
   * panel's own buttons are the caller's: wire them through useDiscardGuard
   * instead, and then leave this unset so the question is not asked twice.
   */
  isDirty?: boolean | undefined;
  children: ReactNode;
  /**
   * Kept in addition to the internal focus-trap ref, for dialogs that already
   * held one to drive click-outside or to focus a particular field on open.
   */
  ref?: React.Ref<HTMLDivElement>;
  id?: string;
  role?: string;
  'aria-modal'?: boolean | 'true' | 'false';
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/**
 * The surface of a hand-rolled dialog, carrying the shared focus trap, Escape
 * handling and body scroll lock.
 *
 * Prefer components/Modal.tsx for new dialogs — it also supplies the header,
 * close button and footer. This exists for the dialogs whose layout predates
 * Modal and does not fit its fixed header/footer structure: swapping the panel
 * `<div>` for this element gives them the behaviour without restyling them.
 *
 * Being a component rather than a bare hook is the point. Many of these dialogs
 * live inside large page components behind an early return, where a hook call
 * would be conditional; here the hook runs unconditionally inside the panel,
 * and mounting the panel is what "open" means.
 */
export const DialogPanel: React.FC<DialogPanelProps> = ({
  onClose,
  className = '',
  closeOnEscape = true,
  isDirty,
  children,
  ref: forwardedRef,
  ...rest
}) => {
  const requestClose = useDiscardGuard({ isDirty, onClose });
  const dialogRef = useDialog<HTMLDivElement>({ onClose: requestClose, closeOnEscape });

  const setRefs = (node: HTMLDivElement | null) => {
    dialogRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  return (
    <div ref={setRefs} className={`modal-panel ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
};

export default DialogPanel;
