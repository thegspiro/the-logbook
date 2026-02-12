/**
 * Candidate Management Component
 *
 * Admin interface for managing candidates in an election.
 * Supports adding, editing, reordering, and removing candidates.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { Election, Candidate, CandidateCreate, CandidateUpdate } from '../types/election';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CandidateFormState>(emptyCandidateForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchCandidates();
  }, [electionId]);

  const fetchCandidates = async () => {
    try {
      setLoading(true);
      const data = await electionService.getCandidates(electionId);
      setCandidates(data);
    } catch (err: any) {
      console.error('Error fetching candidates:', err);
      setError(err.response?.data?.detail || 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
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
      setShowAddForm(false);
      toast.success('Candidate added successfully');
    } catch (err: any) {
      console.error('Error adding candidate:', err);
      setError(err.response?.data?.detail || 'Failed to add candidate');
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
    } catch (err: any) {
      console.error('Error updating candidate:', err);
      setError(err.response?.data?.detail || 'Failed to update candidate');
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
    } catch (err: any) {
      console.error('Error deleting candidate:', err);
      setError(err.response?.data?.detail || 'Failed to remove candidate');
    }
  };

  const handleToggleAccepted = async (candidate: Candidate) => {
    try {
      const updated = await electionService.updateCandidate(electionId, candidate.id, {
        accepted: !candidate.accepted,
      });
      setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? updated : c)));
      toast.success(updated.accepted ? 'Candidate accepted' : 'Candidate declined');
    } catch (err: any) {
      console.error('Error toggling acceptance:', err);
      setError(err.response?.data?.detail || 'Failed to update candidate');
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
      <div className="bg-white shadow rounded-lg p-6">
        <div className="text-gray-500 text-center py-4">Loading candidates...</div>
      </div>
    );
  }

  const isClosed = election.status === 'closed' || election.status === 'cancelled';

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">
          Candidates ({candidates.length})
        </h3>
        {!isClosed && (
          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setFormData(emptyCandidateForm);
              setError(null);
            }}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            {showAddForm ? 'Cancel' : '+ Add Candidate'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Add Candidate Form */}
      {showAddForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Add New Candidate</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Candidate name"
              />
            </div>

            {positions.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Position</label>
                <select
                  value={formData.position}
                  onChange={(e) => setFormData((prev) => ({ ...prev, position: e.target.value }))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-blue-500 focus:border-blue-500 text-sm"
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
              <label className="block text-sm font-medium text-gray-700">Statement</label>
              <textarea
                value={formData.statement}
                onChange={(e) => setFormData((prev) => ({ ...prev, statement: e.target.value }))}
                rows={3}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Candidate's statement or platform..."
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_write_in"
                checked={formData.is_write_in}
                onChange={(e) => setFormData((prev) => ({ ...prev, is_write_in: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600"
              />
              <label htmlFor="is_write_in" className="text-sm text-gray-700">
                Write-in candidate
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
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
        <div className="text-center py-8 text-gray-500">
          <p>No candidates yet.</p>
          {!isClosed && <p className="text-sm mt-1">Click "Add Candidate" to get started.</p>}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedCandidates).map(([groupName, groupCandidates]) => (
            <div key={groupName}>
              {Object.keys(groupedCandidates).length > 1 && (
                <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3">
                  {groupName} ({groupCandidates.length})
                </h4>
              )}

              <div className="space-y-2">
                {groupCandidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={`p-4 rounded-lg border ${
                      candidate.accepted
                        ? 'border-gray-200 bg-white'
                        : 'border-yellow-200 bg-yellow-50'
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
                          className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
                        />
                        <textarea
                          value={formData.statement}
                          onChange={(e) =>
                            setFormData((prev) => ({ ...prev, statement: e.target.value }))
                          }
                          rows={2}
                          className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm"
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
                            className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{candidate.name}</span>
                            {candidate.is_write_in && (
                              <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                                Write-in
                              </span>
                            )}
                            {!candidate.accepted && (
                              <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">
                                Pending
                              </span>
                            )}
                          </div>
                          {candidate.statement && (
                            <p className="mt-1 text-sm text-gray-500 line-clamp-2">
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
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                              }`}
                            >
                              {candidate.accepted ? 'Accepted' : 'Accept'}
                            </button>
                            <button
                              type="button"
                              onClick={() => startEdit(candidate)}
                              className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(candidate.id, candidate.name)}
                              className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
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
