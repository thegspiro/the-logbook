/**
 * Logout Confirmation Modal
 *
 * Confirms user wants to logout before proceeding.
 */

import React from 'react';
import { LogOut, X } from 'lucide-react';

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
}) => {
  // Handle escape key
  React.useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape);
    // Prevent background scrolling
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 transition-opacity"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        aria-describedby="logout-modal-description"
      >
        <div className="bg-theme-surface border border-theme-surface-border rounded-lg shadow-xl max-w-md w-full p-6 relative">
          {/* Close button */}
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 text-theme-text-muted hover:text-theme-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>

          {/* Icon */}
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-600/20 mb-4">
            <LogOut className="h-6 w-6 text-red-700 dark:text-red-500" aria-hidden="true" />
          </div>

          {/* Content */}
          <div className="text-center mb-6">
            <h3
              id="logout-modal-title"
              className="text-lg font-semibold text-theme-text-primary mb-2"
            >
              Confirm Logout
            </h3>
            <p
              id="logout-modal-description"
              className="text-sm text-theme-text-secondary"
            >
              Are you sure you want to log out? Any unsaved changes may be lost.
            </p>
          </div>

          {/* Actions */}
          <div className="flex space-x-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 border border-theme-surface-border rounded-md text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-md text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-[var(--ring-offset-bg)] transition-colors"
              autoFocus
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default LogoutConfirmModal;
