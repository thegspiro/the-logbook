/**
 * Election Detail Page
 *
 * Shows detailed information about an election including results.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { electionService } from '../services/api';
import type { Election } from '../types/election';
import { ElectionResults } from '../components/ElectionResults';
import { useAuthStore } from '../stores/authStore';

export const ElectionDetailPage: React.FC = () => {
  const { electionId } = useParams<{ electionId: string }>();
  const navigate = useNavigate();
  const [election, setElection] = useState<Election | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('elections.manage');

  useEffect(() => {
    if (electionId) {
      fetchElection();
    }
  }, [electionId]);

  const fetchElection = async () => {
    if (!electionId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await electionService.getElection(electionId);
      setElection(data);

      // Automatically show results if they're available
      if (data.status === 'closed' || data.results_visible_immediately) {
        setShowResults(true);
      }
    } catch (err: any) {
      console.error('Error fetching election:', err);
      setError(err.response?.data?.detail || 'Failed to load election');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleResultsVisibility = async () => {
    if (!electionId || !election) return;

    try {
      setUpdatingVisibility(true);
      const updated = await electionService.updateElection(electionId, {
        results_visible_immediately: !election.results_visible_immediately,
      });
      setElection(updated);
    } catch (err: any) {
      console.error('Error updating visibility:', err);
      alert(err.response?.data?.detail || 'Failed to update visibility');
    } finally {
      setUpdatingVisibility(false);
    }
  };

  const handleOpenElection = async () => {
    if (!electionId) return;

    try {
      const updated = await electionService.openElection(electionId);
      setElection(updated);
    } catch (err: any) {
      console.error('Error opening election:', err);
      alert(err.response?.data?.detail || 'Failed to open election');
    }
  };

  const handleCloseElection = async () => {
    if (!electionId) return;

    if (!confirm('Are you sure you want to close this election? This action cannot be undone.')) {
      return;
    }

    try {
      const updated = await electionService.closeElection(electionId);
      setElection(updated);
      setShowResults(true);
    } catch (err: any) {
      console.error('Error closing election:', err);
      alert(err.response?.data?.detail || 'Failed to close election');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-green-100 text-green-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      case 'draft':
        return 'bg-yellow-100 text-yellow-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">Loading election...</div>
        </div>
      </div>
    );
  }

  if (error || !election) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error || 'Election not found'}</p>
        </div>
      </div>
    );
  }

  const resultsAvailable = election.status === 'closed' || election.results_visible_immediately;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center mb-2">
          <Link to="/elections" className="text-blue-600 hover:text-blue-700 mr-2">
            ← Back to Elections
          </Link>
        </div>
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{election.title}</h2>
            {election.description && (
              <p className="mt-2 text-gray-600">{election.description}</p>
            )}
          </div>
          <span
            className={`px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${getStatusBadgeClass(
              election.status
            )}`}
          >
            {election.status}
          </span>
        </div>
      </div>

      {/* Election Info */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-500">Start Date</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {formatDate(election.start_date)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">End Date</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {formatDate(election.end_date)}
            </div>
          </div>
          {election.positions && election.positions.length > 0 && (
            <div className="col-span-2">
              <div className="text-sm text-gray-500">Positions</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {election.positions.map((position) => (
                  <span
                    key={position}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-800"
                  >
                    {position}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-sm text-gray-500">Voting Method</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {election.voting_method.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Anonymous Voting</div>
            <div className="mt-1 text-sm font-medium text-gray-900">
              {election.anonymous_voting ? 'Yes' : 'No'}
            </div>
          </div>
        </div>

        {/* Secretary Controls */}
        {canManage && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex flex-wrap gap-3">
              {election.status === 'draft' && (
                <button
                  onClick={handleOpenElection}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Open Election
                </button>
              )}

              {election.status === 'open' && (
                <button
                  onClick={handleCloseElection}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Close Election
                </button>
              )}

              <button
                onClick={handleToggleResultsVisibility}
                disabled={updatingVisibility}
                className={`px-4 py-2 rounded-md ${
                  election.results_visible_immediately
                    ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                } disabled:opacity-50`}
              >
                {updatingVisibility
                  ? 'Updating...'
                  : election.results_visible_immediately
                  ? 'Hide Results from Voters'
                  : 'Show Results to Voters'}
              </button>

              {election.email_sent && (
                <div className="flex items-center text-sm text-gray-600">
                  <svg className="h-5 w-5 mr-1 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                    <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                  </svg>
                  Emails sent on {election.email_sent_at ? formatDate(election.email_sent_at) : 'N/A'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Results Toggle for All Users */}
      {resultsAvailable && (
        <div className="mb-6">
          <button
            onClick={() => setShowResults(!showResults)}
            className="w-full bg-white shadow rounded-lg p-4 flex items-center justify-between hover:bg-gray-50"
          >
            <span className="text-lg font-medium text-gray-900">
              {showResults ? 'Hide Results' : 'View Results'}
            </span>
            <svg
              className={`h-6 w-6 text-gray-400 transform transition-transform ${
                showResults ? 'rotate-180' : ''
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Results Display */}
      {showResults && resultsAvailable && electionId && (
        <ElectionResults electionId={electionId} election={election} />
      )}

      {/* Message if results not available */}
      {!resultsAvailable && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-700">
            Results will be available when the election is closed
            {canManage && ' or when you enable "Show Results to Voters"'}.
          </p>
        </div>
      )}
    </div>
  );
};

export default ElectionDetailPage;
