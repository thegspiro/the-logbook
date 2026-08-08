import React from 'react';
import type { RSVP } from '../../types/event';
import { getRSVPStatusLabel, getRSVPStatusColor } from '../../utils/eventHelpers';
import { formatTime } from '../../utils/dateFormatting';

interface EligibleMember {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface EventCheckInModalProps {
  eligibleMembers: EligibleMember[];
  rsvps: RSVP[];
  memberSearch: string;
  onMemberSearchChange: (search: string) => void;
  bulkAddLoading: boolean;
  onBulkAddAllEligible: () => void;
  onCheckIn: (userId: string) => void;
  onClose: () => void;
  timezone: string;
}

const EventCheckInModal: React.FC<EventCheckInModalProps> = ({
  eligibleMembers,
  rsvps,
  memberSearch,
  onMemberSearchChange,
  bulkAddLoading,
  onBulkAddAllEligible,
  onCheckIn,
  onClose,
  timezone,
}) => {
  const filteredMembers = eligibleMembers.filter(
    (member) =>
      memberSearch === '' ||
      `${member.first_name} ${member.last_name}`.toLowerCase().includes(memberSearch.toLowerCase()) ||
      member.email.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkin-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="bg-theme-surface-modal relative z-10 inline-block transform overflow-hidden rounded-lg text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-3xl sm:align-middle">
          <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 id="checkin-modal-title" className="text-theme-text-primary text-lg font-medium">
                Check In Members
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="text-theme-text-muted hover:text-theme-text-primary"
                aria-label="Close dialog"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-theme-text-secondary mb-4 text-sm">
              Check in members as they arrive at the event. Their attendance will be recorded with a timestamp.
            </p>

            <div className="mb-4">
              <button
                onClick={onBulkAddAllEligible}
                disabled={bulkAddLoading}
                className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bulkAddLoading ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      ></path>
                    </svg>
                    Adding...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    Add All Eligible as Going
                  </>
                )}
              </button>
            </div>

            <div className="mb-4">
              <label htmlFor="member-search" className="text-theme-text-secondary mb-2 block text-sm font-medium">
                Search Members
              </label>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                type="text"
                id="member-search"
                value={memberSearch}
                onChange={(e) => onMemberSearchChange(e.target.value)}
                aria-label="Search by name or email..."
                placeholder="Search by name or email..."
                className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring block w-full rounded-md shadow-xs sm:text-sm"
              />
            </div>

            <div className="border-theme-surface-border max-h-96 overflow-y-auto rounded-md border">
              {filteredMembers.map((member) => {
                const rsvp = rsvps.find((r) => r.user_id === member.id);
                const isCheckedIn = rsvp?.checked_in || false;

                return (
                  <div
                    key={member.id}
                    className="border-theme-surface-border hover:bg-theme-surface-hover flex items-center justify-between border-b p-3"
                  >
                    <div className="flex-1">
                      <p className="text-theme-text-primary text-sm font-medium">
                        {member.first_name} {member.last_name}
                      </p>
                      <p className="text-theme-text-muted text-xs">{member.email}</p>
                      {rsvp && (
                        <div className="mt-1 flex items-center space-x-2">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${getRSVPStatusColor(
                              rsvp.status
                            )}`}
                          >
                            {getRSVPStatusLabel(rsvp.status)}
                          </span>
                          {isCheckedIn && (
                            <span className="text-xs text-green-600">
                              ✓ Checked in at {rsvp.checked_in_at && formatTime(rsvp.checked_in_at, timezone)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      {isCheckedIn ? (
                        <span className="inline-flex items-center rounded-md bg-green-100 px-3 py-1.5 text-sm font-medium text-green-800 dark:bg-green-500/20 dark:text-green-400">
                          Checked In
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            onCheckIn(member.id);
                          }}
                          className="btn-primary inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium"
                        >
                          Check In
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredMembers.length === 0 && (
                <div className="text-theme-text-muted p-4 text-center">
                  {memberSearch ? 'No members found matching your search.' : 'No members available for check-in.'}
                </div>
              )}
            </div>
          </div>

          <div className="bg-theme-surface-secondary px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring inline-flex w-full justify-center rounded-md border px-4 py-2 text-base font-medium shadow-xs focus:ring-2 focus:ring-offset-2 focus:outline-hidden sm:ml-3 sm:w-auto sm:text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventCheckInModal;
