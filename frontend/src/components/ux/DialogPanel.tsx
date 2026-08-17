import React, { ReactNode } from 'react';
import { useDialog } from '../../hooks/useDialog';

interface DialogPanelProps {
  onClose: () => void;
  /** Layout classes for this dialog; `modal-panel` is applied for you. */
  className?: string;
  closeOnEscape?: boolean;
  children: ReactNode;
  /**
   * Kept in addition to the internal focus-trap ref, for dialogs that already
   * held one to drive click-outside or to focus a particular field on open.
   */
  ref?: React.Ref<HTMLDivElement>;
  id?: string;
  role?: string;
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
  children,
  ref: forwardedRef,
  ...rest
}) => {
  const dialogRef = useDialog<HTMLDivElement>({ onClose, closeOnEscape });

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
