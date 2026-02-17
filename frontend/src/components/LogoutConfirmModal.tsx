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
        <div className="bg-slate-900 border border-white/20 rounded-lg shadow-xl max-w-md w-full p-6 relative">
          {/* Close button */}
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>

          {/* Icon */}
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-600/20 mb-4">
            <LogOut className="h-6 w-6 text-red-500" aria-hidden="true" />
          </div>

          {/* Content */}
          <div className="text-center mb-6">
            <h3
              id="logout-modal-title"
              className="text-lg font-semibold text-white mb-2"
            >
              Confirm Logout
            </h3>
            <p
              id="logout-modal-description"
              className="text-sm text-slate-300"
            >
              Are you sure you want to log out? Any unsaved changes may be lost.
            </p>
          </div>

          {/* Actions */}
          <div className="flex space-x-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 border border-white/20 rounded-md text-sm font-medium text-slate-300 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-md text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-colors"
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
