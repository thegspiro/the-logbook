/**
 * Data Whitelist Tab
 *
 * Allows admins to control which data fields are exposed via the public API.
 * Organized by category for easy management.
 */

import React, { useState, useMemo } from 'react';
import { useDataWhitelist } from '../hooks/usePublicPortal';
import type { PublicPortalDataWhitelist } from '../types';

interface CategorySectionProps {
  category: string;
  fields: PublicPortalDataWhitelist[];
  onToggle: (entryId: string, isEnabled: boolean) => Promise<void>;
}

const CategorySection: React.FC<CategorySectionProps> = ({ category, fields, onToggle }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const enabledCount = fields.filter((f) => f.is_enabled).length;
  const totalCount = fields.length;

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'organization':
        return (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
        );
      case 'statistics':
        return (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        );
      case 'events':
        return (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        );
      default:
        return (
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
        );
    }
  };

  const formatCategoryName = (category: string) => {
    return category
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border">
      {/* Category Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-theme-surface-secondary hover:bg-theme-surface-hover flex w-full items-center justify-between px-6 py-4 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="text-theme-text-secondary">{getCategoryIcon(category)}</div>
          <div className="text-left">
            <h4 className="text-theme-text-primary text-sm font-semibold">{formatCategoryName(category)}</h4>
            <p className="text-theme-text-muted text-xs">
              {enabledCount} of {totalCount} fields enabled
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <div className="bg-theme-surface-border h-2 w-24 rounded-full">
              <div
                className="h-2 rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${(enabledCount / totalCount) * 100}%` }}
              />
            </div>
            <span className="text-theme-text-muted w-10 text-right text-xs">
              {Math.round((enabledCount / totalCount) * 100)}%
            </span>
          </div>
          <svg
            className={`text-theme-text-muted h-5 w-5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Fields List */}
      {isExpanded && (
        <div className="divide-theme-surface-border divide-y">
          {fields.map((field) => (
            <div key={field.id} className="hover:bg-theme-surface-hover px-6 py-4 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <code className="text-theme-text-primary font-mono text-sm">{field.field_name}</code>
                    {field.is_sensitive && (
                      <span className="rounded-sm bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">
                        PII
                      </span>
                    )}
                  </div>
                  {field.description && <p className="text-theme-text-muted mt-1 text-xs">{field.description}</p>}
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={field.is_enabled}
                    onChange={(e) => {
                      void onToggle(field.id, e.target.checked);
                    }}
                    className="peer sr-only"
                  />
                  <div className="bg-theme-surface-border peer dark:after:bg-theme-surface-modal after:border-theme-surface-border h-6 w-11 rounded-full peer-checked:bg-blue-600 peer-focus:ring-4 peer-focus:ring-blue-300 peer-focus:outline-hidden after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:peer-focus:ring-blue-800"></div>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const DataWhitelistTab: React.FC = () => {
  const { whitelist, loading, error, toggleField } = useDataWhitelist();
  const [searchTerm, setSearchTerm] = useState('');

  // Group fields by category
  const fieldsByCategory = useMemo(() => {
    const filtered = whitelist.filter(
      (field) =>
        field.field_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        field.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        field.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const grouped: Record<string, PublicPortalDataWhitelist[]> = {};
    filtered.forEach((field) => {
      if (!grouped[field.category]) {
        grouped[field.category] = [];
      }
      const categoryGroup = grouped[field.category];
      if (categoryGroup) {
        categoryGroup.push(field);
      }
    });

    // Sort fields within each category by field name
    Object.keys(grouped).forEach((category) => {
      const categoryGroup = grouped[category];
      if (categoryGroup) {
        categoryGroup.sort((a, b) => a.field_name.localeCompare(b.field_name));
      }
    });

    return grouped;
  }, [whitelist, searchTerm]);

  const categories = Object.keys(fieldsByCategory).sort();

  // Calculate overall statistics
  const totalFields = whitelist.length;
  const enabledFields = whitelist.filter((f) => f.is_enabled).length;
  const sensitiveEnabled = whitelist.filter((f) => f.is_enabled && f.is_sensitive).length;

  const handleToggle = async (entryId: string, isEnabled: boolean) => {
    await toggleField(entryId, isEnabled);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
        <p className="text-red-800 dark:text-red-400">Error loading data whitelist: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Data Exposure Control</h3>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Control which data fields are accessible via the public API
        </p>
      </div>

      {/* Security Warning */}
      <div className="border-l-4 border-yellow-400 bg-yellow-500/10 p-4">
        <div className="flex">
          <div className="shrink-0">
            <svg className="h-5 w-5 text-yellow-700 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-yellow-700 dark:text-yellow-400">
              <strong>Privacy Notice:</strong> Only enable fields that are intended for public consumption. Fields
              marked as PII contain personally identifiable information and should be carefully reviewed before
              enabling.
              {sensitiveEnabled > 0 && (
                <span className="mt-1 block font-semibold">
                  ⚠️ You currently have {sensitiveEnabled} sensitive field{sensitiveEnabled !== 1 ? 's' : ''} enabled.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-theme-text-secondary text-sm">Total Fields</p>
              <p className="text-theme-text-primary text-2xl font-semibold">{totalFields}</p>
            </div>
            <div className="rounded-lg bg-blue-100 p-3 dark:bg-blue-500/20">
              <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-theme-text-secondary text-sm">Enabled</p>
              <p className="text-theme-text-primary text-2xl font-semibold">
                {enabledFields}
                <span className="text-theme-text-muted ml-2 text-sm">
                  ({Math.round((enabledFields / totalFields) * 100)}%)
                </span>
              </p>
            </div>
            <div className="rounded-lg bg-green-100 p-3 dark:bg-green-500/20">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-theme-text-secondary text-sm">Sensitive (PII)</p>
              <p className="text-theme-text-primary text-2xl font-semibold">
                {sensitiveEnabled}
                <span className="text-theme-text-muted ml-2 text-sm">enabled</span>
              </p>
            </div>
            <div
              className={`rounded-lg p-3 ${sensitiveEnabled > 0 ? 'bg-yellow-100 dark:bg-yellow-500/20' : 'bg-theme-surface-secondary'}`}
            >
              <svg
                className={`h-6 w-6 ${sensitiveEnabled > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-theme-text-secondary'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div>
        <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Search Fields</label>
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search by field name, category, or description..."
            placeholder="Search by field name, category, or description..."
            className="border-theme-surface-border focus:ring-theme-focus-ring w-full rounded-md border px-4 py-2 pl-10 focus:ring-2 focus:outline-hidden"
          />
          <svg
            className="text-theme-text-muted absolute top-2.5 left-3 h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {/* Categories */}
      {categories.length === 0 ? (
        <div className="bg-theme-surface-secondary border-theme-surface-border rounded-md border p-8 text-center">
          <svg
            className="text-theme-text-muted mx-auto h-12 w-12"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <h3 className="text-theme-text-primary mt-2 text-sm font-medium">No fields found</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            {searchTerm ? 'Try a different search term' : 'No data fields available'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((category) => (
            <CategorySection
              key={category}
              category={category}
              fields={fieldsByCategory[category] ?? []}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {/* Help Text */}
      <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-4">
        <div className="flex">
          <div className="shrink-0">
            <svg className="h-5 w-5 text-blue-700 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-700 dark:text-blue-300">How it works</h3>
            <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
              <p>
                Only fields that are enabled will be returned in public API responses. Use this to control exactly what
                information is shared with external applications. Changes take effect immediately.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
