/**
 * Meeting Attendance Tracker Component
 *
 * Allows the secretary to check in members as present at a meeting.
 * Attendance is used by ballot items that require presence to vote.
 */

import React, { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import { userService } from '../services/api';
import type { Election, Attendee } from '../types/election';
import type { User } from '../types/user';
import { getErrorMessage } from '../utils/errorHandling';
import { UserStatus, ElectionStatus } from '../constants/enums';

interface MeetingAttendanceProps {
  electionId: string;
  election: Election;
  onUpdate: (updatedElection: Election) => void;
}

export const MeetingAttendance: React.FC<MeetingAttendanceProps> = ({
  electionId,
  election,
  onUpdate,
}) => {
  const [attendees, setAttendees] = useState<Attendee[]>(election.attendees || []);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [electionId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [attendeeData, memberData] = await Promise.all([
        electionService.getAttendees(electionId),
        userService.getUsers(),
      ]);
      setAttendees(attendeeData.attendees);
      setMembers(memberData.filter((m: User) => m.status === UserStatus.ACTIVE || m.status === UserStatus.PROBATIONARY));
    } catch (_err) {
      toast.error('Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  };

  const attendeeIds = useMemo(
    () => new Set(attendees.map((a) => a.user_id)),
    [attendees]
  );

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
      setAttendees((prev) => [...prev, result.attendee]);
      toast.success(result.message);

      // Refresh election data
      const updated = await electionService.getElection(electionId);
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
      setAttendees((prev) => prev.filter((a) => a.user_id !== userId));
      toast.success(`${name} removed from attendance`);

      const updated = await electionService.getElection(electionId);
      onUpdate(updated);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove attendee'));
    }
  };

  const isClosed = election.status === ElectionStatus.CLOSED || election.status === ElectionStatus.CANCELLED;

  if (loading) {
    return (
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
        <div className="text-theme-text-muted text-center py-4">Loading attendance...</div>
      </div>
    );
  }

  return (
    <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-theme-text-primary">
          Meeting Attendance ({attendees.length})
        </h3>
        {attendees.length > 0 && members.length > 0 && (
          <span className="text-sm text-theme-text-muted">
            {Math.round((attendees.length / members.length) * 100)}% of members present
          </span>
        )}
      </div>

      {/* Checked-in Attendees */}
      {attendees.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-2">
            Present ({attendees.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {attendees.map((attendee) => (
              <div
                key={attendee.user_id}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-full text-sm"
              >
                <span className="text-green-700 dark:text-green-300 font-medium">{attendee.name}</span>
                <span className="text-green-700 dark:text-green-500 text-xs">
                  {new Date(attendee.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {!isClosed && (
                  <button
                    type="button"
                    onClick={() => handleRemove(attendee.user_id, attendee.name)}
                    className="ml-1 p-1 min-w-[28px] min-h-[28px] flex items-center justify-center text-green-700 dark:text-green-500 hover:text-red-700 dark:hover:text-red-400 text-xs rounded focus:outline-none focus:ring-2 focus:ring-red-500"
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
          <h4 className="text-sm font-semibold text-theme-text-secondary mb-2">
            Check In Members ({notCheckedIn.length} remaining)
          </h4>

          {/* Search */}
          <div className="mb-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              placeholder="Search by name or badge number..."
            />
          </div>

          {/* Members list */}
          {notCheckedIn.length === 0 ? (
            <div className="text-center py-4 text-theme-text-muted text-sm">
              {searchQuery ? 'No matching members found' : 'All members are checked in'}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto border border-theme-surface-border rounded-lg divide-y divide-white/10">
              {notCheckedIn.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between px-4 py-2 hover:bg-theme-surface-secondary"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-sm font-medium text-theme-text-primary">
                        {member.first_name} {member.last_name}
                      </span>
                      {member.membership_number && (
                        <span className="ml-2 text-xs text-theme-text-muted">
                          #{member.membership_number}
                        </span>
                      )}
                    </div>
                    <span
                      className={`px-1.5 py-0.5 text-xs rounded ${
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
                    onClick={() => handleCheckIn(member.id)}
                    disabled={checking === member.id}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
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
