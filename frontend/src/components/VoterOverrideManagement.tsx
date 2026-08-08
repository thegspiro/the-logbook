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
import { formatShortDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';

interface VoterOverrideManagementProps {
  electionId: string;
  canManage: boolean;
}

export const VoterOverrideManagement: React.FC<VoterOverrideManagementProps> = ({ electionId, canManage }) => {
  const tz = useTimezone();
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

  if (loading) {
    return (
      <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
        <div className="text-theme-text-muted py-4 text-center">Loading voter overrides...</div>
      </div>
    );
  }

  return (
    <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-theme-text-primary text-lg font-medium">Voter Overrides ({overrides.length})</h3>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setError(null);
              if (showAddForm) resetForm();
            }}
            className="btn-info rounded-md text-sm"
          >
            {showAddForm ? 'Cancel' : '+ Add Override'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Add Override Form */}
      {showAddForm && canManage && (
        <div className="card-secondary mb-6 p-4">
          <h4 className="text-theme-text-primary mb-3 text-sm font-semibold">Add Voter Override</h4>
          <div className="space-y-3">
            <div>
              <label className="text-theme-text-primary block text-sm font-medium">Member User ID *</label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-xs focus:ring-2 focus:outline-hidden"
                placeholder="Enter the member's user ID..."
              />
            </div>

            <div>
              <label className="text-theme-text-primary block text-sm font-medium">
                Reason * <span className="text-theme-text-muted font-normal">(min 10 characters)</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-xs focus:ring-2 focus:outline-hidden"
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
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-md border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleAdd();
                }}
                disabled={submitting || !userId.trim() || reason.trim().length < 10}
                className="btn-info rounded-md text-sm"
              >
                {submitting ? 'Adding...' : 'Add Override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overrides List */}
      {overrides.length === 0 ? (
        <div className="text-theme-text-muted py-8 text-center">
          <p>No voter overrides.</p>
          {canManage && (
            <p className="mt-1 text-sm">
              Use overrides to grant voting rights to members who don&apos;t meet standard eligibility.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {overrides.map((override) => (
            <div key={override.user_id} className="card-secondary p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-theme-text-primary truncate font-medium">
                      {override.user_name || override.user_id}
                    </span>
                    {override.user_name && (
                      <span className="text-theme-text-muted shrink-0 text-xs">{override.user_id}</span>
                    )}
                  </div>
                  <p className="text-theme-text-muted mt-1 text-sm">{override.reason}</p>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Overridden by {override.overridden_by_name || override.overridden_by}
                    {' on '}
                    {formatShortDateTime(override.overridden_at, tz)}
                  </p>
                </div>

                {canManage && (
                  <div className="ml-4 shrink-0">
                    {confirmingRemoveId === override.user_id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleRemove(override.user_id);
                          }}
                          aria-label={`Confirm removal of override for ${override.user_name || override.user_id}`}
                          className="btn-primary rounded-sm px-2 py-1 text-xs"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingRemoveId(null)}
                          className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-sm border px-2 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingRemoveId(override.user_id)}
                        aria-label={`Remove override for ${override.user_name || override.user_id}`}
                        className="rounded-sm bg-red-500/20 px-2 py-1 text-xs text-red-700 hover:bg-red-500/30 dark:text-red-300"
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
