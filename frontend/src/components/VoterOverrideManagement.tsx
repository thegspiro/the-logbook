/**
 * Voter Override Management Component
 *
 * Secretary tool for managing voter eligibility overrides in elections.
 * Allows granting voting rights to members who otherwise don't meet
 * eligibility requirements (e.g., missed a meeting).
 */

import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { VoterOverride } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';

interface VoterOverrideManagementProps {
  electionId: string;
  canManage: boolean;
}

export const VoterOverrideManagement: React.FC<VoterOverrideManagementProps> = ({
  electionId,
  canManage,
}) => {
  const [overrides, setOverrides] = useState<VoterOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  // Form state
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');

  const fetchOverrides = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getVoterOverrides(electionId);
      setOverrides(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load voter overrides'));
    } finally {
      setLoading(false);
    }
  }, [electionId]);

  useEffect(() => {
    void fetchOverrides();
  }, [fetchOverrides]);

  const resetForm = () => {
    setUserId('');
    setReason('');
    setShowAddForm(false);
  };

  const handleAdd = async () => {
    const trimmedUserId = userId.trim();
    const trimmedReason = reason.trim();

    if (!trimmedUserId) {
      setError('User ID is required');
      return;
    }
    if (trimmedReason.length < 10) {
      setError('Reason must be at least 10 characters');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const newOverride = await electionService.addVoterOverride(electionId, {
        user_id: trimmedUserId,
        reason: trimmedReason,
      });
      setOverrides((prev) => [...prev, newOverride]);
      resetForm();
      toast.success('Voter override added successfully');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add voter override'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (targetUserId: string) => {
    try {
      setError(null);
      await electionService.removeVoterOverride(electionId, targetUserId);
      setOverrides((prev) => prev.filter((o) => o.user_id !== targetUserId));
      setConfirmingRemoveId(null);
      toast.success('Voter override removed');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to remove voter override'));
    }
  };

  const formatDate = (dateStr: string): string => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
        <div className="text-theme-text-muted text-center py-4">Loading voter overrides...</div>
      </div>
    );
  }

  return (
    <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-theme-text-primary">
          Voter Overrides ({overrides.length})
        </h3>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setError(null);
              if (showAddForm) resetForm();
            }}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            {showAddForm ? 'Cancel' : '+ Add Override'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Add Override Form */}
      {showAddForm && canManage && (
        <div className="mb-6 p-4 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
          <h4 className="text-sm font-semibold text-theme-text-primary mb-3">Add Voter Override</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">
                Member User ID *
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Enter the member's user ID..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-primary">
                Reason * <span className="text-theme-text-muted font-normal">(min 10 characters)</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Reason for granting voting eligibility override..."
              />
              {reason.trim().length > 0 && reason.trim().length < 10 && (
                <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">
                  {10 - reason.trim().length} more character{10 - reason.trim().length !== 1 ? 's' : ''} needed
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-2 text-sm border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={submitting || !userId.trim() || reason.trim().length < 10}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Adding...' : 'Add Override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overrides List */}
      {overrides.length === 0 ? (
        <div className="text-center py-8 text-theme-text-muted">
          <p>No voter overrides.</p>
          {canManage && (
            <p className="text-sm mt-1">
              Use overrides to grant voting rights to members who don&apos;t meet standard eligibility.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {overrides.map((override) => (
            <div
              key={override.user_id}
              className="p-4 rounded-lg border border-theme-surface-border bg-theme-surface-secondary"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-theme-text-primary truncate">
                      {override.user_name || override.user_id}
                    </span>
                    {override.user_name && (
                      <span className="text-xs text-theme-text-muted shrink-0">
                        {override.user_id}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-theme-text-muted">{override.reason}</p>
                  <p className="mt-1 text-xs text-theme-text-muted">
                    Overridden by {override.overridden_by_name || override.overridden_by}
                    {' on '}
                    {formatDate(override.overridden_at)}
                  </p>
                </div>

                {canManage && (
                  <div className="ml-4 shrink-0">
                    {confirmingRemoveId === override.user_id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRemove(override.user_id)}
                          className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingRemoveId(null)}
                          className="px-2 py-1 text-xs border border-theme-surface-border rounded text-theme-text-secondary hover:bg-theme-surface-secondary"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingRemoveId(override.user_id)}
                        className="px-2 py-1 text-xs bg-red-500/20 text-red-700 dark:text-red-300 rounded hover:bg-red-500/30"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VoterOverrideManagement;
