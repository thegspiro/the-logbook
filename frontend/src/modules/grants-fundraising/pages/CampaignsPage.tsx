/**
 * Campaigns Page
 *
 * Manages fundraising campaigns with search, filters, inline creation form,
 * and campaign cards showing progress toward goals.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Megaphone, Plus, Search, X, DollarSign, Calendar, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fundraisingService } from '../services/api';
import type { FundraisingCampaign } from '../types';
import { CAMPAIGN_STATUS_COLORS } from '../types';
import { formatDate } from '../../../utils/dateFormatting';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { useAuthStore } from '../../../stores/authStore';
import { CampaignRestrictionControl } from '../components/CampaignRestrictionControl';
import { getErrorMessage } from '@/utils/errorHandling';

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
  general: 'bg-theme-surface-secondary text-theme-text-secondary',
  equipment: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  training: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  community: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  memorial: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
  event: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400',
  other: 'bg-theme-surface-secondary text-theme-text-secondary',
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
// Inline Create Form
// ---------------------------------------------------------------------------

interface CreateFormData {
  name: string;
  description: string;
  campaign_type: string;
  goal_amount: string;
  start_date: string;
  end_date: string;
  status: string;
  is_restricted: boolean;
  restriction_purpose: string;
}

const INITIAL_FORM: CreateFormData = {
  name: '',
  description: '',
  campaign_type: 'general',
  goal_amount: '',
  start_date: '',
  end_date: '',
  status: 'draft',
  is_restricted: false,
  restriction_purpose: '',
};

const inputClass =
  'form-input px-3 text-sm placeholder:text-theme-text-secondary focus:border-red-500 focus:ring-red-500';

const labelClass = 'form-label';

const selectClass = 'form-input px-3 text-sm focus:border-red-500 focus:ring-red-500';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CampaignsPage: React.FC = () => {
  const tz = useTimezone();
  // Route is gated at fundraising.view; create_campaign requires
  // fundraising.manage. Hide the create affordance for view-only viewers
  // rather than let the submit 403.
  const canManage = useAuthStore((s) => s.checkPermission)('fundraising.manage');
  const [searchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<FundraisingCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // The dashboard's "Active Campaigns" card links here with `?status=active`
  // — honor it as the initial filter so the link actually filters, instead
  // of silently landing on the unfiltered list. A bookmarked/shared URL can
  // carry a stale or mistyped value — falling back to unfiltered beats
  // silently applying a filter that matches nothing (an unexplained empty
  // list, with no visible indication in STATUS_OPTIONS of why).
  const [statusFilter, setStatusFilter] = useState(() => {
    const fromUrl = searchParams.get('status');
    return fromUrl && (STATUS_OPTIONS as readonly string[]).includes(fromUrl) ? fromUrl : '';
  });
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

  const [statusSaving, setStatusSaving] = useState<string | null>(null);

  const changeStatus = async (campaign: FundraisingCampaign, status: string) => {
    setStatusSaving(campaign.id);
    try {
      await fundraisingService.updateCampaign(campaign.id, { status: status as FundraisingCampaign['status'] });
      toast.success(`${campaign.name} is now ${STATUS_LABELS[status] ?? status}`);
      void loadCampaigns();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change the campaign status'));
    } finally {
      setStatusSaving(null);
    }
  };

  // ---- Client-side search ----

  const filteredCampaigns = useMemo(() => {
    if (!searchQuery.trim()) return campaigns;
    const query = searchQuery.toLowerCase();
    return campaigns.filter((c) => c.name.toLowerCase().includes(query));
  }, [campaigns, searchQuery]);

  // ---- Form handlers ----

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Enter a campaign name');
      return;
    }

    if (!formData.goal_amount || Number(formData.goal_amount) <= 0) {
      toast.error('Goal amount must be greater than zero');
      return;
    }

    if (!formData.start_date) {
      toast.error('Choose a start date');
      return;
    }

    if (formData.end_date && formData.end_date < formData.start_date) {
      toast.error('The end date cannot be before the start date');
      return;
    }

    if (formData.is_restricted && !formData.restriction_purpose.trim()) {
      toast.error('Say what the donors to a restricted fund are giving for');
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
        endDate: formData.end_date || null,
        status: formData.status as FundraisingCampaign['status'],
        ...(formData.is_restricted
          ? { isRestricted: true, restrictionPurpose: formData.restriction_purpose.trim() }
          : {}),
      });
      toast.success('Campaign created');
      setFormData(INITIAL_FORM);
      setShowCreateForm(false);
      void loadCampaigns();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create campaign'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header gap-4 sm:items-center">
        <div className="page-header-title">
          <h1 className="text-theme-text-primary text-2xl font-bold">Fundraising Campaigns</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Track each campaign's progress toward its goal</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
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
        )}
      </div>

      {/* Inline Create Form */}
      {canManage && showCreateForm && (
        <form onSubmit={(e) => void handleCreateSubmit(e)} className="card space-y-4 p-5">
          <h2 className="text-theme-text-primary text-lg font-semibold">New Campaign</h2>

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
                <DollarSign className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
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

            {/* End Date — optional; a campaign without one reads "Ongoing" */}
            <div>
              <label htmlFor="create-end-date" className={labelClass}>
                End Date
              </label>
              <input
                id="create-end-date"
                name="end_date"
                type="date"
                value={formData.end_date}
                min={formData.start_date || undefined}
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

            {/* Restricted fund (full width) */}
            <div className="md:col-span-2">
              <label className="text-theme-text-primary touch:min-h-11 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={formData.is_restricted}
                  onChange={(e) => setFormData((prev) => ({ ...prev, is_restricted: e.target.checked }))}
                />
                Restricted fund — donors are giving for a stated purpose
              </label>
              {formData.is_restricted && (
                <div className="mt-2">
                  <label htmlFor="create-restriction-purpose" className={labelClass}>
                    What the donors are giving for *
                  </label>
                  <textarea
                    id="create-restriction-purpose"
                    name="restriction_purpose"
                    rows={2}
                    value={formData.restriction_purpose}
                    onChange={handleFormChange}
                    placeholder="e.g. Replacing Engine 2"
                    className={inputClass}
                  />
                  <p className="text-theme-text-secondary mt-1 text-xs">
                    Finance requests can be charged to a restricted fund, and no more than it has received can be spent
                    from it.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setFormData(INITIAL_FORM);
              }}
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:opacity-50"
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
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            type="text"
            aria-label="Search campaigns by name"
            placeholder="Search campaigns by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`${inputClass} pl-10`}
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchQuery('')}
              className="text-theme-text-secondary hover:text-theme-text-primary absolute top-1/2 right-3 -translate-y-1/2"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status filter */}
        <select
          aria-label="Filter by status"
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
          aria-label="Filter by type"
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
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin text-red-500" />
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Megaphone className="text-theme-text-secondary mb-3 h-12 w-12 opacity-40" />
          <p className="text-theme-text-secondary">
            {searchQuery || statusFilter || typeFilter
              ? 'No campaigns match your search or filters.'
              : canManage
                ? 'No campaigns yet. Select New Campaign to add one.'
                : 'No campaigns yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredCampaigns.map((campaign) => {
            const progress =
              campaign.goalAmount > 0
                ? Math.min(100, Math.round((campaign.currentAmount / campaign.goalAmount) * 100))
                : 0;

            return (
              <div key={campaign.id} className="card space-y-3 p-5">
                {/* Campaign Name & Badges */}
                <div>
                  <h3 className="text-theme-text-primary text-lg font-bold">{campaign.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CAMPAIGN_TYPE_COLORS[campaign.campaignType] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                    >
                      {CAMPAIGN_TYPE_LABELS[campaign.campaignType] ?? campaign.campaignType}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CAMPAIGN_STATUS_COLORS[campaign.status] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                    >
                      {STATUS_LABELS[campaign.status] ?? campaign.status}
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-theme-text-primary font-medium">
                      {formatCurrencyWhole(campaign.currentAmount)}
                    </span>
                    <span className="text-theme-text-secondary">
                      of {formatCurrencyWhole(campaign.goalAmount)} ({progress}%)
                    </span>
                  </div>
                  <div className="bg-theme-surface-hover h-3 w-full overflow-hidden rounded-full">
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

                {canManage && (
                  // W69: a campaign's status could be set only at creation (and
                  // was dropped even then), so none could be ended or paused.
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor={`campaign-status-${campaign.id}`} className="text-theme-text-secondary">
                      Status
                    </label>
                    <select
                      id={`campaign-status-${campaign.id}`}
                      value={campaign.status}
                      disabled={statusSaving === campaign.id}
                      onChange={(e) => void changeStatus(campaign, e.target.value)}
                      className="form-input w-auto py-1 text-sm"
                    >
                      {STATUS_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {STATUS_LABELS[value] ?? value}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <CampaignRestrictionControl
                  campaign={campaign}
                  canManage={canManage}
                  onChanged={() => void loadCampaigns()}
                />

                {/* Date Range */}
                <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 shrink-0" />
                  <span>
                    {formatDate(campaign.startDate, tz)}
                    {campaign.endDate ? ` - ${formatDate(campaign.endDate, tz)}` : ' - Ongoing'}
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
