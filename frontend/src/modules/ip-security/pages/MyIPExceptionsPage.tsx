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

  // Resolves false on a refusal so the form keeps what the member typed; the
  // store has already put the reason in `error`, which the effect above toasts.
  const handleRequestSubmit = async (data: IPExceptionRequestCreate): Promise<boolean> => {
    try {
      await requestException(data);
    } catch {
      return false;
    }
    toast.success('IP exception request submitted');
    setShowForm(false);
    return true;
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="page-header mb-6 gap-3 sm:items-center">
          <div className="page-header-title flex items-center gap-3">
            <div className="shrink-0 rounded-lg bg-blue-600 p-2">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">My IP Exceptions</h1>
              <p className="text-theme-text-muted text-sm">Request an IP exception and track its status</p>
            </div>
          </div>
          <div className="page-header-actions flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowForm(!showForm)}
              className="rounded-lg bg-red-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
            >
              {showForm ? 'Cancel' : 'New Request'}
            </button>
            <button
              onClick={() => {
                void fetchMyExceptions(includeExpired);
              }}
              aria-label="Refresh my requests"
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Request Form */}
        {showForm && (
          <div className="card mb-6 p-6">
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
            Show expired, rejected, and revoked requests
          </label>
        </div>

        {/* Exceptions Table */}
        <div className="card overflow-hidden">
          <IPExceptionTable
            exceptions={myExceptions}
            emptyMessage={
              includeExpired
                ? 'You have no IP exceptions. Select New Request to ask for one.'
                : 'You have no pending or approved IP exceptions. Select New Request to ask for one.'
            }
          />
        </div>
      </div>
    </div>
  );
};

export default MyIPExceptionsPage;
