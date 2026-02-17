/**
 * Candidate Management Component
 *
 * Admin interface for managing candidates in an election.
 * Supports adding, editing, reordering, and removing candidates.
 */

import React, { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { electionService, userService } from '../services/api';
import type { Election, Candidate, CandidateCreate, CandidateUpdate } from '../types/election';
import type { User } from '../types/user';
import { getErrorMessage } from '../utils/errorHandling';

interface CandidateManagementProps {
  electionId: string;
  election: Election;
}

interface CandidateFormState {
  name: string;
  position: string;
  statement: string;
  user_id: string;
  is_write_in: boolean;
}

const emptyCandidateForm: CandidateFormState = {
  name: '',
  position: '',
  statement: '',
  user_id: '',
  is_write_in: false,
};

export const CandidateManagement: React.FC<CandidateManagementProps> = ({
  electionId,
  election,
}) => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CandidateFormState>(emptyCandidateForm);
  const [submitting, setSubmitting] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  useEffect(() => {
    fetchData();
  }, [electionId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [candidateData, memberData] = await Promise.all([
        electionService.getCandidates(electionId),
        userService.getUsers(),
      ]);
      setCandidates(candidateData);
      setMembers(memberData.filter((m: User) => m.status === 'active' || m.status === 'probationary'));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load candidates'));
    } finally {
      setLoading(false);
    }
  };

  // Members already added as candidates
  const candidateUserIds = useMemo(
    () => new Set(candidates.map((c) => c.user_id).filter(Boolean)),
    [candidates]
  );

  // Filtered members for the search picker
  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return [];
    const q = memberSearch.toLowerCase();
    return members
      .filter((m) => !candidateUserIds.has(m.id))
      .filter(
        (m) =>
          (m.first_name?.toLowerCase().includes(q) ?? false) ||
          (m.last_name?.toLowerCase().includes(q) ?? false) ||
          (m.full_name?.toLowerCase().includes(q) ?? false) ||
          (m.badge_number?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 10);
  }, [members, memberSearch, candidateUserIds]);

  const selectMember = (member: User) => {
    const name = member.full_name || `${member.first_name || ''} ${member.last_name || ''}`.trim();
    setFormData((prev) => ({ ...prev, name, user_id: member.id }));
    setMemberSearch('');
  };

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const candidateData: CandidateCreate = {
        election_id: electionId,
        name: formData.name.trim(),
        position: formData.position || undefined,
        statement: formData.statement || undefined,
        user_id: formData.user_id || undefined,
        is_write_in: formData.is_write_in,
        display_order: candidates.length,
      };

      const newCandidate = await electionService.createCandidate(electionId, candidateData);
      setCandidates((prev) => [...prev, newCandidate]);
      setFormData(emptyCandidateForm);
      setMemberSearch('');
      setShowAddForm(false);
      toast.success('Candidate added successfully');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add candidate'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (candidateId: string) => {
    try {
      setSubmitting(true);
      setError(null);

      const updateData: CandidateUpdate = {
        name: formData.name.trim() || undefined,
        position: formData.position || undefined,
        statement: formData.statement || undefined,
      };

      const updated = await electionService.updateCandidate(electionId, candidateId, updateData);
      setCandidates((prev) => prev.map((c) => (c.id === candidateId ? updated : c)));
      setEditingId(null);
      setFormData(emptyCandidateForm);
      toast.success('Candidate updated');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update candidate'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (candidateId: string, candidateName: string) => {
    if (!confirm(`Are you sure you want to remove ${candidateName}?`)) return;

    try {
      setError(null);
      await electionService.deleteCandidate(electionId, candidateId);
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      toast.success('Candidate removed');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to remove candidate'));
    }
  };

  const handleToggleAccepted = async (candidate: Candidate) => {
    try {
      const updated = await electionService.updateCandidate(electionId, candidate.id, {
        accepted: !candidate.accepted,
      });
      setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? updated : c)));
      toast.success(updated.accepted ? 'Candidate accepted' : 'Candidate declined');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to update candidate'));
    }
  };

  const startEdit = (candidate: Candidate) => {
    setEditingId(candidate.id);
    setFormData({
      name: candidate.name,
      position: candidate.position || '',
      statement: candidate.statement || '',
      user_id: candidate.user_id || '',
      is_write_in: candidate.is_write_in,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormData(emptyCandidateForm);
  };

  // Group candidates by position
  const positions = election.positions || [];
  const groupedCandidates: Record<string, Candidate[]> = {};

  if (positions.length > 0) {
    for (const pos of positions) {
      groupedCandidates[pos] = candidates.filter((c) => c.position === pos);
    }
    // Candidates without a position
    const unassigned = candidates.filter((c) => !c.position || !positions.includes(c.position));
    if (unassigned.length > 0) {
      groupedCandidates['Unassigned'] = unassigned;
    }
  } else {
    groupedCandidates['Candidates'] = candidates;
  }

  if (loading) {
    return (
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
        <div className="text-theme-text-muted text-center py-4">Loading candidates...</div>
      </div>
    );
  }

  const isClosed = election.status === 'closed' || election.status === 'cancelled';

  return (
    <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-theme-text-primary">
          Candidates ({candidates.length})
        </h3>
        {!isClosed && (
          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setFormData(emptyCandidateForm);
              setMemberSearch('');
              setError(null);
            }}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            {showAddForm ? 'Cancel' : '+ Add Candidate'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Add Candidate Form */}
      {showAddForm && (
        <div className="mb-6 p-4 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
          <h4 className="text-sm font-semibold text-theme-text-primary mb-3">Add New Candidate</h4>
          <div className="space-y-3">
            {/* Member Search */}
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">Select Member</label>
              <div className="relative">
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-white focus:ring-blue-500 focus:border-blue-500 text-sm"
                  placeholder="Search members by name or badge number..."
                />
                {filteredMembers.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-theme-surface border border-theme-input-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {filteredMembers.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => selectMember(member)}
                        className="w-full text-left px-3 py-2 hover:bg-white/10 flex items-center justify-between text-sm"
                      >
                        <span className="text-white">
                          {member.first_name} {member.last_name}
                        </span>
                        {member.badge_number && (
                          <span className="text-xs text-theme-text-muted">#{member.badge_number}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {formData.user_id && (
                <p className="mt-1 text-xs text-green-400">
                  Selected: {formData.name}
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, name: '', user_id: '' }))}
                    className="ml-2 text-theme-text-muted hover:text-red-400"
                  >
                    (clear)
                  </button>
                </p>
              )}
            </div>

            {/* Manual name entry (fallback or override) */}
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">
                Name {formData.user_id ? '' : '*'}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value, user_id: '' }))}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-white focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder={formData.user_id ? formData.name : 'Or type a name manually'}
              />
            </div>

            {positions.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-theme-text-primary">Position</label>
                <select
                  value={formData.position}
                  onChange={(e) => setFormData((prev) => ({ ...prev, position: e.target.value }))}
                  className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="">Select position...</option>
                  {positions.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-theme-text-primary">Statement</label>
              <textarea
                value={formData.statement}
                onChange={(e) => setFormData((prev) => ({ ...prev, statement: e.target.value }))}
                rows={3}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Candidate's statement or platform..."
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_write_in"
                checked={formData.is_write_in}
                onChange={(e) => setFormData((prev) => ({ ...prev, is_write_in: e.target.checked }))}
                className="rounded border-theme-input-border text-blue-600"
              />
              <label htmlFor="is_write_in" className="text-sm text-theme-text-primary">
                Write-in candidate
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-2 text-sm border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={submitting || !formData.name.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Adding...' : 'Add Candidate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Candidates List */}
      {candidates.length === 0 ? (
        <div className="text-center py-8 text-theme-text-muted">
          <p>No candidates yet.</p>
          {!isClosed && <p className="text-sm mt-1">Click "Add Candidate" to get started.</p>}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedCandidates).map(([groupName, groupCandidates]) => (
            <div key={groupName}>
              {Object.keys(groupedCandidates).length > 1 && (
                <h4 className="text-sm font-semibold text-theme-text-muted uppercase tracking-wider mb-3">
                  {groupName} ({groupCandidates.length})
                </h4>
              )}

              <div className="space-y-2">
                {groupCandidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={`p-4 rounded-lg border ${
                      candidate.accepted
                        ? 'border-theme-surface-border bg-theme-surface-secondary'
                        : 'border-yellow-500/30 bg-yellow-500/10'
                    }`}
                  >
                    {editingId === candidate.id ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, name: e.target.value }))
                          }
                          className="block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary text-sm"
                        />
                        <textarea
                          value={formData.statement}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, statement: e.target.value }))
                          }
                          rows={2}
                          className="block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary text-sm"
                          placeholder="Statement..."
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(candidate.id)}
                            disabled={submitting}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="px-3 py-1 text-sm border border-theme-surface-border rounded text-theme-text-secondary hover:bg-theme-surface-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-theme-text-primary">{candidate.name}</span>
                            {candidate.is_write_in && (
                              <span className="px-2 py-0.5 text-xs bg-theme-surface text-theme-text-secondary rounded">
                                Write-in
                              </span>
                            )}
                            {!candidate.accepted && (
                              <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 rounded">
                                Pending
                              </span>
                            )}
                          </div>
                          {candidate.statement && (
                            <p className="mt-1 text-sm text-theme-text-muted line-clamp-2">
                              {candidate.statement}
                            </p>
                          )}
                        </div>

                        {!isClosed && (
                          <div className="flex items-center gap-2 ml-4">
                            <button
                              type="button"
                              onClick={() => handleToggleAccepted(candidate)}
                              className={`px-2 py-1 text-xs rounded ${
                                candidate.accepted
                                  ? 'bg-green-500/20 text-green-700 dark:text-green-300 hover:bg-green-500/30'
                                  : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-500/30'
                              }`}
                            >
                              {candidate.accepted ? 'Accepted' : 'Accept'}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(candidate)}
                              className="px-2 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded hover:bg-theme-surface-hover"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(candidate.id, candidate.name)}
                              className="px-2 py-1 text-xs bg-red-500/20 text-red-700 dark:text-red-300 rounded hover:bg-red-500/30"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CandidateManagement;
