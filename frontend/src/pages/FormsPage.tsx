import React, { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@/utils/errorHandling';
import {
  FormInput,
  Plus,
  FileCheck,
  Search,
  Filter,
  Copy,
  Eye,
  AlertTriangle,
  X,
  AlertCircle,
  RefreshCw,
  Send,
  Archive,
  Trash2,
  Globe,
  Link,
  ExternalLink,
  Plug,
  Check,
  Download,
  QrCode,
  Pencil,
  ArrowLeft,
  BarChart3,
} from 'lucide-react';
import { EmptyState } from '../components/ux';
import { QRCodeSVG } from 'qrcode.react';
import { useAuthStore } from '../stores/authStore';
import {
  formsService,
  type FormDef,
  type FormsSummary,
  type FormCreate,
  type FormDetailDef,
  type FormIntegrationCreate,
} from '../services/api';
import { FormBuilder, FormRenderer, SubmissionViewer, FormResultsPanel } from '../components/forms';
import { FormStatus, FieldType } from '../constants/enums';
import { INTEGRATION_TARGET_FIELDS, STARTER_TEMPLATES, type StarterTemplate } from './formConstants';

type FormCategory = 'all' | 'Safety' | 'Operations' | 'Administration' | 'Training';

const FormsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('forms.manage');

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FormCategory>('all');
  const [activeTab, setActiveTab] = useState<'templates' | 'forms' | 'submissions'>('forms');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showIntegrationModal, setShowIntegrationModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Data
  const [forms, setForms] = useState<FormDef[]>([]);
  const [summary, setSummary] = useState<FormsSummary | null>(null);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [submissionsView, setSubmissionsView] = useState<'list' | 'results'>('list');
  const [selectedFormDetail, setSelectedFormDetail] = useState<FormDetailDef | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'Operations',
    is_public: false,
  });

  // Form detail view (builder/preview/submissions)
  const [editingForm, setEditingForm] = useState<FormDetailDef | null>(null);
  const [detailTab, setDetailTab] = useState<'builder' | 'preview' | 'submissions' | 'results'>('builder');

  // Integration state
  const [integrationTarget, setIntegrationTarget] = useState('membership');
  const [integrationType, setIntegrationType] = useState('membership_interest');
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({});
  const [integrationHealth, setIntegrationHealth] = useState<{
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formsRes, summaryRes] = await Promise.all([
        formsService.getForms({
          search: searchQuery || undefined,
          category: categoryFilter !== 'all' ? categoryFilter : undefined,
        }),
        formsService.getSummary(),
      ]);
      setForms(formsRes.forms);
      setSummary(summaryRes);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load forms');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, categoryFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateForm = async () => {
    if (!formData.name.trim()) return;
    setCreating(true);
    try {
      await formsService.createForm({
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        is_public: formData.is_public,
      });
      setShowCreateModal(false);
      setFormData({ name: '', description: '', category: 'Operations', is_public: false });
      await loadData();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create form'));
    } finally {
      setCreating(false);
    }
  };

  const handleUseTemplate = async (template: StarterTemplate) => {
    setCreating(true);
    try {
      const createData: FormCreate = {
        name: template.name,
        description: template.description,
        category: template.category,
        is_public: template.isPublic || false,
        // When the template declares an integrationHint, set
        // integration_type on the form so submission processing
        // uses label-based mapping directly — no separate
        // FormIntegration record needed.
        integration_type: template.integrationHint,
        fields: template.fields.map((f, i) => ({
          label: f.label,
          field_type: f.field_type,
          required: f.required,
          sort_order: i,
          ...(f.options ? { options: f.options } : {}),
        })),
      };
      await formsService.createForm(createData);
      setActiveTab('forms');
      await loadData();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to create from template');
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async (formId: string) => {
    try {
      await formsService.publishForm(formId);
      await loadData();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to publish form');
      setError(message);
    }
  };

  const handleArchive = async (formId: string) => {
    try {
      await formsService.archiveForm(formId);
      await loadData();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to archive form');
      setError(message);
    }
  };

  const handleDelete = async (formId: string) => {
    try {
      await formsService.deleteForm(formId);
      await loadData();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to delete form');
      setError(message);
    }
  };

  const handleTogglePublic = async (form: FormDef) => {
    try {
      await formsService.updateForm(form.id, { is_public: !form.is_public });
      await loadData();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to update form');
      setError(message);
    }
  };

  const handleViewSubmissions = (formId: string) => {
    setSelectedFormId(formId);
    setActiveTab('submissions');
  };

  const handleEditForm = async (formId: string) => {
    try {
      const detail = await formsService.getForm(formId);
      setEditingForm(detail);
      setDetailTab('builder');
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load form');
      setError(message);
    }
  };

  const handleCloseEditor = () => {
    setEditingForm(null);
    void loadData(); // Refresh list to reflect any changes
  };

  const handleShareForm = (form: FormDef) => {
    setSelectedFormDetail(null);
    setSelectedFormId(form.id);
    setShowShareModal(true);
  };

  const handleOpenIntegrationModal = async (formId: string) => {
    try {
      const [detail, subsData] = await Promise.all([
        formsService.getForm(formId),
        formsService.getSubmissions(formId, { skip: 0, limit: 500 }),
      ]);
      setSelectedFormDetail(detail);
      setSelectedFormId(formId);

      // Compute integration health from submissions
      const subs = subsData.submissions;
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      for (const sub of subs) {
        if (sub.integration_processed && sub.integration_result) {
          processed++;
          const results = Object.values(sub.integration_result as Record<string, Record<string, unknown>>);
          if (results.some((r) => r.success === false)) {
            failed++;
          } else {
            succeeded++;
          }
        }
      }
      setIntegrationHealth({ total: subsData.total, processed, succeeded, failed });
      setShowIntegrationModal(true);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load form details');
      setError(message);
    }
  };

  const handleAddIntegration = async () => {
    if (!selectedFormId) return;

    // Validate that required mappings are present
    const targetFields = INTEGRATION_TARGET_FIELDS[integrationType] ?? [];
    const missingRequired = targetFields.filter((tf) => tf.required && !fieldMappings[tf.key]).map((tf) => tf.label);
    if (missingRequired.length > 0) {
      setError(`Required field mappings missing: ${missingRequired.join(', ')}`);
      return;
    }

    // Build mappings: { formFieldId → targetFieldName }
    // The backend expects this direction: form field ID as key, target field name as value
    const mappings: Record<string, string> = {};
    for (const [targetKey, formFieldId] of Object.entries(fieldMappings)) {
      if (formFieldId) {
        mappings[formFieldId] = targetKey;
      }
    }

    try {
      const data: FormIntegrationCreate = {
        target_module: integrationTarget,
        integration_type: integrationType,
        field_mappings: mappings,
        is_active: true,
      };
      await formsService.addIntegration(selectedFormId, data);
      const detail = await formsService.getForm(selectedFormId);
      setSelectedFormDetail(detail);
      setFieldMappings({});
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to add integration');
      setError(message);
    }
  };

  const handleDeleteIntegration = async (integrationId: string) => {
    if (!selectedFormId) return;
    try {
      await formsService.deleteIntegration(selectedFormId, integrationId);
      const detail = await formsService.getForm(selectedFormId);
      setSelectedFormDetail(detail);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to delete integration');
      setError(message);
    }
  };

  const copyPublicUrl = (slug: string) => {
    const url = `${window.location.origin}/f/${slug}`;
    void navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const getPublicUrl = (slug: string) => `${window.location.origin}/f/${slug}`;

  const filteredTemplates = STARTER_TEMPLATES.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const statusColor = (s: string) => {
    switch (s) {
      case FormStatus.PUBLISHED:
        return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30';
      case FormStatus.DRAFT:
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
      case FormStatus.ARCHIVED:
        return 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
      default:
        return 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
    }
  };

  const cardBorderColor = (s: string) => {
    switch (s) {
      case FormStatus.PUBLISHED:
        return 'border-l-green-500';
      case FormStatus.DRAFT:
        return 'border-l-yellow-500';
      case FormStatus.ARCHIVED:
        return 'border-l-theme-text-muted';
      default:
        return 'border-l-theme-text-muted';
    }
  };

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="rounded-lg bg-red-600 p-2">
              <FormInput className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Custom Forms</h1>
              <p className="text-theme-text-muted text-sm">
                Create custom forms, public-facing pages, and cross-module integrations
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                void loadData();
              }}
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
              aria-label="Refresh forms"
            >
              <RefreshCw className="h-5 w-5" aria-hidden="true" />
            </button>
            {canManage && (
              <button onClick={() => setShowCreateModal(true)} className="btn-primary inline-flex items-center gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Create Form</span>
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        {summary && (
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-5" role="region" aria-label="Forms statistics">
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Total Forms</p>
              <p className="text-theme-text-primary mt-1 text-2xl font-bold">{summary.total_forms}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Published</p>
              <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">{summary.published_forms}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Drafts</p>
              <p className="mt-1 text-2xl font-bold text-yellow-700 dark:text-yellow-400">{summary.draft_forms}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Public Forms</p>
              <p className="mt-1 text-2xl font-bold text-cyan-700 dark:text-cyan-400">{summary.public_forms}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Submissions This Month</p>
              <p className="mt-1 text-2xl font-bold text-red-700 dark:text-red-400">{summary.submissions_this_month}</p>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                aria-label="Dismiss error"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div
          className="bg-theme-surface-secondary mb-6 flex w-fit space-x-1 rounded-lg p-1"
          role="tablist"
          aria-label="Forms views"
        >
          <button
            onClick={() => setActiveTab('forms')}
            role="tab"
            aria-selected={activeTab === 'forms'}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'forms' ? 'bg-red-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            My Forms
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            role="tab"
            aria-selected={activeTab === 'templates'}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'templates'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            Starter Templates
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            role="tab"
            aria-selected={activeTab === 'submissions'}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'submissions'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            Submissions
          </button>
        </div>

        {/* Search & Filters */}
        <div className="card mb-6 p-4" role="search" aria-label="Search and filter forms">
          <div className="flex flex-col items-center gap-4 md:flex-row">
            <div className="relative w-full flex-1 md:max-w-md">
              <Search
                className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
                aria-hidden="true"
              />
              <label htmlFor="forms-search" className="sr-only">
                Search forms
              </label>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                id="forms-search"
                type="text"
                aria-label="Search forms..."
                placeholder="Search forms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input placeholder-theme-text-muted pr-4 pl-10"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
              <label htmlFor="forms-category-filter" className="sr-only">
                Filter by category
              </label>
              <select
                id="forms-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as FormCategory)}
                className="form-input"
              >
                <option value="all">All Categories</option>
                <option value="Safety">Safety</option>
                <option value="Operations">Operations</option>
                <option value="Administration">Administration</option>
                <option value="Training">Training</option>
              </select>
            </div>
          </div>
        </div>

        {/* Forms Tab */}
        {activeTab === 'forms' && (
          <>
            {loading ? (
              <div className="card p-12 text-center" role="status" aria-live="polite">
                <RefreshCw className="text-theme-text-muted mx-auto mb-3 h-8 w-8 animate-spin" aria-hidden="true" />
                <p className="text-theme-text-secondary" role="status" aria-live="polite">
                  Loading forms...
                </p>
              </div>
            ) : forms.length === 0 ? (
              <EmptyState
                icon={FormInput}
                title="No Custom Forms Yet"
                description="Build custom forms for incident reports, equipment inspections, public signup pages, and more. Start from a template for a quick setup, or create a blank form from scratch."
                actions={
                  canManage
                    ? [
                        {
                          label: 'Browse Templates',
                          onClick: () => setActiveTab('templates'),
                          variant: 'primary',
                          icon: Copy,
                        },
                        {
                          label: 'Blank Form',
                          onClick: () => setShowCreateModal(true),
                          variant: 'secondary',
                          icon: Plus,
                        },
                      ]
                    : undefined
                }
                className="card"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {forms.map((form) => (
                  <div key={form.id} className={`card-hover border-l-4 p-5 ${cardBorderColor(form.status)}`}>
                    <div className="mb-3 flex items-start justify-between">
                      <div>
                        <h3 className="text-theme-text-primary font-semibold">{form.name}</h3>
                        <div className="mt-1 flex flex-wrap items-center space-x-2 gap-y-1">
                          <span className={`rounded-sm border px-2 py-0.5 text-xs ${statusColor(form.status)}`}>
                            {form.status}
                          </span>
                          {form.status === FormStatus.PUBLISHED && (
                            <span className="inline-flex items-center space-x-1 rounded-sm border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                              <span>Accepting submissions</span>
                            </span>
                          )}
                          {form.status !== FormStatus.PUBLISHED && (
                            <span className="bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border inline-flex items-center space-x-1 rounded-sm border px-2 py-0.5 text-xs">
                              <span className="bg-theme-text-muted h-1.5 w-1.5 rounded-full" />
                              <span>Not accepting submissions</span>
                            </span>
                          )}
                          <span className="rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                            {form.category}
                          </span>
                          {form.is_public && (
                            <span className="inline-flex items-center space-x-1 rounded-sm border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-400">
                              <Globe className="h-3 w-3" aria-hidden="true" />
                              <span>Public</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {form.description && (
                      <p className="text-theme-text-secondary mb-3 line-clamp-2 text-sm">{form.description}</p>
                    )}

                    {/* Warning: public form not yet published */}
                    {form.is_public && form.status !== FormStatus.PUBLISHED && (
                      <div className="mb-3 flex items-center gap-2 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2">
                        <AlertTriangle
                          className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400"
                          aria-hidden="true"
                        />
                        <span className="text-xs text-yellow-700 dark:text-yellow-300">
                          This form is marked public but is not published — the public URL is inactive and submissions
                          are blocked.
                        </span>
                      </div>
                    )}

                    {/* Public URL */}
                    {form.is_public && form.public_slug && form.status === FormStatus.PUBLISHED && (
                      <div className="mb-3 flex items-center space-x-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                        <Link className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
                        <span className="flex-1 truncate text-xs text-cyan-700 dark:text-cyan-300">
                          {getPublicUrl(form.public_slug)}
                        </span>
                        <button
                          onClick={() => copyPublicUrl(form.public_slug ?? '')}
                          className="shrink-0 text-cyan-700 transition-colors hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300"
                          aria-label="Copy public URL"
                        >
                          {copiedSlug === form.public_slug ? (
                            <Check className="h-4 w-4 text-green-700 dark:text-green-400" aria-hidden="true" />
                          ) : (
                            <Copy className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    )}

                    {/* Workflow guidance for draft forms */}
                    {canManage && form.status === FormStatus.DRAFT && (
                      <div className="mb-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                        <p className="mb-1 text-xs font-medium text-yellow-700 dark:text-yellow-300">Next steps:</p>
                        <div className="flex items-center gap-3 text-xs text-yellow-700 dark:text-yellow-400">
                          <span
                            className={`flex items-center gap-1 ${(form.field_count ?? 0) > 0 ? 'line-through opacity-50' : 'font-medium'}`}
                          >
                            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">
                              1
                            </span>
                            Add fields
                          </span>
                          <span className="text-yellow-500/40">&rarr;</span>
                          <span className="flex items-center gap-1">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">
                              2
                            </span>
                            Publish
                          </span>
                          <span className="text-yellow-500/40">&rarr;</span>
                          <span className="flex items-center gap-1">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">
                              3
                            </span>
                            Share link
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="text-theme-text-muted flex items-center space-x-4 text-xs">
                        <span>{form.field_count ?? 0} fields</span>
                        <span>{form.submission_count ?? 0} submissions</span>
                      </div>
                    </div>

                    {/* Prominent Publish CTA for draft forms */}
                    {canManage && form.status === FormStatus.DRAFT && (
                      <button
                        onClick={() => {
                          void handlePublish(form.id);
                        }}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
                      >
                        <Send className="h-4 w-4" aria-hidden="true" />
                        Publish Form
                      </button>
                    )}

                    {/* Action buttons */}
                    <div className="border-theme-surface-border mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                      {canManage && (
                        <button
                          onClick={() => {
                            void handleEditForm(form.id);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-400"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          Edit Fields
                        </button>
                      )}
                      <button
                        onClick={() => handleViewSubmissions(form.id)}
                        className="text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Submissions
                      </button>
                      {canManage && (
                        <button
                          onClick={() => handleShareForm(form)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-700 transition-colors hover:bg-cyan-500/20 dark:text-cyan-400"
                        >
                          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                          Share
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={() => {
                            void handleOpenIntegrationModal(form.id);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500/10 px-3 py-1.5 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-500/20 dark:text-orange-400"
                        >
                          <Plug className="h-3.5 w-3.5" aria-hidden="true" />
                          Integrations
                        </button>
                      )}
                      {canManage && form.status === FormStatus.PUBLISHED && (
                        <button
                          onClick={() => {
                            void handleArchive(form.id);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-500/10 px-3 py-1.5 text-xs font-medium text-yellow-700 transition-colors hover:bg-yellow-500/20 dark:text-yellow-400"
                        >
                          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                          Archive
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={() => {
                            void handleDelete(form.id);
                          }}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/10 dark:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredTemplates.map((template) => (
              <div key={template.id} className="card-hover p-5">
                <div className="flex items-start space-x-4">
                  <div className={`bg-theme-surface-secondary rounded-lg p-3 ${template.color}`}>{template.icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between">
                      <h3 className="text-theme-text-primary font-semibold">{template.name}</h3>
                      <div className="flex items-center space-x-1">
                        {template.isPublic && (
                          <span className="rounded-sm border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-400">
                            Public
                          </span>
                        )}
                        <span className="rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                          {template.category}
                        </span>
                      </div>
                    </div>
                    <p className="text-theme-text-secondary mt-1 text-sm">{template.description}</p>
                    {template.integrationHint && (
                      <div className="mt-2 flex items-center space-x-1">
                        <Plug className="h-3 w-3 text-orange-700 dark:text-orange-400" aria-hidden="true" />
                        <span className="text-xs text-orange-700 dark:text-orange-400">
                          Supports cross-module integration
                        </span>
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-theme-text-muted text-xs">{template.fields.length} fields</span>
                      <div className="flex space-x-2">
                        {canManage && (
                          <button
                            onClick={() => {
                              void handleUseTemplate(template);
                            }}
                            disabled={creating}
                            className="flex items-center space-x-1 rounded-sm bg-red-600/20 px-3 py-1 text-xs text-red-700 transition-colors hover:bg-red-600/30 disabled:opacity-50 dark:text-red-400"
                          >
                            <Copy className="h-3 w-3" aria-hidden="true" />
                            <span>{creating ? 'Creating...' : 'Use Template'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Submissions Tab */}
        {activeTab === 'submissions' && (
          <>
            {/* Form selector dropdown */}
            <div className="mb-4 flex items-center gap-3">
              <label
                htmlFor="submission-form-select"
                className="text-theme-text-secondary shrink-0 text-sm font-medium"
              >
                Form:
              </label>
              <select
                id="submission-form-select"
                value={selectedFormId ?? ''}
                onChange={(e) => {
                  setSelectedFormId(e.target.value || null);
                  setSubmissionsView('list');
                }}
                className="form-input max-w-md flex-1"
              >
                <option value="">Select a form...</option>
                {forms
                  .filter((f) => !f.is_template)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.submission_count ?? 0} submissions)
                    </option>
                  ))}
              </select>
              {selectedFormId && (
                <div className="bg-theme-surface-secondary flex rounded-lg p-0.5">
                  <button
                    onClick={() => setSubmissionsView('list')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      submissionsView === 'list'
                        ? 'bg-red-600 text-white'
                        : 'text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    Responses
                  </button>
                  <button
                    onClick={() => setSubmissionsView('results')}
                    className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      submissionsView === 'results'
                        ? 'bg-red-600 text-white'
                        : 'text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    <BarChart3 className="h-3 w-3" />
                    Results
                  </button>
                </div>
              )}
            </div>

            {selectedFormId ? (
              submissionsView === 'list' ? (
                <SubmissionViewer formId={selectedFormId} allowDelete={canManage} />
              ) : (
                <FormResultsPanel formId={selectedFormId} />
              )
            ) : (
              <div className="card-secondary p-12 text-center">
                <FileCheck className="text-theme-text-muted mx-auto mb-3 h-12 w-12" aria-hidden="true" />
                <p className="text-theme-text-muted text-sm">
                  Choose a form above to view its submissions and results.
                </p>
              </div>
            )}
          </>
        )}

        {/* Form Detail / Editor View */}
        {editingForm && (
          <div
            className="bg-theme-surface-modal fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="form-editor-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleCloseEditor();
            }}
          >
            <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
              {/* Header */}
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCloseEditor}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
                    aria-label="Close editor"
                  >
                    <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <div>
                    <h2 id="form-editor-title" className="text-theme-text-primary text-xl font-bold">
                      {editingForm.name}
                    </h2>
                    <p className="text-theme-text-muted text-sm">{editingForm.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-sm border px-2 py-0.5 text-xs ${statusColor(editingForm.status)}`}>
                    {editingForm.status}
                  </span>
                  <span className="rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                    {editingForm.category}
                  </span>
                </div>
              </div>

              {/* Detail Tabs */}
              <div
                className="bg-theme-surface-secondary mb-6 flex w-fit space-x-1 rounded-lg p-1"
                role="tablist"
                aria-label="Form editor views"
              >
                <button
                  onClick={() => setDetailTab('builder')}
                  role="tab"
                  aria-selected={detailTab === 'builder'}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    detailTab === 'builder'
                      ? 'bg-red-600 text-white'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  Form Builder
                </button>
                <button
                  onClick={() => setDetailTab('preview')}
                  role="tab"
                  aria-selected={detailTab === 'preview'}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    detailTab === 'preview'
                      ? 'bg-red-600 text-white'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  Preview & Submit
                </button>
                <button
                  onClick={() => setDetailTab('submissions')}
                  role="tab"
                  aria-selected={detailTab === 'submissions'}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    detailTab === 'submissions'
                      ? 'bg-red-600 text-white'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  Submissions
                </button>
                <button
                  onClick={() => setDetailTab('results')}
                  role="tab"
                  aria-selected={detailTab === 'results'}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    detailTab === 'results'
                      ? 'bg-red-600 text-white'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  Results
                </button>
              </div>

              {/* Builder Tab */}
              {detailTab === 'builder' && (
                <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-6">
                  <FormBuilder formId={editingForm.id} />
                </div>
              )}

              {/* Preview & Submit Tab */}
              {detailTab === 'preview' && (
                <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-6">
                  <FormRenderer formId={editingForm.id} submitLabel="Submit Form" allowResubmit />
                </div>
              )}

              {/* Submissions Tab */}
              {detailTab === 'submissions' && (
                <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-6">
                  <SubmissionViewer formId={editingForm.id} allowDelete={canManage} />
                </div>
              )}

              {/* Results Tab */}
              {detailTab === 'results' && (
                <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-6">
                  <FormResultsPanel formId={editingForm.id} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Create Form Modal */}
        {showCreateModal && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-form-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowCreateModal(false);
            }}
          >
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} aria-hidden="true" />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-lg rounded-lg border shadow-xl">
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 id="create-form-title" className="text-theme-text-primary text-lg font-medium">
                      Create New Form
                    </h3>
                    <button
                      onClick={() => setShowCreateModal(false)}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                      aria-label="Close dialog"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="form-name" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                        Form Name <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="form-name"
                        type="text"
                        required
                        aria-required="true"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="form-input"
                        placeholder="e.g., Monthly Safety Report"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="form-category"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Category
                      </label>
                      <select
                        id="form-category"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="form-input"
                      >
                        <option value="Safety">Safety</option>
                        <option value="Operations">Operations</option>
                        <option value="Administration">Administration</option>
                        <option value="Training">Training</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="form-description"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Description
                      </label>
                      <textarea
                        id="form-description"
                        rows={3}
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="form-input"
                        placeholder="Describe the purpose of this form..."
                      />
                    </div>
                    <div className="flex items-center space-x-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                      <input
                        type="checkbox"
                        id="is_public"
                        checked={formData.is_public}
                        onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                        className="h-4 w-4 rounded-sm text-cyan-600"
                      />
                      <label htmlFor="is_public" className="cursor-pointer text-sm">
                        <span className="font-medium text-cyan-700 dark:text-cyan-300">Public Form</span>
                        <p className="text-theme-text-muted mt-0.5 text-xs">
                          Allow anyone to fill out this form via a public URL (no login required)
                        </p>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg flex justify-end space-x-3 rounded-b-lg px-6 py-3">
                  <button onClick={() => setShowCreateModal(false)} className="btn-secondary">
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleCreateForm();
                    }}
                    disabled={!formData.name.trim() || creating}
                    className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? 'Creating...' : 'Create Form'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Share / Public Settings Modal */}
        {showShareModal && selectedFormId && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-form-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowShareModal(false);
            }}
          >
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowShareModal(false)} aria-hidden="true" />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-lg rounded-lg border shadow-xl">
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3
                      id="share-form-title"
                      className="text-theme-text-primary flex items-center space-x-2 text-lg font-medium"
                    >
                      <Globe className="h-5 w-5 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
                      <span>Public Sharing Settings</span>
                    </h3>
                    <button
                      onClick={() => setShowShareModal(false)}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                      aria-label="Close dialog"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                  {(() => {
                    const form = forms.find((f) => f.id === selectedFormId);
                    if (!form) return null;
                    return (
                      <div className="space-y-4">
                        <div className="card-secondary flex items-center justify-between p-4">
                          <div>
                            <p className="text-theme-text-primary font-medium">Public Access</p>
                            <p className="text-theme-text-muted mt-0.5 text-xs">
                              Anyone with the link can view and submit this form
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              void handleTogglePublic(form);
                            }}
                            aria-label={form.is_public ? 'Disable public access' : 'Enable public access'}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              form.is_public ? 'bg-cyan-600' : 'bg-theme-surface-hover'
                            }`}
                          >
                            <span className={`toggle-knob-sm ${form.is_public ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </div>

                        {form.is_public && form.public_slug && (
                          <>
                            <div>
                              <label
                                htmlFor="share-public-url"
                                className="text-theme-text-secondary mb-2 block text-sm font-medium"
                              >
                                Public URL
                              </label>
                              <div className="flex items-center space-x-2">
                                <input
                                  id="share-public-url"
                                  readOnly
                                  value={getPublicUrl(form.public_slug)}
                                  className="form-input flex-1 text-cyan-700 dark:text-cyan-300"
                                  aria-label="Public URL"
                                />
                                <button
                                  onClick={() => copyPublicUrl(form.public_slug ?? '')}
                                  className="rounded-lg bg-cyan-600/20 px-3 py-2 text-cyan-700 transition-colors hover:bg-cyan-600/30 dark:text-cyan-400"
                                  aria-label="Copy public URL"
                                >
                                  {copiedSlug === form.public_slug ? (
                                    <Check className="h-4 w-4" aria-hidden="true" />
                                  ) : (
                                    <Copy className="h-4 w-4" aria-hidden="true" />
                                  )}
                                </button>
                                <a
                                  href={getPublicUrl(form.public_slug)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded-lg bg-cyan-600/20 px-3 py-2 text-cyan-700 transition-colors hover:bg-cyan-600/30 dark:text-cyan-400"
                                  aria-label="Open public URL in new tab"
                                >
                                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                </a>
                              </div>
                            </div>

                            {/* QR Code */}
                            <div>
                              <label className="text-theme-text-secondary mb-2 block flex items-center space-x-2 text-sm font-medium">
                                <QrCode className="h-4 w-4" aria-hidden="true" />
                                <span>QR Code</span>
                              </label>
                              {/* White background regardless of theme — a QR on
                                  a dark surface can fail to scan. */}
                              <div className="border-theme-surface-border flex flex-col items-center rounded-lg border bg-white p-4">
                                <QRCodeSVG
                                  id={`qr-${form.public_slug}`}
                                  value={getPublicUrl(form.public_slug)}
                                  size={200}
                                  level="H"
                                  includeMargin
                                />
                              </div>
                              <div className="mt-2 flex items-center justify-center space-x-2">
                                <button
                                  onClick={() => {
                                    const svg = document.getElementById(`qr-${form.public_slug}`);
                                    if (!svg) return;
                                    const ctx = document.createElement('canvas').getContext('2d');
                                    if (!ctx) return;
                                    const canvas = ctx.canvas;
                                    const svgData = new XMLSerializer().serializeToString(svg);
                                    const img = new Image();
                                    img.onload = () => {
                                      canvas.width = img.width || 200;
                                      canvas.height = img.height || 200;
                                      // Paint a white backdrop first so the PNG is
                                      // scannable even if the SVG serializes with a
                                      // transparent background on some browsers.
                                      ctx.fillStyle = '#ffffff';
                                      ctx.fillRect(0, 0, canvas.width, canvas.height);
                                      ctx.drawImage(img, 0, 0);
                                      const a = document.createElement('a');
                                      a.download = `${form.name.replace(/[^a-z0-9]/gi, '_')}_qr.png`;
                                      a.href = canvas.toDataURL('image/png');
                                      a.click();
                                    };
                                    img.onerror = () => {
                                      // SVG→PNG rasterization can fail on some mobile
                                      // browsers; the adjacent SVG-download button is
                                      // the fallback, so fail quietly here.
                                    };
                                    img.src =
                                      'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                                  }}
                                  className="flex items-center space-x-1 rounded-lg bg-cyan-600/20 px-3 py-1.5 text-sm text-cyan-700 transition-colors hover:bg-cyan-600/30 dark:text-cyan-400"
                                  aria-label="Download QR code as PNG"
                                >
                                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Download PNG</span>
                                </button>
                                <button
                                  onClick={() => {
                                    const svg = document.getElementById(`qr-${form.public_slug}`);
                                    if (!svg) return;
                                    const svgData = new XMLSerializer().serializeToString(svg);
                                    const blob = new Blob([svgData], { type: 'image/svg+xml' });
                                    const a = document.createElement('a');
                                    a.download = `${form.name.replace(/[^a-z0-9]/gi, '_')}_qr.svg`;
                                    a.href = URL.createObjectURL(blob);
                                    a.click();
                                    URL.revokeObjectURL(a.href);
                                  }}
                                  className="flex items-center space-x-1 rounded-lg bg-cyan-600/20 px-3 py-1.5 text-sm text-cyan-700 transition-colors hover:bg-cyan-600/30 dark:text-cyan-400"
                                  aria-label="Download QR code as SVG"
                                >
                                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Download SVG</span>
                                </button>
                              </div>
                              <p className="text-theme-text-muted mt-2 text-center text-xs">
                                Print this QR code and place it where users can scan to access the form.
                              </p>
                            </div>

                            {form.status !== FormStatus.PUBLISHED && (
                              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
                                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                                  This form must be published before the public URL will be active.
                                </p>
                              </div>
                            )}
                          </>
                        )}

                        <div className="card-secondary p-3">
                          <p className="text-theme-text-secondary text-sm">
                            Public forms allow anyone to submit without logging in. Submissions include the
                            submitter&apos;s name and email (optional) and are marked as &quot;Public&quot; in your
                            submissions list.
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="bg-theme-input-bg flex justify-end rounded-b-lg px-6 py-3">
                  <button
                    onClick={() => setShowShareModal(false)}
                    className="bg-theme-input-bg hover:bg-theme-surface-hover text-theme-text-primary rounded-lg px-4 py-2 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Integration Modal */}
        {showIntegrationModal && selectedFormId && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="integration-modal-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowIntegrationModal(false);
            }}
          >
            <div className="flex min-h-screen items-center justify-center px-4">
              <div
                className="fixed inset-0 bg-black/60"
                onClick={() => setShowIntegrationModal(false)}
                aria-hidden="true"
              />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-lg rounded-lg border shadow-xl">
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3
                      id="integration-modal-title"
                      className="text-theme-text-primary flex items-center space-x-2 text-lg font-medium"
                    >
                      <Plug className="h-5 w-5 text-orange-700 dark:text-orange-400" aria-hidden="true" />
                      <span>Cross-Module Integrations</span>
                    </h3>
                    <button
                      onClick={() => setShowIntegrationModal(false)}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                      aria-label="Close dialog"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Integration Health Stats */}
                  {integrationHealth && integrationHealth.processed > 0 && (
                    <div className="mb-4 grid grid-cols-3 gap-2">
                      <div className="bg-theme-surface-secondary rounded-lg p-2.5 text-center">
                        <p className="text-theme-text-primary text-lg font-bold">{integrationHealth.processed}</p>
                        <p className="text-theme-text-muted text-[10px] tracking-wide uppercase">Processed</p>
                      </div>
                      <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-2.5 text-center">
                        <p className="text-lg font-bold text-green-700 dark:text-green-400">
                          {integrationHealth.succeeded}
                        </p>
                        <p className="text-[10px] tracking-wide text-green-700 uppercase dark:text-green-400">
                          Succeeded
                        </p>
                      </div>
                      <div
                        className={`rounded-lg p-2.5 text-center ${
                          integrationHealth.failed > 0
                            ? 'border border-red-500/20 bg-red-500/10'
                            : 'bg-theme-surface-secondary'
                        }`}
                      >
                        <p
                          className={`text-lg font-bold ${
                            integrationHealth.failed > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'
                          }`}
                        >
                          {integrationHealth.failed}
                        </p>
                        <p
                          className={`text-[10px] tracking-wide uppercase ${
                            integrationHealth.failed > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-muted'
                          }`}
                        >
                          Failed
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Current integrations */}
                  {selectedFormDetail?.integrations && selectedFormDetail.integrations.length > 0 && (
                    <div className="mb-4">
                      <p className="text-theme-text-secondary mb-2 text-sm font-medium">Active Integrations</p>
                      <div className="space-y-2">
                        {selectedFormDetail.integrations.map((integ) => {
                          const mappingCount = Object.keys(integ.field_mappings ?? {}).length;
                          return (
                            <div key={integ.id} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium text-orange-700 capitalize dark:text-orange-300">
                                    {integ.target_module} &mdash; {integ.integration_type.replace(/_/g, ' ')}
                                  </p>
                                  <p className="text-theme-text-muted text-xs">
                                    {integ.is_active ? 'Active' : 'Inactive'}
                                    {mappingCount > 0 && (
                                      <>
                                        {' '}
                                        &middot; {mappingCount} field{mappingCount !== 1 ? 's' : ''} mapped
                                      </>
                                    )}
                                    {mappingCount === 0 && (
                                      <span className="text-yellow-700 dark:text-yellow-400">
                                        {' '}
                                        &middot; No field mappings configured
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <button
                                  onClick={() => {
                                    void handleDeleteIntegration(integ.id);
                                  }}
                                  className="shrink-0 rounded-sm p-1 text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                  aria-label="Delete integration"
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                              {mappingCount > 0 && (
                                <div className="mt-2 border-t border-orange-500/10 pt-2">
                                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                                    {Object.entries(integ.field_mappings).map(([formFieldId, targetKey]) => {
                                      const formField = selectedFormDetail.fields.find((f) => f.id === formFieldId);
                                      return (
                                        <div key={formFieldId} className="text-theme-text-muted truncate text-[11px]">
                                          <span className="text-theme-text-secondary">
                                            {formField?.label ?? formFieldId.slice(0, 8)}
                                          </span>
                                          {' → '}
                                          <span className="text-orange-700 dark:text-orange-400">{targetKey}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Add integration */}
                  <div className="border-theme-surface-border border-t pt-4">
                    <p className="text-theme-text-secondary mb-3 text-sm font-medium">Add Integration</p>
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="integration-target" className="text-theme-text-muted mb-1 block text-xs">
                          Target Module
                        </label>
                        <select
                          id="integration-target"
                          value={integrationTarget}
                          onChange={(e) => {
                            setIntegrationTarget(e.target.value);
                            const defaultType =
                              e.target.value === 'membership'
                                ? 'membership_interest'
                                : e.target.value === 'inventory'
                                  ? 'equipment_assignment'
                                  : e.target.value === 'events'
                                    ? 'event_registration'
                                    : 'membership_interest';
                            setIntegrationType(defaultType);
                            setFieldMappings({});
                          }}
                          className="form-input text-sm"
                        >
                          <option value="membership">Membership</option>
                          <option value="inventory">Inventory</option>
                          <option value="events">Events</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="integration-type" className="text-theme-text-muted mb-1 block text-xs">
                          Integration Type
                        </label>
                        <select
                          id="integration-type"
                          value={integrationType}
                          onChange={(e) => {
                            setIntegrationType(e.target.value);
                            setFieldMappings({});
                          }}
                          className="form-input text-sm"
                        >
                          {integrationTarget === 'membership' && (
                            <option value="membership_interest">Membership Interest</option>
                          )}
                          {integrationTarget === 'inventory' && (
                            <option value="equipment_assignment">Equipment Assignment</option>
                          )}
                          {integrationTarget === 'events' && (
                            <>
                              <option value="event_registration">Event Registration</option>
                              <option value="event_request">Event Request</option>
                            </>
                          )}
                        </select>
                      </div>

                      {/* Field Mappings */}
                      {selectedFormDetail && (INTEGRATION_TARGET_FIELDS[integrationType] ?? []).length > 0 && (
                        <div>
                          <p className="text-theme-text-muted mb-2 text-xs font-medium">
                            Map your form fields to the integration&apos;s target fields:
                          </p>
                          <div className="space-y-2">
                            {(INTEGRATION_TARGET_FIELDS[integrationType] ?? []).map((tf) => (
                              <div key={tf.key} className="flex items-center gap-2">
                                <label
                                  htmlFor={`mapping-${tf.key}`}
                                  className="text-theme-text-secondary w-32 shrink-0 truncate text-xs"
                                  title={tf.label}
                                >
                                  {tf.label}
                                  {tf.required && <span className="ml-0.5 text-red-700 dark:text-red-400">*</span>}
                                </label>
                                <select
                                  id={`mapping-${tf.key}`}
                                  value={fieldMappings[tf.key] ?? ''}
                                  onChange={(e) => setFieldMappings((prev) => ({ ...prev, [tf.key]: e.target.value }))}
                                  className="form-input-sm flex-1"
                                >
                                  <option value="">{tf.required ? 'Select a field...' : '(none)'}</option>
                                  {selectedFormDetail.fields
                                    .filter((f) => f.field_type !== FieldType.SECTION_HEADER)
                                    .sort((a, b) => a.sort_order - b.sort_order)
                                    .map((f) => (
                                      <option key={f.id} value={f.id}>
                                        {f.label} ({f.field_type})
                                      </option>
                                    ))}
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => {
                          void handleAddIntegration();
                        }}
                        className="flex w-full items-center justify-center space-x-2 rounded-lg bg-orange-600/20 px-4 py-2 text-orange-700 transition-colors hover:bg-orange-600/30 dark:text-orange-400"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        <span>Add Integration</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg flex justify-end rounded-b-lg px-6 py-3">
                  <button
                    onClick={() => setShowIntegrationModal(false)}
                    className="bg-theme-input-bg hover:bg-theme-surface-hover text-theme-text-primary rounded-lg px-4 py-2 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default FormsPage;
