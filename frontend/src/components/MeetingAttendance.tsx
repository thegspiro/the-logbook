/**
 * Meeting Attendance Tracker Component
 *
 * Allows the secretary to check in members as present at a meeting.
 * Attendance is used by ballot items that require presence to vote.
 */

import React, { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { electionService, userService } from '../services/api';
import type { Election, Attendee } from '../types/election';
import type { User } from '../types/user';
import { getErrorMessage } from '../utils/errorHandling';
import { formatTime } from '../utils/dateFormatting';
import { UserStatus, ElectionStatus } from '../constants/enums';
import { useTimezone } from '../hooks/useTimezone';

interface MeetingAttendanceProps {
  electionId: string;
  election: Election;
  onUpdate: (updatedElection: Election) => void;
}

export const MeetingAttendance: React.FC<MeetingAttendanceProps> = ({ electionId, election, onUpdate }) => {
  const tz = useTimezone();
  const [attendees, setAttendees] = useState<Attendee[]>(election.attendees || []);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
  }, [electionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = async () => {
    try {
      setLoading(true);
      const [attendeeData, memberData] = await Promise.all([
        electionService.getAttendees(electionId),
        userService.getUsers(),
      ]);
      setAttendees(attendeeData.attendees);
      setMembers(
        memberData.filter((m: User) => m.status === UserStatus.ACTIVE || m.status === UserStatus.PROBATIONARY)
      );
    } catch (_err) {
      toast.error('Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  };

  const attendeeIds = useMemo(() => new Set(attendees.map((a) => a.user_id)), [attendees]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.toLowerCase();
    return members.filter(
      (m) =>
        (m.first_name?.toLowerCase().includes(q) ?? false) ||
        (m.last_name?.toLowerCase().includes(q) ?? false) ||
        (m.full_name?.toLowerCase().includes(q) ?? false) ||
        (m.membership_number?.toLowerCase().includes(q) ?? false)
    );
  }, [members, searchQuery]);

  const notCheckedIn = filteredMembers.filter((m) => !attendeeIds.has(m.id));

  const handleCheckIn = async (userId: string) => {
    try {
      setChecking(userId);
      const result = await electionService.checkInAttendee(electionId, userId);
      toast.success(result.message);

      // Refresh from server to confirm persistence
      const [attendeeData, updated] = await Promise.all([
        electionService.getAttendees(electionId),
        electionService.getElection(electionId),
      ]);
      setAttendees(attendeeData.attendees);
      onUpdate(updated);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to check in member'));
    } finally {
      setChecking(null);
    }
  };

  const handleRemove = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from attendance?`)) return;

    try {
      await electionService.removeAttendee(electionId, userId);
      toast.success(`${name} removed from attendance`);

      // Refresh from server to confirm persistence
      const [attendeeData, updated] = await Promise.all([
        electionService.getAttendees(electionId),
        electionService.getElection(electionId),
      ]);
      setAttendees(attendeeData.attendees);
      onUpdate(updated);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove attendee'));
    }
  };

  const isClosed = election.status === ElectionStatus.CLOSED || election.status === ElectionStatus.CANCELLED;

  if (loading) {
    return (
      <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
        <div className="text-theme-text-muted py-4 text-center">Loading attendance...</div>
      </div>
    );
  }

  return (
    <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-theme-text-primary text-lg font-medium">Meeting Attendance ({attendees.length})</h3>
        {attendees.length > 0 && members.length > 0 && (
          <span className="text-theme-text-muted text-sm">
            {Math.round((attendees.length / members.length) * 100)}% of members present
          </span>
        )}
      </div>

      {/* Checked-in Attendees */}
      {attendees.length > 0 && (
        <div className="mb-6">
          <h4 className="mb-2 text-sm font-semibold text-green-700 dark:text-green-400">
            Present ({attendees.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {attendees.map((attendee) => (
              <div
                key={attendee.user_id}
                className="flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-sm"
              >
                <span className="font-medium text-green-700 dark:text-green-300">{attendee.name}</span>
                <span className="text-xs text-green-700 dark:text-green-500">
                  {formatTime(attendee.checked_in_at, tz)}
                </span>
                {!isClosed && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleRemove(attendee.user_id, attendee.name);
                    }}
                    className="focus:ring-theme-focus-ring ml-1 flex min-h-[28px] min-w-[28px] items-center justify-center rounded-sm p-1 text-xs text-green-700 hover:text-red-700 focus:ring-2 focus:outline-hidden dark:text-green-500 dark:hover:text-red-400"
                    title="Remove from attendance"
                    aria-label={`Remove ${attendee.name} from attendance`}
                  >
                    &#10005;
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Check-in Section */}
      {!isClosed && (
        <div>
          <h4 className="text-theme-text-secondary mb-2 text-sm font-semibold">
            Check In Members ({notCheckedIn.length} remaining)
          </h4>

          {/* Search */}
          <div className="mb-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input shadow-xs"
              placeholder="Search by name or membership number..."
            />
          </div>

          {/* Members list */}
          {notCheckedIn.length === 0 ? (
            <div className="text-theme-text-muted py-4 text-center text-sm">
              {searchQuery ? 'No matching members found' : 'All members are checked in'}
            </div>
          ) : (
            <div className="border-theme-surface-border divide-theme-surface-border max-h-64 divide-y overflow-y-auto rounded-lg border">
              {notCheckedIn.map((member) => (
                <div
                  key={member.id}
                  className="hover:bg-theme-surface-secondary flex items-center justify-between px-4 py-2"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-theme-text-primary text-sm font-medium">
                        {member.first_name} {member.last_name}
                      </span>
                      {member.membership_number && (
                        <span className="text-theme-text-muted ml-2 text-xs">#{member.membership_number}</span>
                      )}
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        member.status === UserStatus.PROBATIONARY
                          ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300'
                          : 'bg-green-500/20 text-green-700 dark:text-green-300'
                      }`}
                    >
                      {member.status}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void handleCheckIn(member.id);
                    }}
                    disabled={checking === member.id}
                    className="btn-info rounded-sm px-3 py-1 text-xs"
                  >
                    {checking === member.id ? 'Checking in...' : 'Check In'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MeetingAttendance;
