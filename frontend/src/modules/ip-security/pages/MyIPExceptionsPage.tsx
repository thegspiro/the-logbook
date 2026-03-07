/**
 * My IP Exceptions Page
 *
 * Allows any authenticated user to view their IP exceptions and request new ones.
 */

import React, { useEffect, useState } from 'react';
import { Shield, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useIPSecurityStore } from '../store/ipSecurityStore';
import { IPExceptionTable } from '../components/IPExceptionTable';
import { IPExceptionRequestForm } from '../components/IPExceptionRequestForm';
import type { IPExceptionRequestCreate } from '../types';

const MyIPExceptionsPage: React.FC = () => {
  const {
    myExceptions,
    isLoading,
    isSaving,
    error,
    fetchMyExceptions,
    requestException,
    clearError,
  } = useIPSecurityStore();

  const [showForm, setShowForm] = useState(false);
  const [includeExpired, setIncludeExpired] = useState(false);

  useEffect(() => {
    void fetchMyExceptions(includeExpired);
  }, [fetchMyExceptions, includeExpired]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const handleRequestSubmit = async (data: IPExceptionRequestCreate) => {
    try {
      await requestException(data);
      toast.success('IP exception request submitted');
      setShowForm(false);
    } catch {
      // Error already handled in store
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 rounded-lg p-2">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-theme-text-primary">My IP Exceptions</h1>
              <p className="text-sm text-theme-text-muted">
                Request and manage IP address exceptions for geo-blocked access
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {showForm ? 'Cancel' : 'New Request'}
            </button>
            <button
              onClick={() => { void fetchMyExceptions(includeExpired); }}
              className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Request Form */}
        {showForm && (
          <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-theme-text-primary mb-4">Request IP Exception</h2>
            <IPExceptionRequestForm
              onSubmit={handleRequestSubmit}
              isSaving={isSaving}
            />
          </div>
        )}

        {/* Filter */}
        <div className="mb-4 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={includeExpired}
              onChange={(e) => setIncludeExpired(e.target.checked)}
              className="rounded border-theme-surface-border"
            />
            Show expired/rejected/revoked
          </label>
        </div>

        {/* Exceptions Table */}
        <div className="bg-theme-surface border border-theme-surface-border rounded-xl overflow-hidden">
          <IPExceptionTable exceptions={myExceptions} />
        </div>
      </div>
    </div>
  );
};

export default MyIPExceptionsPage;
