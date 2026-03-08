/**
 * Grant Opportunities Page
 *
 * Searchable library of grant opportunities with category filtering,
 * deadline urgency indicators, and pre-loaded federal programs.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  BookOpen,
  Calendar,
  DollarSign,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Shield,
  Loader2,
  Landmark,
} from 'lucide-react';
import { grantsService } from '../services/api';
import type { GrantOpportunity, GrantCategory } from '../types';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  staffing: 'Staffing',
  training: 'Training',
  prevention: 'Prevention',
  facilities: 'Facilities',
  vehicles: 'Vehicles',
  wellness: 'Wellness',
  community: 'Community',
  other: 'Other',
};

const CATEGORY_COLORS: Record<string, string> = {
  equipment: 'bg-blue-100 text-blue-800',
  staffing: 'bg-purple-100 text-purple-800',
  training: 'bg-green-100 text-green-800',
  prevention: 'bg-orange-100 text-orange-800',
  facilities: 'bg-indigo-100 text-indigo-800',
  vehicles: 'bg-red-100 text-red-800',
  wellness: 'bg-teal-100 text-teal-800',
  community: 'bg-yellow-100 text-yellow-800',
  other: 'bg-gray-100 text-gray-800',
};

interface FederalProgram {
  name: string;
  code: string;
  agency: string;
  description: string;
  category: GrantCategory;
}

const FEDERAL_PROGRAMS: FederalProgram[] = [
  {
    name: 'Assistance to Firefighters Grant (AFG)',
    code: 'AFG',
    agency: 'FEMA',
    description:
      'Provides funding for critically needed resources to equip and train emergency personnel, enhancing their capabilities to protect the public and reduce firefighter injuries.',
    category: 'equipment',
  },
  {
    name: 'Staffing for Adequate Fire and Emergency Response (SAFER)',
    code: 'SAFER',
    agency: 'FEMA',
    description:
      'Provides funding to help fire departments increase or maintain the number of trained firefighters available in their communities.',
    category: 'staffing',
  },
  {
    name: 'Fire Prevention & Safety (FP&S)',
    code: 'FP&S',
    agency: 'FEMA',
    description:
      'Supports projects that enhance the safety of the public and firefighters from fire and related hazards through prevention and safety activities.',
    category: 'prevention',
  },
  {
    name: 'Firehouse Subs Public Safety Foundation',
    code: 'FIREHOUSE_SUBS',
    agency: 'Firehouse Subs Foundation',
    description:
      'Provides funding for life-saving equipment, prevention education, scholarships, and continued training for first responders.',
    category: 'equipment',
  },
];

/** Returns urgency info based on how close the deadline is. */
function getDeadlineUrgency(deadlineDate: string | null): {
  label: string;
  color: string;
  isUrgent: boolean;
} {
  if (!deadlineDate) {
    return { label: 'Rolling', color: 'text-theme-text-muted', isUrgent: false };
  }
  const now = new Date();
  const deadline = new Date(deadlineDate);
  const daysLeft = Math.ceil(
    (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysLeft < 0) {
    return { label: 'Expired', color: 'text-gray-400', isUrgent: false };
  }
  if (daysLeft <= 14) {
    return {
      label: `${daysLeft}d left`,
      color: 'text-red-600 dark:text-red-400',
      isUrgent: true,
    };
  }
  if (daysLeft <= 30) {
    return {
      label: `${daysLeft}d left`,
      color: 'text-yellow-600 dark:text-yellow-400',
      isUrgent: false,
    };
  }
  return {
    label: formatDate(deadlineDate),
    color: 'text-theme-text-secondary',
    isUrgent: false,
  };
}

export const GrantOpportunitiesPage: React.FC = () => {
  const navigate = useNavigate();
  const [opportunities, setOpportunities] = useState<GrantOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadOpportunities = async () => {
      try {
        setIsLoading(true);
        const params: { isActive: true; search?: string; category?: string } = { isActive: true };
        if (search) params.search = search;
        if (categoryFilter) params.category = categoryFilter;
        const data = await grantsService.listOpportunities(params);
        setOpportunities(data);
      } catch {
        setError('Failed to load grant opportunities.');
      } finally {
        setIsLoading(false);
      }
    };
    void loadOpportunities();
  }, [search, categoryFilter]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredOpportunities = useMemo(() => {
    let list = opportunities;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.agency.toLowerCase().includes(q),
      );
    }
    if (categoryFilter) {
      list = list.filter((o) => o.category === categoryFilter);
    }
    return list;
  }, [opportunities, search, categoryFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Grant Opportunities
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Browse and apply to available grant programs
          </p>
        </div>
        <button
          onClick={() => navigate('/grants/opportunities/new')}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Opportunity
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-text-secondary" />
          <input
            type="text"
            placeholder="Search by name or agency..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-theme-surface-border bg-theme-surface py-2 pl-10 pr-4 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary focus:border-red-500 focus:outline-none"
        >
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {/* Federal Programs Section */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Landmark className="h-5 w-5 text-theme-text-muted" />
          <h2 className="text-lg font-semibold text-theme-text-primary">
            Federal Programs
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {FEDERAL_PROGRAMS.map((program) => (
            <div
              key={program.code}
              className="rounded-lg border border-theme-surface-border bg-theme-surface p-4"
            >
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-theme-text-primary">
                    {program.name}
                  </h3>
                  <p className="text-xs text-theme-text-secondary">
                    {program.agency}
                  </p>
                </div>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[program.category] ?? 'bg-gray-100 text-gray-800'}`}
                >
                  {CATEGORY_LABELS[program.category] ?? program.category}
                </span>
              </div>
              <p className="text-sm text-theme-text-secondary">
                {program.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Opportunities Grid */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-theme-text-primary">
          All Opportunities
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
          </div>
        ) : filteredOpportunities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <BookOpen className="mb-3 h-12 w-12 text-theme-text-secondary opacity-40" />
            <p className="text-theme-text-secondary">
              No grant opportunities found
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredOpportunities.map((opp) => {
              const isExpanded = expandedIds.has(opp.id);
              const urgency = getDeadlineUrgency(opp.deadlineDate);

              return (
                <div
                  key={opp.id}
                  className="rounded-lg border border-theme-surface-border bg-theme-surface p-4"
                >
                  {/* Card Header */}
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-theme-text-primary truncate">
                        {opp.name}
                      </h3>
                      <p className="text-xs text-theme-text-secondary">
                        {opp.agency}
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[opp.category] ?? 'bg-gray-100 text-gray-800'}`}
                    >
                      {CATEGORY_LABELS[opp.category] ?? opp.category}
                    </span>
                  </div>

                  {/* Award Range */}
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                    <span className="text-theme-text-primary">
                      {opp.typicalAwardMin != null && opp.typicalAwardMax != null
                        ? `${formatCurrency(opp.typicalAwardMin)} - ${formatCurrency(opp.typicalAwardMax)}`
                        : opp.typicalAwardMax != null
                          ? `Up to ${formatCurrency(opp.typicalAwardMax)}`
                          : opp.typicalAwardMin != null
                            ? `From ${formatCurrency(opp.typicalAwardMin)}`
                            : 'Varies'}
                    </span>
                  </div>

                  {/* Deadline */}
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-theme-text-muted shrink-0" />
                    <span className={urgency.color}>
                      {opp.deadlineDate ? formatDate(opp.deadlineDate) : 'Rolling deadline'}
                    </span>
                    {urgency.isUrgent && (
                      <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        <AlertTriangle className="h-3 w-3" />
                        {urgency.label}
                      </span>
                    )}
                  </div>

                  {/* Match Required */}
                  {opp.matchRequired && (
                    <div className="mb-3 flex items-center gap-2 text-sm">
                      <Shield className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="text-amber-700 dark:text-amber-400">
                        Match required
                        {opp.matchPercentage != null
                          ? ` (${opp.matchPercentage}%)`
                          : ''}
                      </span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/grants/applications/new?opportunity_id=${opp.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Apply
                    </Link>
                    <button
                      onClick={() => toggleExpand(opp.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-theme-surface-hover px-3 py-1.5 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          Hide Details
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Details
                        </>
                      )}
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="mt-3 border-t border-theme-surface-border pt-3 space-y-2 text-sm">
                      {opp.description && (
                        <div>
                          <p className="text-xs font-medium uppercase text-theme-text-muted mb-1">
                            Description
                          </p>
                          <p className="text-theme-text-secondary">
                            {opp.description}
                          </p>
                        </div>
                      )}
                      {opp.eligibleUses && (
                        <div>
                          <p className="text-xs font-medium uppercase text-theme-text-muted mb-1">
                            Eligible Uses
                          </p>
                          <p className="text-theme-text-secondary">
                            {opp.eligibleUses}
                          </p>
                        </div>
                      )}
                      {opp.eligibilityCriteria && (
                        <div>
                          <p className="text-xs font-medium uppercase text-theme-text-muted mb-1">
                            Eligibility Criteria
                          </p>
                          <p className="text-theme-text-secondary">
                            {opp.eligibilityCriteria}
                          </p>
                        </div>
                      )}
                      {opp.matchDescription && (
                        <div>
                          <p className="text-xs font-medium uppercase text-theme-text-muted mb-1">
                            Match Details
                          </p>
                          <p className="text-theme-text-secondary">
                            {opp.matchDescription}
                          </p>
                        </div>
                      )}
                      {opp.applicationUrl && (
                        <a
                          href={opp.applicationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Application Website
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default GrantOpportunitiesPage;
