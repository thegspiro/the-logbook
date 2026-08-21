import React from 'react';
import { Modal } from '../Modal';
import { StopCircle } from 'lucide-react';

interface EventEndConfirmModalProps {
  eventTitle: string;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const EventEndConfirmModal: React.FC<EventEndConfirmModalProps> = ({ eventTitle, submitting, onConfirm, onClose }) => {
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="End Event Early"
      titleId="end-event-modal-title"
      size="md"
      footer={
        <>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="inline-flex w-full justify-center rounded-md border border-transparent bg-red-600 px-4 py-2 text-base font-medium text-white shadow-xs hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-hidden disabled:opacity-50 sm:ml-3 sm:w-auto sm:text-sm"
          >
            {submitting ? 'Ending...' : 'End Event Now'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Go Back
          </button>
        </>
      }
    >
      <div className="sm:flex sm:items-start">
        <div className="mx-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10 dark:bg-red-500/20">
          <StopCircle className="h-6 w-6 text-red-600" />
        </div>
        <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
          <div className="mt-2">
            <p className="text-theme-text-muted text-sm">
              This will end &ldquo;{eventTitle}&rdquo; now and check out all currently checked-in members. Attendance
              durations will be calculated based on the current time.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default EventEndConfirmModal;
