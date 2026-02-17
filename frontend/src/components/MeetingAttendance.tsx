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
      setMembers(memberData.filter((m: User) => m.status === 'active' || m.status === 'probationary'));
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
        (m.badge_number?.toLowerCase().includes(q) ?? false)
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

  const isClosed = election.status === 'closed' || election.status === 'cancelled';

  if (loading) {
    return (
      <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
        <div className="text-slate-400 text-center py-4">Loading attendance...</div>
      </div>
    );
  }

  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-white">
          Meeting Attendance ({attendees.length})
        </h3>
        {attendees.length > 0 && members.length > 0 && (
          <span className="text-sm text-slate-400">
            {Math.round((attendees.length / members.length) * 100)}% of members present
          </span>
        )}
      </div>

      {/* Checked-in Attendees */}
      {attendees.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-green-400 mb-2">
            Present ({attendees.length})
          </h4>
          <div className="flex flex-wrap gap-2">
            {attendees.map((attendee) => (
              <div
                key={attendee.user_id}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-full text-sm"
              >
                <span className="text-green-300 font-medium">{attendee.name}</span>
                <span className="text-green-500 text-xs">
                  {new Date(attendee.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {!isClosed && (
                  <button
                    type="button"
                    onClick={() => handleRemove(attendee.user_id, attendee.name)}
                    className="ml-1 text-green-500 hover:text-red-400 text-xs"
                    title="Remove from attendance"
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
          <h4 className="text-sm font-semibold text-slate-300 mb-2">
            Check In Members ({notCheckedIn.length} remaining)
          </h4>

          {/* Search */}
          <div className="mb-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full bg-slate-900/50 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:ring-blue-500 focus:border-blue-500 text-sm"
              placeholder="Search by name or badge number..."
            />
          </div>

          {/* Members list */}
          {notCheckedIn.length === 0 ? (
            <div className="text-center py-4 text-slate-400 text-sm">
              {searchQuery ? 'No matching members found' : 'All members are checked in'}
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto border border-white/20 rounded-lg divide-y divide-white/10">
              {notCheckedIn.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between px-4 py-2 hover:bg-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-sm font-medium text-white">
                        {member.first_name} {member.last_name}
                      </span>
                      {member.badge_number && (
                        <span className="ml-2 text-xs text-slate-500">
                          #{member.badge_number}
                        </span>
                      )}
                    </div>
                    <span
                      className={`px-1.5 py-0.5 text-xs rounded ${
                        member.status === 'probationary'
                          ? 'bg-yellow-500/20 text-yellow-300'
                          : 'bg-green-500/20 text-green-300'
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
