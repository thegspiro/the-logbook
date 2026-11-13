/**
 * Campaigns Page
 *
 * Manages fundraising campaigns with search, filters, inline creation form,
 * and campaign cards showing progress toward goals.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Megaphone, Plus, Search, X, DollarSign, Calendar, Loader2, Pencil } from 'lucide-react';
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
import { blankToNull } from '@/utils/formValues';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';

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
  equipment: 'bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-300',
  training: 'bg-green-100 text-green-900 dark:bg-green-500/20 dark:text-green-300',
  community: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/20 dark:text-yellow-300',
  memorial: 'bg-purple-100 text-purple-900 dark:bg-purple-500/20 dark:text-purple-300',
  event: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-300',
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

/**
 * The form as an existing campaign fills it, for editing. Status and the
 * restriction keep their own controls on each card, so the edit form leaves
 * them out rather than offer two ways to change the same thing.
 */
const formFromCampaign = (campaign: FundraisingCampaign): CreateFormData => ({
  ...INITIAL_FORM,
  name: campaign.name,
  description: campaign.description ?? '',
  campaign_type: campaign.campaignType,
  goal_amount: String(campaign.goalAmount),
  start_date: (campaign.startDate ?? '').slice(0, 10),
  end_date: (campaign.endDate ?? '').slice(0, 10),
});

type CampaignField = Exclude<keyof CreateFormData, 'is_restricted'>;

/**
 * `CampaignCreate` / `CampaignUpdate` in schemas/grant.py; the module sends
 * camelCase, which mapServerFieldErrors matches from these snake_case keys.
 * Ordered as on screen.
 */
const CAMPAIGN_FIELDS: Record<CampaignField, ServerFieldSpec & { id: string }> = {
  name: { label: 'Name', maxLength: 255, id: 'create-name' },
  campaign_type: { label: 'Campaign type', id: 'create-campaign-type' },
  goal_amount: { label: 'Goal amount', id: 'create-goal' },
  start_date: { label: 'Start date', id: 'create-start-date' },
  end_date: { label: 'End date', id: 'create-end-date' },
  status: { label: 'Status', id: 'create-status' },
  description: { label: 'Description', id: 'create-description' },
  restriction_purpose: { label: 'What the donors are giving for', maxLength: 2000, id: 'create-restriction-purpose' },
};
const CAMPAIGN_ORDER = Object.keys(CAMPAIGN_FIELDS) as CampaignField[];

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
  // The campaign being edited, or null when the form creates one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<CreateFormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<CampaignField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const closeForm = () => {
    setShowCreateForm(false);
    setEditingId(null);
    setFormData(INITIAL_FORM);
    setBaseline(INITIAL_FORM);
    setErrors({});
    setFormError(null);
  };

  const startEdit = (campaign: FundraisingCampaign) => {
    const seeded = formFromCampaign(campaign);
    setFormData(seeded);
    setBaseline(seeded);
    setErrors({});
    setFormError(null);
    setEditingId(campaign.id);
    setShowCreateForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

  // Cancel asks before throwing typed changes away (forms review F-6). With the
  // form closed there is nothing to ask about, so the guard is not armed.
  const requestCancel = useDiscardGuard({
    isDirty: showCreateForm ? JSON.stringify(formData) !== JSON.stringify(baseline) : undefined,
    onClose: closeForm,
  });

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name as CampaignField];
      return next;
    });
  };

  const showErrors = (next: Partial<Record<CampaignField, string>>) => {
    setErrors(next);
    const first = firstRefused(CAMPAIGN_ORDER, next);
    if (first) window.setTimeout(() => document.getElementById(CAMPAIGN_FIELDS[first].id)?.focus(), 0);
  };

  const reportFailure = (err: unknown, fallback: string) => {
    // A refusal lands on its field (forms review F-2); anything no field
    // answers for is said at the top of the form, which stays open.
    const mapped = mapServerFieldErrors(err, CAMPAIGN_FIELDS);
    if (mapped) showErrors(mapped.fieldErrors);
    const placed = mapped ? Object.keys(mapped.fieldErrors).length > 0 : false;
    setFormError(mapped?.unmatched.join(' ') || (placed ? null : getErrorMessage(err, fallback)));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const problems: Partial<Record<CampaignField, string>> = {};
    if (!formData.name.trim()) problems.name = 'Enter a campaign name.';
    if (!formData.goal_amount || !(Number(formData.goal_amount) > 0)) {
      problems.goal_amount = 'Enter a goal greater than zero.';
    }
    if (!formData.start_date) problems.start_date = 'Choose a start date.';
    if (formData.end_date && formData.start_date && formData.end_date < formData.start_date) {
      problems.end_date = 'The end date cannot be before the start date.';
    }
    if (!editingId && formData.is_restricted && !formData.restriction_purpose.trim()) {
      problems.restriction_purpose = 'Say what the donors to a restricted fund are giving for.';
    }
    setFormError(null);

    if (editingId) {
      try {
        setIsSubmitting(true);
        // Every field this form owns goes on an update; an emptied
        // description or end date is sent as null so it is cleared. A refused
        // field is left out, so its stored value stands while the rest saves
        // (owner rule, 2026-11-05).
        const { refused } = await saveExceptRefused<CampaignField, unknown>({
          payload: {
            name: formData.name.trim(),
            description: blankToNull(formData.description),
            campaignType: formData.campaign_type,
            goalAmount: Number(formData.goal_amount),
            startDate: formData.start_date,
            endDate: blankToNull(formData.end_date),
          },
          refused: problems,
          keysFor: (field) => [field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())],
          send: (body) => fundraisingService.updateCampaign(editingId, body),
          place: (err) => mapServerFieldErrors(err, CAMPAIGN_FIELDS),
        });
        const first = firstRefused(CAMPAIGN_ORDER, refused);
        if (first) {
          void loadCampaigns();
          showErrors(refused);
          setFormError(`Campaign saved, except ${CAMPAIGN_FIELDS[first].label.toLowerCase()}. Fix it and save again.`);
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as CampaignField]]));
          setBaseline({ ...formData, ...keep });
          return;
        }
        toast.success('Campaign updated');
        closeForm();
        void loadCampaigns();
      } catch (err: unknown) {
        reportFailure(err, 'Failed to update campaign');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // A new campaign is not created until every field is fixed.
    if (Object.keys(problems).length > 0) {
      showErrors(problems);
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
      closeForm();
      void loadCampaigns();
    } catch (err: unknown) {
      reportFailure(err, 'Failed to create campaign');
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
            onClick={() => (showCreateForm ? requestCancel() : setShowCreateForm(true))}
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
        <form onSubmit={(e) => void handleCreateSubmit(e)} noValidate className="card space-y-4 p-5">
          <h2 className="text-theme-text-primary text-lg font-semibold">
            {editingId ? 'Edit Campaign' : 'New Campaign'}
          </h2>

          {formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {formError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              id={CAMPAIGN_FIELDS.name.id}
              label="Name"
              required
              error={errors.name}
              maxLength={CAMPAIGN_FIELDS.name.maxLength}
              count={formData.name.length}
              labelClassName={labelClass}
            >
              {(field) => (
                <input
                  {...field}
                  name="name"
                  type="text"
                  autoComplete="off"
                  value={formData.name}
                  onChange={handleFormChange}
                  placeholder="Campaign name"
                  className={inputClass}
                />
              )}
            </FormField>

            <FormField
              id={CAMPAIGN_FIELDS.campaign_type.id}
              label="Campaign Type"
              error={errors.campaign_type}
              labelClassName={labelClass}
            >
              {(field) => (
                <select
                  {...field}
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
              )}
            </FormField>

            <FormField
              id={CAMPAIGN_FIELDS.goal_amount.id}
              label="Goal Amount"
              required
              error={errors.goal_amount}
              labelClassName={labelClass}
            >
              {(field) => (
                <div className="relative">
                  <DollarSign className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <input
                    {...field}
                    name="goal_amount"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="1"
                    value={formData.goal_amount}
                    onChange={handleFormChange}
                    placeholder="0"
                    className={`${inputClass} pl-9`}
                  />
                </div>
              )}
            </FormField>

            <FormField
              id={CAMPAIGN_FIELDS.start_date.id}
              label="Start Date"
              required
              error={errors.start_date}
              labelClassName={labelClass}
            >
              {(field) => (
                <input
                  {...field}
                  name="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={handleFormChange}
                  className={inputClass}
                />
              )}
            </FormField>

            {/* End Date — optional; a campaign without one reads "Ongoing" */}
            <FormField
              id={CAMPAIGN_FIELDS.end_date.id}
              label="End Date"
              error={errors.end_date}
              labelClassName={labelClass}
            >
              {(field) => (
                <input
                  {...field}
                  name="end_date"
                  type="date"
                  value={formData.end_date}
                  min={formData.start_date || undefined}
                  onChange={handleFormChange}
                  className={inputClass}
                />
              )}
            </FormField>

            {/* Status: set on the card once a campaign exists */}
            {!editingId && (
              <FormField
                id={CAMPAIGN_FIELDS.status.id}
                label="Status"
                error={errors.status}
                labelClassName={labelClass}
              >
                {(field) => (
                  <select
                    {...field}
                    name="status"
                    value={formData.status}
                    onChange={handleFormChange}
                    className={selectClass}
                  >
                    {STATUS_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABELS[st] ?? st}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}

            <FormField
              id={CAMPAIGN_FIELDS.description.id}
              label="Description"
              error={errors.description}
              labelClassName={labelClass}
              className="md:col-span-2"
            >
              {(field) => (
                <textarea
                  {...field}
                  name="description"
                  rows={3}
                  value={formData.description}
                  onChange={handleFormChange}
                  placeholder="Describe this campaign..."
                  className={inputClass}
                />
              )}
            </FormField>

            {/* Restricted fund: changed through the card's own control once a campaign exists */}
            {!editingId && (
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
                  <FormField
                    id={CAMPAIGN_FIELDS.restriction_purpose.id}
                    label="What the donors are giving for"
                    required
                    error={errors.restriction_purpose}
                    maxLength={CAMPAIGN_FIELDS.restriction_purpose.maxLength}
                    count={formData.restriction_purpose.length}
                    labelClassName={labelClass}
                    className="mt-2"
                    hint="Finance requests can be charged to a restricted fund, and no more than it has received can be spent from it."
                  >
                    {(field) => (
                      <textarea
                        {...field}
                        name="restriction_purpose"
                        rows={2}
                        value={formData.restriction_purpose}
                        onChange={handleFormChange}
                        placeholder="e.g. Replacing Engine 2"
                        className={inputClass}
                      />
                    )}
                  </FormField>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={requestCancel}
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
              {editingId ? 'Save Changes' : 'Create Campaign'}
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
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-theme-text-primary text-lg font-bold">{campaign.name}</h3>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => startEdit(campaign)}
                        className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary touch-target-phone shrink-0 rounded p-1 transition-colors"
                        title="Edit campaign"
                        aria-label={`Edit ${campaign.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </div>
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
