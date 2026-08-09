/**
 * Accessible Modal Component
 *
 * Features:
 * - Focus trapping (keeps focus within modal)
 * - Escape key to close
 * - Click outside to close
 * - Proper ARIA attributes
 * - Returns focus to trigger element on close
 */

import React, { useEffect, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnClickOutside?: boolean;
  closeOnEscape?: boolean;
  'aria-describedby'?: string;
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
  'aria-describedby': ariaDescribedBy,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  // Keep the ref current without triggering the effect
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const sizeClasses = {
    sm: 'max-w-[calc(100vw-2rem)] sm:max-w-md',
    md: 'max-w-[calc(100vw-2rem)] sm:max-w-lg',
    lg: 'max-w-[calc(100vw-2rem)] sm:max-w-2xl',
    xl: 'max-w-[calc(100vw-2rem)] sm:max-w-4xl',
  };

  useEffect(() => {
    if (!isOpen) return;

    // Store the currently focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first focusable child, or fall back to the modal container
    const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (firstFocusable) {
      firstFocusable.focus();
    } else {
      modalRef.current?.focus();
    }

    // Handle escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        onCloseRef.current();
      }
    };

    // Trap focus within modal
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleTab);

    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', handleTab);
      document.body.style.overflow = 'unset';

      // Return focus to previous element
      previousFocusRef.current?.focus();
    };
  }, [isOpen, closeOnEscape]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnClickOutside && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
      aria-describedby={ariaDescribedBy}
    >
      <div
        className="flex min-h-screen items-center justify-center px-4 py-4 text-center sm:block sm:p-0"
        data-testid="modal-backdrop"
        onClick={handleBackdropClick}
      >
        {/* Background overlay */}
        <div className="pointer-events-none fixed inset-0 bg-black/50 transition-opacity" aria-hidden="true" />

        {/* Center modal vertically */}
        <span className="hidden sm:inline-block sm:h-screen sm:align-middle" aria-hidden="true">
          &#8203;
        </span>

        {/* Modal panel */}
        <div
          ref={modalRef}
          className={`bg-theme-surface-modal relative z-10 inline-block transform overflow-hidden rounded-lg text-left align-bottom shadow-xl transition-all sm:my-8 sm:align-middle ${sizeClasses[size]} max-h-[calc(100dvh-2rem)] w-full overflow-y-auto sm:max-h-[calc(100dvh-4rem)]`}
          data-testid="modal-panel"
          tabIndex={-1}
        >
          {/* Header */}
          <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-theme-text-primary text-lg font-medium" id="modal-title">
                {title}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="bg-theme-surface text-theme-text-muted hover:text-theme-text-primary focus:ring-theme-focus-ring flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1 focus:ring-2 focus:ring-offset-2 focus:ring-offset-(--ring-offset-bg) focus:outline-hidden"
                aria-label="Close modal"
              >
                <X className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>

            {/* Content */}
            <div className="mt-2">{children}</div>
          </div>

          {/* Footer */}
          {footer && (
            <div
              data-testid="modal-footer"
              className="bg-theme-surface-secondary flex flex-col-reverse gap-2 px-4 py-3 sm:flex-row-reverse sm:gap-0 sm:px-6"
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
