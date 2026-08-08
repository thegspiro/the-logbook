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
import { UserStatus, ElectionStatus } from '../constants/enums';

const inputClass =
  'mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring focus:border-theme-focus-ring text-sm';

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

export const CandidateManagement: React.FC<CandidateManagementProps> = ({ electionId, election }) => {
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
    void fetchData();
  }, [electionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    try {
      setLoading(true);
      const [candidateData, memberData] = await Promise.all([
        electionService.getCandidates(electionId),
        userService.getUsers(),
      ]);
      setCandidates(candidateData);
      setMembers(
        memberData.filter((m: User) => m.status === UserStatus.ACTIVE || m.status === UserStatus.PROBATIONARY)
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load candidates'));
    } finally {
      setLoading(false);
    }
  };

  // Members already added as candidates
  const candidateUserIds = useMemo(() => new Set(candidates.map((c) => c.user_id).filter(Boolean)), [candidates]);

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
          (m.membership_number?.toLowerCase().includes(q) ?? false)
      )
      .slice(0, 10);
  }, [members, memberSearch, candidateUserIds]);

  const selectMember = (member: User) => {
    const name = member.full_name || `${member.first_name || ''} ${member.last_name || ''}`.trim();
    setFormData((prev) => ({ ...prev, name, user_id: member.id }));
    setMemberSearch('');
  };

  const handleAdd = async () => {
    const candidateName = formData.name.trim() || (formData.is_write_in ? 'Write-in Candidate' : '');
    if (!candidateName) {
      setError('Name is required');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const candidateData: CandidateCreate = {
        election_id: electionId,
        name: candidateName,
        ...(formData.position ? { position: formData.position } : {}),
        ...(formData.statement ? { statement: formData.statement } : {}),
        ...(formData.user_id ? { user_id: formData.user_id } : {}),
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
        ...(formData.name.trim() ? { name: formData.name.trim() } : {}),
        ...(formData.position ? { position: formData.position } : {}),
        ...(formData.statement ? { statement: formData.statement } : {}),
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
      <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
        <div className="text-theme-text-muted py-4 text-center">Loading candidates...</div>
      </div>
    );
  }

  const isClosed = election.status === ElectionStatus.CLOSED || election.status === ElectionStatus.CANCELLED;

  return (
    <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-theme-text-primary text-lg font-medium">Candidates ({candidates.length})</h3>
        {!isClosed && (
          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setFormData(emptyCandidateForm);
              setMemberSearch('');
              setError(null);
            }}
            className="btn-info rounded-md text-sm"
          >
            {showAddForm ? 'Cancel' : '+ Add Candidate'}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" aria-live="assertive" className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Add Candidate Form */}
      {showAddForm && (
        <div className="card-secondary mb-6 p-4">
          <h4 className="text-theme-text-primary mb-3 text-sm font-semibold">Add New Candidate</h4>
          <div className="space-y-3">
            {positions.length > 0 && (
              <div>
                <label className="text-theme-text-primary block text-sm font-medium">Position</label>
                <select
                  value={formData.position}
                  onChange={(e) => setFormData((prev) => ({ ...prev, position: e.target.value }))}
                  className={inputClass}
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

            {/* Member Search */}
            <div>
              <label className="text-theme-text-primary block text-sm font-medium">Select Member</label>
              <div className="relative">
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className={inputClass}
                  placeholder="Search members by name or membership number..."
                />
                {filteredMembers.length > 0 && (
                  <div className="bg-theme-surface-modal border-theme-input-border absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border shadow-lg">
                    {filteredMembers.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => selectMember(member)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/10"
                      >
                        <span className="text-theme-text-primary">
                          {member.first_name} {member.last_name}
                        </span>
                        {member.membership_number && (
                          <span className="text-theme-text-muted text-xs">#{member.membership_number}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {formData.user_id && (
                <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                  Selected: {formData.name}
                  <button
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, name: '', user_id: '' }))}
                    className="text-theme-text-muted ml-2 hover:text-red-800 dark:hover:text-red-400"
                    aria-label="Clear selected member"
                  >
                    (clear)
                  </button>
                </p>
              )}
            </div>

            {/* Manual name entry (fallback or override) */}
            <div>
              <label className="text-theme-text-primary block text-sm font-medium">
                Name {formData.user_id ? '' : '*'}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value, user_id: '' }))}
                className={inputClass}
                placeholder={formData.user_id ? formData.name : 'Or type a name manually'}
              />
            </div>

            <div>
              <label className="text-theme-text-primary block text-sm font-medium">Statement</label>
              <textarea
                value={formData.statement}
                onChange={(e) => setFormData((prev) => ({ ...prev, statement: e.target.value }))}
                rows={3}
                className={inputClass}
                placeholder="Candidate's statement or platform..."
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_write_in"
                  checked={formData.is_write_in}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFormData((prev) => ({
                      ...prev,
                      is_write_in: checked,
                      // Auto-fill name for write-in candidates if empty
                      ...(checked && !prev.name.trim() ? { name: 'Write-in Candidate' } : {}),
                      // Clear member link for write-ins
                      ...(checked ? { user_id: '' } : {}),
                    }));
                    if (checked) setMemberSearch('');
                  }}
                  className="border-theme-input-border rounded-sm text-blue-600"
                />
                <label htmlFor="is_write_in" className="text-theme-text-primary text-sm">
                  Write-in candidate
                </label>
              </div>
              <p className="text-theme-text-muted mt-1 ml-6 text-xs">
                Adds this candidate as a write-in nomination (not from the official slate).
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleAdd();
                }}
                disabled={submitting || (!formData.name.trim() && !formData.is_write_in)}
                className="btn-info rounded-md text-sm"
              >
                {submitting ? 'Adding...' : 'Add Candidate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Candidates List */}
      {candidates.length === 0 ? (
        <div className="text-theme-text-muted py-8 text-center">
          <p>No candidates yet.</p>
          {!isClosed && <p className="mt-1 text-sm">Click "Add Candidate" to get started.</p>}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedCandidates).map(([groupName, groupCandidates]) => (
            <div key={groupName}>
              {Object.keys(groupedCandidates).length > 1 && (
                <h4 className="text-theme-text-muted mb-3 text-sm font-semibold tracking-wider uppercase">
                  {groupName} ({groupCandidates.length})
                </h4>
              )}

              <div className="space-y-2">
                {groupCandidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={`rounded-lg border p-4 ${
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
                          onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                          className="bg-theme-input-bg border-theme-input-border text-theme-text-primary block w-full rounded-md border px-3 py-2 text-sm shadow-xs"
                        />
                        {positions.length > 0 && (
                          <select
                            value={formData.position}
                            onChange={(e) => setFormData((prev) => ({ ...prev, position: e.target.value }))}
                            className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring focus:border-theme-focus-ring block w-full rounded-md border px-3 py-2 text-sm shadow-xs focus:ring-2 focus:outline-hidden"
                          >
                            <option value="">Select position...</option>
                            {positions.map((pos) => (
                              <option key={pos} value={pos}>
                                {pos}
                              </option>
                            ))}
                          </select>
                        )}
                        <textarea
                          value={formData.statement}
                          onChange={(e) => setFormData((prev) => ({ ...prev, statement: e.target.value }))}
                          rows={2}
                          className="bg-theme-input-bg border-theme-input-border text-theme-text-primary block w-full rounded-md border px-3 py-2 text-sm shadow-xs"
                          placeholder="Statement..."
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              void handleEdit(candidate.id);
                            }}
                            disabled={submitting}
                            className="btn-info rounded-sm px-3 py-1 text-sm"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-sm border px-3 py-1 text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-theme-text-primary font-medium">{candidate.name}</span>
                            {candidate.is_write_in && (
                              <span className="bg-theme-surface text-theme-text-secondary rounded-sm px-2 py-0.5 text-xs">
                                Write-in
                              </span>
                            )}
                            {!candidate.accepted && (
                              <span className="rounded-sm bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-700 dark:text-yellow-300">
                                Pending
                              </span>
                            )}
                          </div>
                          {candidate.statement && (
                            <p className="text-theme-text-muted mt-1 line-clamp-2 text-sm">{candidate.statement}</p>
                          )}
                        </div>

                        {!isClosed && (
                          <div className="ml-4 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void handleToggleAccepted(candidate);
                              }}
                              aria-label={`${candidate.accepted ? 'Accepted' : 'Accept'} ${candidate.name}`}
                              className={`rounded px-2 py-1 text-xs ${
                                candidate.accepted
                                  ? 'bg-green-500/20 text-green-700 hover:bg-green-500/30 dark:text-green-300'
                                  : 'bg-yellow-500/20 text-yellow-700 hover:bg-yellow-500/30 dark:text-yellow-300'
                              }`}
                            >
                              {candidate.accepted ? 'Accepted' : 'Accept'}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(candidate)}
                              aria-label={`Edit ${candidate.name}`}
                              className="bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover rounded-sm px-2 py-1 text-xs"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void handleDelete(candidate.id, candidate.name);
                              }}
                              aria-label={`Remove ${candidate.name}`}
                              className="rounded-sm bg-red-500/20 px-2 py-1 text-xs text-red-700 hover:bg-red-500/30 dark:text-red-300"
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
