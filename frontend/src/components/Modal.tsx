/**
 * Accessible, mobile-safe dialog shell.
 *
 * The header and optional action bar remain pinned while `.modal-body` scrolls.
 * `onSubmit` makes the panel a form so controls in the body and actions in the
 * footer retain native form validation without introducing a second scroller.
 */
import React, { FormEventHandler, ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '../hooks/useDialog';
import { DialogPortal } from './DialogPortal';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnClickOutside?: boolean;
  closeOnEscape?: boolean;
  /** Stable IDs are supported for dialogs whose accessible relationships are tested or externally referenced. */
  titleId?: string;
  'aria-describedby'?: string;
  /** When supplied, the modal panel is rendered as the form element. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  showCloseButton?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnClickOutside = true,
  closeOnEscape = true,
  titleId = 'modal-title',
  'aria-describedby': ariaDescribedBy,
  onSubmit,
  showCloseButton = true,
}) => {
  const modalRef = useDialog<HTMLElement>({ isOpen, onClose, closeOnEscape });
  const sizeClasses = {
    sm: 'sm:max-w-md',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
    xl: 'sm:max-w-4xl',
  };

  if (!isOpen) return null;

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnClickOutside && event.target === event.currentTarget) onClose();
  };

  const content = (
    <>
      <header className="modal-header-sticky flex items-start justify-between gap-4 px-4 py-4 sm:px-6">
        <h3 className="text-theme-text-primary min-w-0 text-lg font-medium" id={titleId}>
          {title}
        </h3>
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="bg-theme-surface text-theme-text-muted hover:text-theme-text-primary focus:ring-theme-focus-ring flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md focus:ring-2 focus:outline-hidden"
            aria-label="Close modal"
          >
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="modal-content min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" data-testid="modal-content">
        {children}
      </div>
      {footer && (
        <div
          data-testid="modal-footer"
          className="modal-footer modal-footer-sticky flex shrink-0 flex-col-reverse gap-2 px-4 sm:flex-row-reverse sm:gap-3 sm:px-6"
        >
          {footer}
        </div>
      )}
    </>
  );

  const panelClasses = `modal-panel modal-body relative z-10 flex w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden text-left ${sizeClasses[size]}`;

  return (
    <DialogPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        aria-labelledby={titleId}
        role="dialog"
        aria-modal="true"
        aria-describedby={ariaDescribedBy}
        data-testid="modal-backdrop"
        onClick={handleBackdropClick}
      >
        <div className="modal-overlay pointer-events-none" aria-hidden="true" />
        {onSubmit ? (
          <form
            ref={modalRef as React.Ref<HTMLFormElement>}
            className={panelClasses}
            onSubmit={onSubmit}
            data-testid="modal-panel"
          >
            {content}
          </form>
        ) : (
          <div
            ref={modalRef as React.Ref<HTMLDivElement>}
            className={panelClasses}
            tabIndex={-1}
            data-testid="modal-panel"
          >
            {content}
          </div>
        )}
      </div>
    </DialogPortal>
  );
};
