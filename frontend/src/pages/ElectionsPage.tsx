/**
 * Elections Page
 *
 * Lists all elections and allows creating new ones.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { electionService } from '../services/api';
import type { ElectionListItem, ElectionCreate, VotingMethod, VictoryCondition } from '../types/election';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatForDateTimeInput, localToUTC } from '../utils/dateFormatting';

export const ElectionsPage: React.FC = () => {
  const [elections, setElections] = useState<ElectionListItem[]>([]);
  const [filteredElections, setFilteredElections] = useState<ElectionListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [formData, setFormData] = useState<ElectionCreate>({
    title: '',
    description: '',
    election_type: 'general',
    positions: [],
    start_date: '',
    end_date: '',
    anonymous_voting: true,
    allow_write_ins: false,
    max_votes_per_position: 1,
    results_visible_immediately: false,
    voting_method: 'simple_majority',
    victory_condition: 'most_votes',
    enable_runoffs: false,
    runoff_type: 'top_two',
    max_runoff_rounds: 3,
  });
  const [positionInput, setPositionInput] = useState('');

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('elections.manage');
  const tz = useTimezone();

  useEffect(() => {
    fetchElections();
  }, []);

  useEffect(() => {
    if (statusFilter === 'all') {
      setFilteredElections(elections);
    } else {
      setFilteredElections(elections.filter(e => e.status === statusFilter));
    }
  }, [elections, statusFilter]);

  const fetchElections = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getElections();
      setElections(data);
    } catch (_err) {
      setError('Unable to load elections. Please check your connection and refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartDateChange = (startDate: string) => {
    setFormData({ ...formData, start_date: startDate });

    // If no end date is set, default to same day at 11:59 PM
    if (!formData.end_date && startDate) {
      const start = new Date(startDate);
      const end = new Date(start);
      end.setHours(23, 59, 0, 0);
      setFormData({ ...formData, start_date: startDate, end_date: formatForDateTimeInput(end, tz) });
    }
  };

  const setDuration = (hours: number) => {
    if (!formData.start_date) {
      setCreateError('Please set a start date first');
      return;
    }

    const start = new Date(formData.start_date);
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    setFormData({ ...formData, end_date: formatForDateTimeInput(end, tz) });
  };

  const setEndOfDay = () => {
    if (!formData.start_date) {
      setCreateError('Please set a start date first');
      return;
    }

    const start = new Date(formData.start_date);
    const end = new Date(start);
    end.setHours(23, 59, 0, 0);
    setFormData({ ...formData, end_date: formatForDateTimeInput(end, tz) });
  };

  const handleCreateElection = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    try {
      // Convert local datetime-local values to UTC before sending to backend
      const submitData = {
        ...formData,
        start_date: localToUTC(formData.start_date, tz),
        end_date: localToUTC(formData.end_date, tz),
      };
      await electionService.createElection(submitData);
      setShowCreateModal(false);
      setFormData({
        title: '',
        description: '',
        election_type: 'general',
        positions: [],
        start_date: '',
        end_date: '',
        anonymous_voting: true,
        allow_write_ins: false,
        max_votes_per_position: 1,
        results_visible_immediately: false,
        voting_method: 'simple_majority',
        victory_condition: 'most_votes',
        enable_runoffs: false,
        runoff_type: 'top_two',
        max_runoff_rounds: 3,
      });
      setPositionInput('');
      await fetchElections();
    } catch (err: unknown) {
      setCreateError(getErrorMessage(err, 'Failed to create election'));
    }
  };

  const addPosition = () => {
    if (positionInput.trim() && !formData.positions?.includes(positionInput.trim())) {
      setFormData({
        ...formData,
        positions: [...(formData.positions || []), positionInput.trim()],
      });
      setPositionInput('');
    }
  };

  const removePosition = (position: string) => {
    setFormData({
      ...formData,
      positions: formData.positions?.filter(p => p !== position) || [],
    });
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400';
      case 'closed':
        return 'bg-theme-surface-secondary text-theme-text-primary';
      case 'draft':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400';
      case 'cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400';
      default:
        return 'bg-theme-surface-secondary text-theme-text-primary';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-center items-center h-64" role="status" aria-live="polite">
            <div className="text-theme-text-muted">Loading elections...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-theme-text-primary">Elections</h2>
          <p className="mt-1 text-sm text-theme-text-muted">
            Manage elections and view results
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <svg className="-ml-1 mr-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Election
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      <div className="mb-4 flex space-x-2">
        {['all', 'draft', 'open', 'closed'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              statusFilter === status
                ? 'bg-blue-600 text-white'
                : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-theme-surface backdrop-blur-sm shadow overflow-hidden sm:rounded-md">
        {filteredElections.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-theme-text-muted">No elections found</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/10">
            {filteredElections.map((election) => (
              <li key={election.id}>
                <Link
                  to={`/elections/${election.id}`}
                  className="block hover:bg-theme-surface-secondary transition"
                >
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-lg font-medium text-blue-600 truncate">
                            {election.title}
                          </p>
                          <div className="ml-2 flex-shrink-0 flex">
                            <p
                              className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusBadgeClass(
                                election.status
                              )}`}
                            >
                              {election.status}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center text-sm text-theme-text-muted">
                          <svg
                            className="flex-shrink-0 mr-1.5 h-5 w-5 text-theme-text-muted"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                          <span>
                            {formatDate(election.start_date, tz)} - {formatDate(election.end_date, tz)}
                          </span>
                        </div>
                        {election.positions && election.positions.length > 0 && (
                          <div className="mt-2 flex items-center text-sm text-theme-text-muted">
                            <span className="font-medium mr-2">Positions:</span>
                            {election.positions.join(', ')}
                          </div>
                        )}
                        {election.total_votes !== undefined && (
                          <div className="mt-2 text-sm text-theme-text-muted">
                            {election.total_votes} {election.total_votes === 1 ? 'vote' : 'votes'} cast
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-election-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
        >
          <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-theme-surface-border">
              <h3 id="create-election-title" className="text-lg font-medium text-theme-text-primary">Create New Election</h3>
            </div>

            <form onSubmit={handleCreateElection} className="px-6 py-4">
              {createError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded p-3" role="alert">
                  <p className="text-sm text-red-700 dark:text-red-300">{createError}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label htmlFor="election-title" className="block text-sm font-medium text-theme-text-primary">
                    Title <span aria-hidden="true">*</span>
                  </label>
                  <input
                    type="text"
                    id="election-title"
                    required
                    aria-required="true"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="election-description" className="block text-sm font-medium text-theme-text-primary">
                    Description
                  </label>
                  <textarea
                    id="election-description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="election-start-date" className="block text-sm font-medium text-theme-text-primary">
                      Start Date & Time <span aria-hidden="true">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      step="900"
                      id="election-start-date"
                      required
                      aria-required="true"
                      value={formData.start_date}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="election-end-date" className="block text-sm font-medium text-theme-text-primary">
                      End Date & Time <span aria-hidden="true">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      step="900"
                      id="election-end-date"
                      required
                      aria-required="true"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                      className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />

                    {formData.start_date && (
                      <div className="mt-2">
                        <p className="text-xs text-theme-text-muted mb-2">Quick duration:</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setDuration(1)}
                            className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded hover:bg-theme-surface-hover"
                          >
                            1 Hour
                          </button>
                          <button
                            type="button"
                            onClick={() => setDuration(2)}
                            className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded hover:bg-theme-surface-hover"
                          >
                            2 Hours
                          </button>
                          <button
                            type="button"
                            onClick={() => setDuration(4)}
                            className="px-3 py-1 text-xs bg-theme-surface text-theme-text-secondary rounded hover:bg-theme-surface-hover"
                          >
                            4 Hours
                          </button>
                          <button
                            type="button"
                            onClick={() => setEndOfDay()}
                            className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/30"
                          >
                            End of Day (Default)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="election-position-input" className="block text-sm font-medium text-theme-text-primary mb-2">
                    Positions
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      id="election-position-input"
                      value={positionInput}
                      onChange={(e) => setPositionInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addPosition())}
                      placeholder="e.g., Chief, President"
                      aria-label="Position name"
                      className="flex-1 bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={addPosition}
                      className="px-4 py-2 bg-theme-surface-hover text-theme-text-primary rounded-md hover:bg-theme-surface-hover"
                    >
                      Add
                    </button>
                  </div>
                  {formData.positions && formData.positions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formData.positions.map((position) => (
                        <span
                          key={position}
                          className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400"
                        >
                          {position}
                          <button
                            type="button"
                            onClick={() => removePosition(position)}
                            className="ml-2 text-blue-600 hover:text-blue-800"
                            aria-label={`Remove position ${position}`}
                          >
                            <span aria-hidden="true">×</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="election-voting-method" className="block text-sm font-medium text-theme-text-primary">
                    How is the Winner Determined?
                  </label>
                  <select
                    id="election-voting-method"
                    value={`${formData.voting_method}|${formData.victory_condition}`}
                    onChange={(e) => {
                      const [method, condition] = e.target.value.split('|') as [VotingMethod, VictoryCondition];
                      setFormData({ ...formData, voting_method: method, victory_condition: condition, victory_percentage: undefined, victory_threshold: undefined });
                    }}
                    className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="simple_majority|most_votes">Most Votes Wins (Plurality)</option>
                    <option value="simple_majority|majority">Majority Required (&gt;50%)</option>
                    <option value="simple_majority|supermajority">Supermajority Required (2/3)</option>
                    <option value="ranked_choice|majority">Ranked Choice Voting</option>
                    <option value="approval|most_votes">Approval Voting (Yes/No per candidate)</option>
                    <option value="simple_majority|threshold">Custom Threshold</option>
                  </select>
                  <p className="mt-1 text-xs text-theme-text-muted">
                    {formData.voting_method === 'ranked_choice'
                      ? 'Voters rank candidates in order of preference. Lowest-ranked candidates are eliminated until one has a majority.'
                      : formData.voting_method === 'approval'
                      ? 'Voters approve or disapprove each candidate. The candidate with the most approvals wins.'
                      : formData.victory_condition === 'majority'
                      ? 'Each voter picks one candidate. Winner must receive more than 50% of the votes.'
                      : formData.victory_condition === 'supermajority'
                      ? 'Each voter picks one candidate. Winner must receive at least 2/3 of the votes.'
                      : formData.victory_condition === 'threshold'
                      ? 'Each voter picks one candidate. Winner must meet the custom threshold you set below.'
                      : 'Each voter picks one candidate. The candidate with the most votes wins, even without a majority.'}
                  </p>
                </div>

                {formData.victory_condition === 'threshold' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="election-num-threshold" className="block text-sm font-medium text-theme-text-primary">
                        Numerical Threshold
                      </label>
                      <input
                        type="number"
                        id="election-num-threshold"
                        min="1"
                        value={formData.victory_threshold || ''}
                        onChange={(e) => setFormData({ ...formData, victory_threshold: e.target.value ? parseInt(e.target.value) : undefined })}
                        placeholder="e.g., 10 votes required"
                        aria-label="Numerical threshold"
                        className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="mt-1 text-xs text-theme-text-muted">Minimum votes needed to win</p>
                    </div>

                    <div>
                      <label htmlFor="election-pct-threshold" className="block text-sm font-medium text-theme-text-primary">
                        Percentage Threshold
                      </label>
                      <input
                        type="number"
                        id="election-pct-threshold"
                        min="1"
                        max="100"
                        value={formData.victory_percentage || ''}
                        onChange={(e) => setFormData({ ...formData, victory_percentage: e.target.value ? parseInt(e.target.value) : undefined })}
                        placeholder="e.g., 60%"
                        aria-label="Percentage threshold"
                        className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                      <p className="mt-1 text-xs text-theme-text-muted">Percentage of votes needed to win</p>
                    </div>
                  </div>
                )}

                {formData.victory_condition === 'supermajority' && (
                  <div>
                    <label htmlFor="election-supermajority-pct" className="block text-sm font-medium text-theme-text-primary">
                      Supermajority Percentage (default: 67%)
                    </label>
                    <input
                      type="number"
                      id="election-supermajority-pct"
                      min="51"
                      max="100"
                      value={formData.victory_percentage || 67}
                      onChange={(e) => setFormData({ ...formData, victory_percentage: e.target.value ? parseInt(e.target.value) : 67 })}
                      className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="mt-1 text-xs text-theme-text-muted">Percentage of votes needed (typically 67% for 2/3 majority)</p>
                  </div>
                )}

                <div className="border-t border-theme-surface-border pt-4">
                  <label className="flex items-center mb-3">
                    <input
                      type="checkbox"
                      id="election-enable-runoffs"
                      checked={formData.enable_runoffs}
                      onChange={(e) => setFormData({ ...formData, enable_runoffs: e.target.checked })}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-input-border rounded"
                    />
                    <span className="ml-2 text-sm font-medium text-theme-text-primary">Enable Automatic Runoffs</span>
                  </label>

                  {formData.enable_runoffs && (
                    <div className="ml-6 space-y-3 bg-theme-surface-secondary p-3 rounded">
                      <div>
                        <label htmlFor="election-runoff-type" className="block text-sm font-medium text-theme-text-primary">
                          Runoff Type
                        </label>
                        <select
                          id="election-runoff-type"
                          value={formData.runoff_type}
                          onChange={(e) => setFormData({ ...formData, runoff_type: e.target.value })}
                          className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="top_two">Top Two (top 2 candidates advance)</option>
                          <option value="eliminate_lowest">Eliminate Lowest (remove lowest, others continue)</option>
                        </select>
                        <p className="mt-1 text-xs text-theme-text-muted">
                          How to handle runoffs when no candidate meets victory condition
                        </p>
                      </div>

                      <div>
                        <label htmlFor="election-max-runoff-rounds" className="block text-sm font-medium text-theme-text-primary">
                          Maximum Runoff Rounds
                        </label>
                        <input
                          type="number"
                          id="election-max-runoff-rounds"
                          min="1"
                          max="10"
                          value={formData.max_runoff_rounds}
                          onChange={(e) => setFormData({ ...formData, max_runoff_rounds: parseInt(e.target.value) || 3 })}
                          className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="mt-1 text-xs text-theme-text-muted">Maximum number of runoff rounds before declaring winner</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      id="election-anonymous"
                      checked={formData.anonymous_voting}
                      onChange={(e) =>
                        setFormData({ ...formData, anonymous_voting: e.target.checked })
                      }
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-input-border rounded"
                    />
                    <span className="ml-2 text-sm text-theme-text-primary">Anonymous Voting</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      id="election-write-ins"
                      checked={formData.allow_write_ins}
                      onChange={(e) =>
                        setFormData({ ...formData, allow_write_ins: e.target.checked })
                      }
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-input-border rounded"
                    />
                    <span className="ml-2 text-sm text-theme-text-primary">Allow Write-in Candidates</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      id="election-results-visible"
                      checked={formData.results_visible_immediately}
                      onChange={(e) =>
                        setFormData({ ...formData, results_visible_immediately: e.target.checked })
                      }
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-theme-input-border rounded"
                    />
                    <span className="ml-2 text-sm text-theme-text-primary">Show Results Immediately</span>
                  </label>
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Create Election
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </div>
  );
};

export default ElectionsPage;
