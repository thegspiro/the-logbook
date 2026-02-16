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
  const enabledCount = fields.filter(f => f.is_enabled).length;
  const totalCount = fields.length;

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case 'organization':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        );
      case 'statistics':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        );
      case 'events':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        );
    }
  };

  const formatCategoryName = (category: string) => {
    return category
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-lg overflow-hidden">
      {/* Category Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between bg-theme-surface-secondary hover:bg-theme-surface-hover transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="text-theme-text-secondary">
            {getCategoryIcon(category)}
          </div>
          <div className="text-left">
            <h4 className="text-sm font-semibold text-theme-text-primary">
              {formatCategoryName(category)}
            </h4>
            <p className="text-xs text-theme-text-muted">
              {enabledCount} of {totalCount} fields enabled
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <div className="w-24 bg-theme-surface-border rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(enabledCount / totalCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-theme-text-muted w-10 text-right">
              {Math.round((enabledCount / totalCount) * 100)}%
            </span>
          </div>
          <svg
            className={`w-5 h-5 text-theme-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
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
        <div className="divide-y divide-theme-surface-border">
          {fields.map((field) => (
            <div
              key={field.id}
              className="px-6 py-4 hover:bg-theme-surface-hover transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <code className="text-sm font-mono text-theme-text-primary">
                      {field.field_name}
                    </code>
                    {field.is_sensitive && (
                      <span className="px-2 py-0.5 text-xs font-semibold rounded bg-yellow-100 text-yellow-800">
                        PII
                      </span>
                    )}
                  </div>
                  {field.description && (
                    <p className="text-xs text-theme-text-muted mt-1">
                      {field.description}
                    </p>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.is_enabled}
                    onChange={(e) => onToggle(field.id, e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-theme-surface-border peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-theme-surface-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
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
    const filtered = whitelist.filter(field =>
      field.field_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      field.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      field.description?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const grouped: Record<string, PublicPortalDataWhitelist[]> = {};
    filtered.forEach(field => {
      if (!grouped[field.category]) {
        grouped[field.category] = [];
      }
      grouped[field.category].push(field);
    });

    // Sort fields within each category by field name
    Object.keys(grouped).forEach(category => {
      grouped[category].sort((a, b) => a.field_name.localeCompare(b.field_name));
    });

    return grouped;
  }, [whitelist, searchTerm]);

  const categories = Object.keys(fieldsByCategory).sort();

  // Calculate overall statistics
  const totalFields = whitelist.length;
  const enabledFields = whitelist.filter(f => f.is_enabled).length;
  const sensitiveEnabled = whitelist.filter(f => f.is_enabled && f.is_sensitive).length;

  const handleToggle = async (entryId: string, isEnabled: boolean) => {
    await toggleField(entryId, isEnabled);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <p className="text-red-800">Error loading data whitelist: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Data Exposure Control</h3>
        <p className="text-sm text-theme-text-secondary mt-1">
          Control which data fields are accessible via the public API
        </p>
      </div>

      {/* Security Warning */}
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-700 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-yellow-700">
              <strong>Privacy Notice:</strong> Only enable fields that are intended for public consumption.
              Fields marked as PII contain personally identifiable information and should be carefully reviewed
              before enabling.
              {sensitiveEnabled > 0 && (
                <span className="block mt-1 font-semibold">
                  ⚠️ You currently have {sensitiveEnabled} sensitive field{sensitiveEnabled !== 1 ? 's' : ''} enabled.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-text-secondary">Total Fields</p>
              <p className="text-2xl font-semibold text-theme-text-primary">{totalFields}</p>
            </div>
            <div className="p-3 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-text-secondary">Enabled</p>
              <p className="text-2xl font-semibold text-theme-text-primary">
                {enabledFields}
                <span className="text-sm text-theme-text-muted ml-2">
                  ({Math.round((enabledFields / totalFields) * 100)}%)
                </span>
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-text-secondary">Sensitive (PII)</p>
              <p className="text-2xl font-semibold text-theme-text-primary">
                {sensitiveEnabled}
                <span className="text-sm text-theme-text-muted ml-2">enabled</span>
              </p>
            </div>
            <div className={`p-3 rounded-lg ${sensitiveEnabled > 0 ? 'bg-yellow-100' : 'bg-theme-surface-secondary'}`}>
              <svg className={`w-6 h-6 ${sensitiveEnabled > 0 ? 'text-yellow-600' : 'text-theme-text-secondary'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div>
        <label className="block text-sm font-medium text-theme-text-secondary mb-2">
          Search Fields
        </label>
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by field name, category, or description..."
            className="w-full px-4 py-2 pl-10 border border-theme-surface-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <svg
            className="absolute left-3 top-2.5 h-5 w-5 text-theme-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Categories */}
      {categories.length === 0 ? (
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-md p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-theme-text-primary">No fields found</h3>
          <p className="mt-1 text-sm text-theme-text-muted">
            {searchTerm ? 'Try a different search term' : 'No data fields available'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((category) => (
            <CategorySection
              key={category}
              category={category}
              fields={fieldsByCategory[category]}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {/* Help Text */}
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-700 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">How it works</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                Only fields that are enabled will be returned in public API responses. Use this to control
                exactly what information is shared with external applications. Changes take effect immediately.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
