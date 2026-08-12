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
  const { myExceptions, isLoading, isSaving, error, fetchMyExceptions, requestException, clearError } =
    useIPSecurityStore();

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
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-blue-600 p-2">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">My IP Exceptions</h1>
              <p className="text-theme-text-muted text-sm">
                Request and manage IP address exceptions for geo-blocked access
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForm(!showForm)}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              {showForm ? 'Cancel' : 'New Request'}
            </button>
            <button
              onClick={() => {
                void fetchMyExceptions(includeExpired);
              }}
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Request Form */}
        {showForm && (
          <div className="bg-theme-surface border-theme-surface-border mb-6 rounded-xl border p-6">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Request IP Exception</h2>
            <IPExceptionRequestForm onSubmit={handleRequestSubmit} isSaving={isSaving} />
          </div>
        )}

        {/* Filter */}
        <div className="mb-4 flex items-center gap-2">
          <label className="text-theme-text-secondary flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeExpired}
              onChange={(e) => setIncludeExpired(e.target.checked)}
              className="border-theme-surface-border rounded"
            />
            Show expired/rejected/revoked
          </label>
        </div>

        {/* Exceptions Table */}
        <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border">
          <IPExceptionTable exceptions={myExceptions} />
        </div>
      </div>
    </div>
  );
};

export default MyIPExceptionsPage;
