/**
 * Campaigns Page
 *
 * Manages fundraising campaigns with search, filters, inline creation form,
 * and campaign cards showing progress toward goals.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Megaphone,
  Plus,
  Search,
  X,
  DollarSign,
  Calendar,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { fundraisingService } from '../services/api';
import type { FundraisingCampaign } from '../types';
import { CAMPAIGN_STATUS_COLORS } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  general: 'General',
  equipment: 'Equipment',
  training: 'Training',
  community: 'Community',
  memorial: 'Memorial',
  event: 'Event',
  other: 'Other',
};

const CAMPAIGN_TYPE_COLORS: Record<string, string> = {
  general: 'bg-gray-100 text-gray-700',
  equipment: 'bg-blue-100 text-blue-700',
  training: 'bg-green-100 text-green-700',
  community: 'bg-yellow-100 text-yellow-700',
  memorial: 'bg-purple-100 text-purple-700',
  event: 'bg-indigo-100 text-indigo-700',
  other: 'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_OPTIONS = ['draft', 'active', 'paused', 'completed', 'cancelled'] as const;
const TYPE_OPTIONS = ['general', 'equipment', 'training', 'community', 'memorial', 'event', 'other'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

const formatDate = (dateStr: string): string =>
  new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

// ---------------------------------------------------------------------------
// Inline Create Form
// ---------------------------------------------------------------------------

interface CreateFormData {
  name: string;
  description: string;
  campaign_type: string;
  goal_amount: string;
  start_date: string;
  status: string;
}

const INITIAL_FORM: CreateFormData = {
  name: '',
  description: '',
  campaign_type: 'general',
  goal_amount: '',
  start_date: '',
  status: 'draft',
};

const inputClass =
  'w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';

const labelClass = 'block text-sm font-medium text-theme-text-primary mb-1';

const selectClass =
  'w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CampaignsPage: React.FC = () => {
  const [campaigns, setCampaigns] = useState<FundraisingCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState<CreateFormData>(INITIAL_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- Data fetching ----

  const loadCampaigns = useCallback(async () => {
    try {
      setIsLoading(true);
      const params: { status?: string; campaignType?: string } = {};
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.campaignType = typeFilter;
      const data = await fundraisingService.listCampaigns(params);
      setCampaigns(data);
    } catch {
      toast.error('Failed to load campaigns');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  // ---- Client-side search ----

  const filteredCampaigns = useMemo(() => {
    if (!searchQuery.trim()) return campaigns;
    const query = searchQuery.toLowerCase();
    return campaigns.filter((c) => c.name.toLowerCase().includes(query));
  }, [campaigns, searchQuery]);

  // ---- Form handlers ----

  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Campaign name is required');
      return;
    }

    if (!formData.goal_amount || Number(formData.goal_amount) <= 0) {
      toast.error('Goal amount must be greater than zero');
      return;
    }

    if (!formData.start_date) {
      toast.error('Start date is required');
      return;
    }

    try {
      setIsSubmitting(true);
      await fundraisingService.createCampaign({
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        campaignType: formData.campaign_type as FundraisingCampaign['campaignType'],
        goalAmount: Number(formData.goal_amount),
        startDate: formData.start_date,
        status: formData.status as FundraisingCampaign['status'],
      });
      toast.success('Campaign created successfully');
      setFormData(INITIAL_FORM);
      setShowCreateForm(false);
      void loadCampaigns();
    } catch {
      toast.error('Failed to create campaign');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Fundraising Campaigns
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Manage fundraising campaigns and track progress toward goals
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm((prev) => !prev)}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          {showCreateForm ? (
            <>
              <X className="h-4 w-4" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              New Campaign
            </>
          )}
        </button>
      </div>

      {/* Inline Create Form */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleCreateSubmit(e)}
          className="rounded-lg border border-theme-surface-border bg-theme-surface p-5 space-y-4"
        >
          <h2 className="text-lg font-semibold text-theme-text-primary">
            Create New Campaign
          </h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Name */}
            <div>
              <label htmlFor="create-name" className={labelClass}>
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id="create-name"
                name="name"
                type="text"
                value={formData.name}
                onChange={handleFormChange}
                placeholder="Campaign name"
                className={inputClass}
              />
            </div>

            {/* Campaign Type */}
            <div>
              <label htmlFor="create-campaign-type" className={labelClass}>
                Campaign Type
              </label>
              <select
                id="create-campaign-type"
                name="campaign_type"
                value={formData.campaign_type}
                onChange={handleFormChange}
                className={selectClass}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {CAMPAIGN_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
            </div>

            {/* Goal Amount */}
            <div>
              <label htmlFor="create-goal" className={labelClass}>
                Goal Amount <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-text-secondary" />
                <input
                  id="create-goal"
                  name="goal_amount"
                  type="number"
                  min="1"
                  step="1"
                  value={formData.goal_amount}
                  onChange={handleFormChange}
                  placeholder="0"
                  className={`${inputClass} pl-9`}
                />
              </div>
            </div>

            {/* Start Date */}
            <div>
              <label htmlFor="create-start-date" className={labelClass}>
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                id="create-start-date"
                name="start_date"
                type="date"
                value={formData.start_date}
                onChange={handleFormChange}
                className={inputClass}
              />
            </div>

            {/* Status */}
            <div>
              <label htmlFor="create-status" className={labelClass}>
                Status
              </label>
              <select
                id="create-status"
                name="status"
                value={formData.status}
                onChange={handleFormChange}
                className={selectClass}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s] ?? s}
                  </option>
                ))}
              </select>
            </div>

            {/* Description (full width) */}
            <div className="md:col-span-2">
              <label htmlFor="create-description" className={labelClass}>
                Description
              </label>
              <textarea
                id="create-description"
                name="description"
                rows={3}
                value={formData.description}
                onChange={handleFormChange}
                placeholder="Describe this campaign..."
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setFormData(INITIAL_FORM);
              }}
              className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Campaign
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-text-secondary" />
          <input
            type="text"
            placeholder="Search campaigns by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`${inputClass} pl-10`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-theme-text-secondary hover:text-theme-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={selectClass + ' w-auto'}
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className={selectClass + ' w-auto'}
        >
          <option value="">All Types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {CAMPAIGN_TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-red-500" />
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Megaphone className="mb-3 h-12 w-12 text-theme-text-secondary opacity-40" />
          <p className="text-theme-text-secondary">
            {searchQuery || statusFilter || typeFilter
              ? 'No campaigns match your filters'
              : 'No campaigns yet. Create one to get started!'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredCampaigns.map((campaign) => {
            const progress =
              campaign.goalAmount > 0
                ? Math.min(
                    100,
                    Math.round(
                      (campaign.currentAmount / campaign.goalAmount) * 100,
                    ),
                  )
                : 0;

            return (
              <div
                key={campaign.id}
                className="rounded-lg border border-theme-surface-border bg-theme-surface p-5 space-y-3"
              >
                {/* Campaign Name & Badges */}
                <div>
                  <h3 className="text-lg font-bold text-theme-text-primary">
                    {campaign.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CAMPAIGN_TYPE_COLORS[campaign.campaignType] ?? 'bg-gray-100 text-gray-700'}`}
                    >
                      {CAMPAIGN_TYPE_LABELS[campaign.campaignType] ??
                        campaign.campaignType}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CAMPAIGN_STATUS_COLORS[campaign.status] ?? 'bg-gray-100 text-gray-800'}`}
                    >
                      {STATUS_LABELS[campaign.status] ?? campaign.status}
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-theme-text-primary">
                      {formatCurrency(campaign.currentAmount)}
                    </span>
                    <span className="text-theme-text-secondary">
                      of {formatCurrency(campaign.goalAmount)} ({progress}%)
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className={`h-full rounded-full transition-all ${
                        progress >= 100
                          ? 'bg-green-500'
                          : progress >= 75
                            ? 'bg-blue-500'
                            : progress >= 50
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                      }`}
                      style={{ width: `${String(progress)}%` }}
                    />
                  </div>
                </div>

                {/* Date Range */}
                <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
                  <Calendar className="h-4 w-4 shrink-0" />
                  <span>
                    {formatDate(campaign.startDate)}
                    {campaign.endDate
                      ? ` - ${formatDate(campaign.endDate)}`
                      : ' - Ongoing'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CampaignsPage;
