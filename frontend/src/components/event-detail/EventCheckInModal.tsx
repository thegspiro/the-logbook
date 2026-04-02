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
  onFetchEligibleMembers: () => void;
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
  onFetchEligibleMembers,
  onClose,
  timezone,
}) => {
  const filteredMembers = eligibleMembers.filter(
    (member) =>
      memberSearch === '' ||
      `${member.first_name} ${member.last_name}`
        .toLowerCase()
        .includes(memberSearch.toLowerCase()) ||
      member.email.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkin-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full relative z-10">
          <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 id="checkin-modal-title" className="text-lg font-medium text-theme-text-primary">Check In Members</h3>
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

            <p className="text-sm text-theme-text-secondary mb-4">
              Check in members as they arrive at the event. Their attendance will be recorded with a timestamp.
            </p>

            <div className="mb-4">
              <button
                onClick={onBulkAddAllEligible}
                disabled={bulkAddLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {bulkAddLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Adding...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Add All Eligible as Going
                  </>
                )}
              </button>
            </div>

            <div className="mb-4">
              <label htmlFor="member-search" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Search Members
              </label>
              <input
                type="text"
                id="member-search"
                value={memberSearch}
                onChange={(e) => onMemberSearchChange(e.target.value)}
                aria-label="Search by name or email..." placeholder="Search by name or email..."
                className="block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
              />
            </div>

            <div className="max-h-96 overflow-y-auto border border-theme-surface-border rounded-md">
              {filteredMembers.map((member) => {
                const rsvp = rsvps.find((r) => r.user_id === member.id);
                const isCheckedIn = rsvp?.checked_in || false;

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 border-b border-theme-surface-border hover:bg-theme-surface-hover"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-theme-text-primary">
                        {member.first_name} {member.last_name}
                      </p>
                      <p className="text-xs text-theme-text-muted">{member.email}</p>
                      {rsvp && (
                        <div className="flex items-center mt-1 space-x-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getRSVPStatusColor(
                              rsvp.status
                            )}`}
                          >
                            {getRSVPStatusLabel(rsvp.status)}
                          </span>
                          {isCheckedIn && (
                            <span className="text-xs text-green-600">
                              ✓ Checked in at{' '}
                              {rsvp.checked_in_at &&
                                formatTime(rsvp.checked_in_at, timezone)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      {isCheckedIn ? (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400">
                          Checked In
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            void onCheckIn(member.id);
                            void onFetchEligibleMembers();
                          }}
                          className="btn-primary font-medium inline-flex items-center px-3 py-1.5 rounded-md text-sm"
                        >
                          Check In
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredMembers.length === 0 && (
                <div className="p-4 text-center text-theme-text-muted">
                  {memberSearch ? 'No members found matching your search.' : 'No members available for check-in.'}
                </div>
              )}
            </div>
          </div>

          <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={onClose}
              className="w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:ml-3 sm:w-auto sm:text-sm"
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
