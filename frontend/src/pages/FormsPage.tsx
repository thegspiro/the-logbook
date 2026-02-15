import React, { useEffect, useState } from 'react';
import {
  FormInput,
  Plus,
  FileCheck,
  Search,
  Filter,
  Copy,
  Eye,
  FileText,
  AlertTriangle,
  Clipboard,
  X,
  AlertCircle,
  ClipboardCheck,
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
} from 'lucide-react';
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
import { FormBuilder, FormRenderer, SubmissionViewer } from '../components/forms';

interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: { label: string; field_type: string; required: boolean }[];
  icon: React.ReactNode;
  color: string;
  isPublic?: boolean;
  integrationHint?: string;
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'incident-report',
    name: 'Incident Report',
    description: 'Standard incident/accident report form with injury details and witnesses',
    category: 'Safety',
    fields: [
      { label: 'Date of Incident', field_type: 'date', required: true },
      { label: 'Time of Incident', field_type: 'time', required: true },
      { label: 'Location', field_type: 'text', required: true },
      { label: 'Type of Incident', field_type: 'select', required: true },
      { label: 'Description', field_type: 'textarea', required: true },
      { label: 'Injuries Reported', field_type: 'radio', required: true },
      { label: 'Injury Details', field_type: 'textarea', required: false },
      { label: 'Witnesses', field_type: 'textarea', required: false },
      { label: 'Equipment Involved', field_type: 'text', required: false },
      { label: 'Immediate Actions Taken', field_type: 'textarea', required: true },
      { label: 'Follow-Up Required', field_type: 'checkbox', required: false },
      { label: 'Photos Attached', field_type: 'file', required: false },
      { label: 'Reported By', field_type: 'text', required: true },
      { label: 'Supervisor Notified', field_type: 'radio', required: true },
      { label: 'Additional Notes', field_type: 'textarea', required: false },
    ],
    icon: <AlertTriangle className="w-6 h-6" aria-hidden="true" />,
    color: 'text-red-400',
  },
  {
    id: 'membership-interest',
    name: 'Membership Interest Form',
    description: 'Public form for prospective members to express interest in joining your department',
    category: 'Administration',
    fields: [
      { label: 'First Name', field_type: 'text', required: true },
      { label: 'Last Name', field_type: 'text', required: true },
      { label: 'Email Address', field_type: 'email', required: true },
      { label: 'Phone Number', field_type: 'phone', required: true },
      { label: 'Date of Birth', field_type: 'date', required: false },
      { label: 'Street Address', field_type: 'text', required: false },
      { label: 'City', field_type: 'text', required: false },
      { label: 'State', field_type: 'text', required: false },
      { label: 'Zip Code', field_type: 'text', required: false },
      { label: 'Previous Fire/EMS Experience', field_type: 'radio', required: true },
      { label: 'Experience Details', field_type: 'textarea', required: false },
      { label: 'Why are you interested in joining?', field_type: 'textarea', required: true },
      { label: 'How did you hear about us?', field_type: 'select', required: false },
      { label: 'Availability', field_type: 'select', required: true },
      { label: 'Additional Information', field_type: 'textarea', required: false },
    ],
    icon: <Globe className="w-6 h-6" aria-hidden="true" />,
    color: 'text-cyan-400',
    isPublic: true,
    integrationHint: 'membership_interest',
  },
  {
    id: 'equipment-inspection',
    name: 'Equipment Inspection',
    description: 'Pre-use and periodic equipment inspection checklist',
    category: 'Operations',
    fields: [
      { label: 'Equipment Name', field_type: 'text', required: true },
      { label: 'Serial Number', field_type: 'text', required: true },
      { label: 'Inspection Date', field_type: 'date', required: true },
      { label: 'Inspector', field_type: 'text', required: true },
      { label: 'Visual Condition', field_type: 'select', required: true },
      { label: 'Functional Test', field_type: 'radio', required: true },
      { label: 'Safety Features Check', field_type: 'radio', required: true },
      { label: 'Cleanliness', field_type: 'select', required: true },
      { label: 'Defects Found', field_type: 'textarea', required: false },
      { label: 'Action Required', field_type: 'textarea', required: false },
      { label: 'Pass/Fail', field_type: 'radio', required: true },
      { label: 'Next Inspection Due', field_type: 'date', required: false },
    ],
    icon: <ClipboardCheck className="w-6 h-6" aria-hidden="true" />,
    color: 'text-emerald-400',
  },
  {
    id: 'equipment-assignment',
    name: 'Equipment Assignment',
    description: 'Quartermaster form for assigning equipment to members - integrates with inventory',
    category: 'Operations',
    fields: [
      { label: 'Assigned Member', field_type: 'member_lookup', required: true },
      { label: 'Equipment Item', field_type: 'text', required: true },
      { label: 'Serial/Asset Number', field_type: 'text', required: true },
      { label: 'Assignment Date', field_type: 'date', required: true },
      { label: 'Assignment Type', field_type: 'select', required: true },
      { label: 'Condition at Assignment', field_type: 'select', required: true },
      { label: 'Expected Return Date', field_type: 'date', required: false },
      { label: 'Reason for Assignment', field_type: 'textarea', required: false },
      { label: 'Acknowledgment', field_type: 'checkbox', required: true },
      { label: 'Notes', field_type: 'textarea', required: false },
    ],
    icon: <Plug className="w-6 h-6" aria-hidden="true" />,
    color: 'text-orange-400',
    integrationHint: 'equipment_assignment',
  },
  {
    id: 'vehicle-check',
    name: 'Apparatus Check-off',
    description: 'Daily apparatus/vehicle check-off form',
    category: 'Operations',
    fields: [
      { label: 'Apparatus Number', field_type: 'text', required: true },
      { label: 'Date', field_type: 'date', required: true },
      { label: 'Shift', field_type: 'select', required: true },
      { label: 'Checked By', field_type: 'text', required: true },
      { label: 'Mileage', field_type: 'number', required: true },
      { label: 'Fuel Level', field_type: 'select', required: true },
      { label: 'Engine Oil', field_type: 'radio', required: true },
      { label: 'Coolant Level', field_type: 'radio', required: true },
      { label: 'Tire Condition', field_type: 'radio', required: true },
      { label: 'Lights & Sirens', field_type: 'radio', required: true },
      { label: 'Pump Test', field_type: 'radio', required: true },
      { label: 'Hose Inventory', field_type: 'radio', required: true },
      { label: 'SCBA Check', field_type: 'radio', required: true },
      { label: 'Medical Supplies', field_type: 'radio', required: true },
      { label: 'Tools & Equipment', field_type: 'radio', required: true },
      { label: 'Radio Check', field_type: 'radio', required: true },
      { label: 'Body/Cab Condition', field_type: 'radio', required: true },
      { label: 'Deficiencies Found', field_type: 'textarea', required: false },
      { label: 'Actions Taken', field_type: 'textarea', required: false },
      { label: 'Overall Status', field_type: 'radio', required: true },
    ],
    icon: <Clipboard className="w-6 h-6" aria-hidden="true" />,
    color: 'text-blue-400',
  },
  {
    id: 'member-feedback',
    name: 'Member Feedback Survey',
    description: 'Anonymous feedback survey for department improvement',
    category: 'Administration',
    fields: [
      { label: 'Overall Satisfaction', field_type: 'radio', required: true },
      { label: 'Training Quality', field_type: 'radio', required: true },
      { label: 'Equipment Availability', field_type: 'radio', required: true },
      { label: 'Leadership Effectiveness', field_type: 'radio', required: true },
      { label: 'Communication Quality', field_type: 'radio', required: true },
      { label: 'What is working well?', field_type: 'textarea', required: false },
      { label: 'What needs improvement?', field_type: 'textarea', required: false },
      { label: 'Suggestions for training topics', field_type: 'textarea', required: false },
      { label: 'Equipment requests', field_type: 'textarea', required: false },
      { label: 'Additional comments', field_type: 'textarea', required: false },
    ],
    icon: <FileText className="w-6 h-6" aria-hidden="true" />,
    color: 'text-purple-400',
  },
];

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
  const [selectedFormDetail, setSelectedFormDetail] = useState<FormDetailDef | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'Operations',
    is_public: false,
  });

  // Form detail view (builder/preview/submissions)
  const [editingForm, setEditingForm] = useState<FormDetailDef | null>(null);
  const [detailTab, setDetailTab] = useState<'builder' | 'preview' | 'submissions'>('builder');

  // Integration state
  const [integrationTarget, setIntegrationTarget] = useState('membership');
  const [integrationType, setIntegrationType] = useState('membership_interest');

  const loadData = async () => {
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
      const message = err instanceof Error ? err.message : 'Failed to load forms';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchQuery, categoryFilter]);

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
      const message = err instanceof Error ? err.message : 'Failed to create form';
      setError(message);
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
        fields: template.fields.map((f, i) => ({
          label: f.label,
          field_type: f.field_type,
          required: f.required,
          sort_order: i,
        })),
      };
      await formsService.createForm(createData);
      setActiveTab('forms');
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create from template';
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
      const message = err instanceof Error ? err.message : 'Failed to publish form';
      setError(message);
    }
  };

  const handleArchive = async (formId: string) => {
    try {
      await formsService.archiveForm(formId);
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to archive form';
      setError(message);
    }
  };

  const handleDelete = async (formId: string) => {
    try {
      await formsService.deleteForm(formId);
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete form';
      setError(message);
    }
  };

  const handleTogglePublic = async (form: FormDef) => {
    try {
      await formsService.updateForm(form.id, { is_public: !form.is_public });
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update form';
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
      const message = err instanceof Error ? err.message : 'Failed to load form';
      setError(message);
    }
  };

  const handleCloseEditor = () => {
    setEditingForm(null);
    loadData(); // Refresh list to reflect any changes
  };

  const handleShareForm = (form: FormDef) => {
    setSelectedFormDetail(null);
    setSelectedFormId(form.id);
    setShowShareModal(true);
  };

  const handleOpenIntegrationModal = async (formId: string) => {
    try {
      const detail = await formsService.getForm(formId);
      setSelectedFormDetail(detail);
      setSelectedFormId(formId);
      setShowIntegrationModal(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load form details';
      setError(message);
    }
  };

  const handleAddIntegration = async () => {
    if (!selectedFormId) return;
    try {
      const data: FormIntegrationCreate = {
        target_module: integrationTarget,
        integration_type: integrationType,
        field_mappings: {},
        is_active: true,
      };
      await formsService.addIntegration(selectedFormId, data);
      const detail = await formsService.getForm(selectedFormId);
      setSelectedFormDetail(detail);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add integration';
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
      const message = err instanceof Error ? err.message : 'Failed to delete integration';
      setError(message);
    }
  };

  const copyPublicUrl = (slug: string) => {
    const url = `${window.location.origin}/f/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const getPublicUrl = (slug: string) => `${window.location.origin}/f/${slug}`;

  const filteredTemplates = STARTER_TEMPLATES.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const statusColor = (s: string) => {
    switch (s) {
      case 'published': return 'bg-green-500/10 text-green-400 border-green-500/30';
      case 'draft': return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30';
      case 'archived': return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-pink-600 rounded-lg p-2">
              <FormInput className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Custom Forms</h1>
              <p className="text-slate-400 text-sm">
                Create custom forms, public-facing pages, and cross-module integrations
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={loadData}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Refresh forms"
            >
              <RefreshCw className="w-5 h-5" aria-hidden="true" />
            </button>
            {canManage && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Create Form</span>
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8" role="region" aria-label="Forms statistics">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">Total Forms</p>
              <p className="text-white text-2xl font-bold mt-1">{summary.total_forms}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">Published</p>
              <p className="text-green-400 text-2xl font-bold mt-1">{summary.published_forms}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">Drafts</p>
              <p className="text-yellow-400 text-2xl font-bold mt-1">{summary.draft_forms}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">Public Forms</p>
              <p className="text-cyan-400 text-2xl font-bold mt-1">{summary.public_forms}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">Submissions This Month</p>
              <p className="text-pink-400 text-2xl font-bold mt-1">{summary.submissions_this_month}</p>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6" role="alert">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" aria-hidden="true" />
              <p className="text-red-300 text-sm">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300" aria-label="Dismiss error">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-white/5 rounded-lg p-1 w-fit" role="tablist" aria-label="Forms views">
          <button
            onClick={() => setActiveTab('forms')}
            role="tab"
            aria-selected={activeTab === 'forms'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'forms' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            My Forms
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            role="tab"
            aria-selected={activeTab === 'templates'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'templates' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Starter Templates
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            role="tab"
            aria-selected={activeTab === 'submissions'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'submissions' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Submissions
          </button>
        </div>

        {/* Search & Filters */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6" role="search" aria-label="Search and filter forms">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden="true" />
              <label htmlFor="forms-search" className="sr-only">Search forms</label>
              <input
                id="forms-search"
                type="text"
                placeholder="Search forms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-slate-400" aria-hidden="true" />
              <label htmlFor="forms-category-filter" className="sr-only">Filter by category</label>
              <select
                id="forms-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as FormCategory)}
                className="px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
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
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
                <RefreshCw className="w-8 h-8 text-slate-400 mx-auto mb-3 animate-spin" aria-hidden="true" />
                <p className="text-slate-300" role="status" aria-live="polite">Loading forms...</p>
              </div>
            ) : forms.length === 0 ? (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
                <FormInput className="w-16 h-16 text-slate-500 mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-white text-xl font-bold mb-2">No Custom Forms</h3>
                <p className="text-slate-300 mb-6">
                  Create a custom form from scratch or start from a starter template.
                </p>
                {canManage && (
                  <div className="flex items-center justify-center space-x-3">
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="px-6 py-3 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
                    >
                      <Plus className="w-5 h-5" aria-hidden="true" />
                      <span>Create Form</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('templates')}
                      className="px-6 py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg transition-colors inline-flex items-center space-x-2"
                    >
                      <Copy className="w-5 h-5" aria-hidden="true" />
                      <span>Use Template</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {forms.map((form) => (
                  <div key={form.id} className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 hover:border-pink-500/30 transition-all">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-white font-semibold">{form.name}</h3>
                        <div className="flex items-center space-x-2 mt-1 flex-wrap gap-y-1">
                          <span className={`px-2 py-0.5 text-xs rounded border ${statusColor(form.status)}`}>
                            {form.status}
                          </span>
                          <span className="px-2 py-0.5 text-xs bg-pink-500/10 text-pink-400 rounded border border-pink-500/30">
                            {form.category}
                          </span>
                          {form.is_public && (
                            <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded border border-cyan-500/30 inline-flex items-center space-x-1">
                              <Globe className="w-3 h-3" aria-hidden="true" />
                              <span>Public</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {form.description && (
                      <p className="text-slate-300 text-sm mb-3 line-clamp-2">{form.description}</p>
                    )}

                    {/* Public URL */}
                    {form.is_public && form.public_slug && form.status === 'published' && (
                      <div className="flex items-center space-x-2 mb-3 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2">
                        <Link className="w-4 h-4 text-cyan-400 flex-shrink-0" aria-hidden="true" />
                        <span className="text-cyan-300 text-xs truncate flex-1">{getPublicUrl(form.public_slug)}</span>
                        <button
                          onClick={() => copyPublicUrl(form.public_slug!)}
                          className="flex-shrink-0 text-cyan-400 hover:text-cyan-300 transition-colors"
                          aria-label="Copy public URL"
                        >
                          {copiedSlug === form.public_slug ? (
                            <Check className="w-4 h-4 text-green-400" aria-hidden="true" />
                          ) : (
                            <Copy className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4 text-xs text-slate-400">
                        <span>{form.field_count ?? 0} fields</span>
                        <span>{form.submission_count ?? 0} submissions</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        {canManage && (
                          <button
                            onClick={() => handleEditForm(form.id)}
                            className="p-1.5 text-pink-400 hover:text-pink-300 hover:bg-pink-500/10 rounded transition-colors"
                            aria-label="Edit form fields"
                          >
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                        <button
                          onClick={() => handleViewSubmissions(form.id)}
                          className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                          aria-label="View submissions"
                        >
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        </button>
                        {canManage && (
                          <button
                            onClick={() => handleShareForm(form)}
                            className="p-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded transition-colors"
                            aria-label="Public sharing settings"
                          >
                            <Globe className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => handleOpenIntegrationModal(form.id)}
                            className="p-1.5 text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 rounded transition-colors"
                            aria-label="Manage integrations"
                          >
                            <Plug className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                        {canManage && form.status === 'draft' && (
                          <button
                            onClick={() => handlePublish(form.id)}
                            className="p-1.5 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded transition-colors"
                            aria-label="Publish form"
                          >
                            <Send className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                        {canManage && form.status === 'published' && (
                          <button
                            onClick={() => handleArchive(form.id)}
                            className="p-1.5 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded transition-colors"
                            aria-label="Archive form"
                          >
                            <Archive className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => handleDelete(form.id)}
                            className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                            aria-label="Delete form"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTemplates.map((template) => (
              <div key={template.id} className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 hover:border-pink-500/30 transition-all">
                <div className="flex items-start space-x-4">
                  <div className={`p-3 rounded-lg bg-white/5 ${template.color}`}>
                    {template.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <h3 className="text-white font-semibold">{template.name}</h3>
                      <div className="flex items-center space-x-1">
                        {template.isPublic && (
                          <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-400 rounded border border-cyan-500/30">
                            Public
                          </span>
                        )}
                        <span className="px-2 py-0.5 text-xs bg-pink-500/10 text-pink-400 rounded border border-pink-500/30">
                          {template.category}
                        </span>
                      </div>
                    </div>
                    <p className="text-slate-300 text-sm mt-1">{template.description}</p>
                    {template.integrationHint && (
                      <div className="flex items-center space-x-1 mt-2">
                        <Plug className="w-3 h-3 text-orange-400" aria-hidden="true" />
                        <span className="text-orange-400 text-xs">Supports cross-module integration</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-slate-400 text-xs">{template.fields.length} fields</span>
                      <div className="flex space-x-2">
                        {canManage && (
                          <button
                            onClick={() => handleUseTemplate(template)}
                            disabled={creating}
                            className="px-3 py-1 text-xs bg-pink-600/20 text-pink-400 hover:bg-pink-600/30 rounded transition-colors flex items-center space-x-1 disabled:opacity-50"
                          >
                            <Copy className="w-3 h-3" aria-hidden="true" />
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
            {selectedFormId ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white text-lg font-semibold">
                    Submissions
                  </h2>
                  <button
                    onClick={() => setSelectedFormId(null)}
                    className="text-slate-400 hover:text-white text-sm"
                  >
                    Clear selection
                  </button>
                </div>
                <SubmissionViewer
                  formId={selectedFormId}
                  allowDelete={canManage}
                />
              </div>
            ) : (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
                <FileCheck className="w-16 h-16 text-slate-500 mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-white text-xl font-bold mb-2">View Submissions</h3>
                <p className="text-slate-300 mb-6">
                  Select a form from the &quot;My Forms&quot; tab to view its submissions.
                </p>
                <button
                  onClick={() => setActiveTab('forms')}
                  className="px-4 py-2 bg-pink-600/20 text-pink-400 hover:bg-pink-600/30 rounded-lg transition-colors"
                >
                  Go to My Forms
                </button>
              </div>
            )}
          </>
        )}

        {/* Form Detail / Editor View */}
        {editingForm && (
          <div
            className="fixed inset-0 z-50 bg-slate-900/95 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="form-editor-title"
            onKeyDown={(e) => { if (e.key === 'Escape') handleCloseEditor(); }}
          >
            <div className="max-w-4xl mx-auto px-6 py-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCloseEditor}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Close editor"
                  >
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <div>
                    <h2 id="form-editor-title" className="text-white text-xl font-bold">{editingForm.name}</h2>
                    <p className="text-slate-400 text-sm">{editingForm.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-xs rounded border ${statusColor(editingForm.status)}`}>
                    {editingForm.status}
                  </span>
                  <span className="px-2 py-0.5 text-xs bg-pink-500/10 text-pink-400 rounded border border-pink-500/30">
                    {editingForm.category}
                  </span>
                </div>
              </div>

              {/* Detail Tabs */}
              <div className="flex space-x-1 mb-6 bg-white/5 rounded-lg p-1 w-fit" role="tablist" aria-label="Form editor views">
                <button
                  onClick={() => setDetailTab('builder')}
                  role="tab"
                  aria-selected={detailTab === 'builder'}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    detailTab === 'builder' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Form Builder
                </button>
                <button
                  onClick={() => setDetailTab('preview')}
                  role="tab"
                  aria-selected={detailTab === 'preview'}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    detailTab === 'preview' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Preview & Submit
                </button>
                <button
                  onClick={() => setDetailTab('submissions')}
                  role="tab"
                  aria-selected={detailTab === 'submissions'}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    detailTab === 'submissions' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Submissions
                </button>
              </div>

              {/* Builder Tab */}
              {detailTab === 'builder' && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <FormBuilder formId={editingForm.id} />
                </div>
              )}

              {/* Preview & Submit Tab */}
              {detailTab === 'preview' && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <FormRenderer
                    formId={editingForm.id}
                    submitLabel="Submit Form"
                    allowResubmit
                  />
                </div>
              )}

              {/* Submissions Tab */}
              {detailTab === 'submissions' && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <SubmissionViewer
                    formId={editingForm.id}
                    allowDelete={canManage}
                  />
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
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} aria-hidden="true" />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="create-form-title" className="text-lg font-medium text-white">Create New Form</h3>
                    <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="form-name" className="block text-sm font-medium text-slate-300 mb-1">Form Name <span aria-hidden="true">*</span></label>
                      <input
                        id="form-name"
                        type="text" required aria-required="true" value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="e.g., Monthly Safety Report"
                      />
                    </div>
                    <div>
                      <label htmlFor="form-category" className="block text-sm font-medium text-slate-300 mb-1">Category</label>
                      <select
                        id="form-category"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                      >
                        <option value="Safety">Safety</option>
                        <option value="Operations">Operations</option>
                        <option value="Administration">Administration</option>
                        <option value="Training">Training</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="form-description" className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea
                        id="form-description"
                        rows={3} value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="Describe the purpose of this form..."
                      />
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
                      <input
                        type="checkbox"
                        id="is_public"
                        checked={formData.is_public}
                        onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                        className="w-4 h-4 text-cyan-600 rounded"
                      />
                      <label htmlFor="is_public" className="text-sm cursor-pointer">
                        <span className="text-cyan-300 font-medium">Public Form</span>
                        <p className="text-slate-400 text-xs mt-0.5">
                          Allow anyone to fill out this form via a public URL (no login required)
                        </p>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateForm}
                    disabled={!formData.name.trim() || creating}
                    className="px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            onKeyDown={(e) => { if (e.key === 'Escape') setShowShareModal(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowShareModal(false)} aria-hidden="true" />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="share-form-title" className="text-lg font-medium text-white flex items-center space-x-2">
                      <Globe className="w-5 h-5 text-cyan-400" aria-hidden="true" />
                      <span>Public Sharing Settings</span>
                    </h3>
                    <button onClick={() => setShowShareModal(false)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  {(() => {
                    const form = forms.find(f => f.id === selectedFormId);
                    if (!form) return null;
                    return (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                          <div>
                            <p className="text-white font-medium">Public Access</p>
                            <p className="text-slate-400 text-xs mt-0.5">
                              Anyone with the link can view and submit this form
                            </p>
                          </div>
                          <button
                            onClick={() => handleTogglePublic(form)}
                            aria-label={form.is_public ? 'Disable public access' : 'Enable public access'}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              form.is_public ? 'bg-cyan-600' : 'bg-slate-600'
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              form.is_public ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>

                        {form.is_public && form.public_slug && (
                          <>
                            <div>
                              <label htmlFor="share-public-url" className="block text-sm font-medium text-slate-300 mb-2">Public URL</label>
                              <div className="flex items-center space-x-2">
                                <input
                                  id="share-public-url"
                                  readOnly
                                  value={getPublicUrl(form.public_slug)}
                                  className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-cyan-300 text-sm"
                                  aria-label="Public URL"
                                />
                                <button
                                  onClick={() => copyPublicUrl(form.public_slug!)}
                                  className="px-3 py-2 bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 rounded-lg transition-colors"
                                  aria-label="Copy public URL"
                                >
                                  {copiedSlug === form.public_slug ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                                </button>
                                <a
                                  href={getPublicUrl(form.public_slug)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-2 bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 rounded-lg transition-colors"
                                  aria-label="Open public URL in new tab"
                                >
                                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                                </a>
                              </div>
                            </div>

                            {/* QR Code */}
                            <div>
                              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center space-x-2">
                                <QrCode className="w-4 h-4" aria-hidden="true" />
                                <span>QR Code</span>
                              </label>
                              <div className="flex flex-col items-center p-4 bg-white rounded-lg">
                                <QRCodeSVG
                                  id={`qr-${form.public_slug}`}
                                  value={getPublicUrl(form.public_slug)}
                                  size={200}
                                  level="H"
                                  includeMargin
                                />
                              </div>
                              <div className="flex items-center justify-center space-x-2 mt-2">
                                <button
                                  onClick={() => {
                                    const svg = document.getElementById(`qr-${form.public_slug}`);
                                    if (!svg) return;
                                    const svgData = new XMLSerializer().serializeToString(svg);
                                    const canvas = document.createElement('canvas');
                                    const ctx = canvas.getContext('2d');
                                    const img = new Image();
                                    img.onload = () => {
                                      canvas.width = img.width;
                                      canvas.height = img.height;
                                      ctx?.drawImage(img, 0, 0);
                                      const a = document.createElement('a');
                                      a.download = `${form.name.replace(/[^a-z0-9]/gi, '_')}_qr.png`;
                                      a.href = canvas.toDataURL('image/png');
                                      a.click();
                                    };
                                    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                                  }}
                                  className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 rounded-lg transition-colors text-sm"
                                  aria-label="Download QR code as PNG"
                                >
                                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
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
                                  className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/30 rounded-lg transition-colors text-sm"
                                  aria-label="Download QR code as SVG"
                                >
                                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Download SVG</span>
                                </button>
                              </div>
                              <p className="text-slate-400 text-xs text-center mt-2">
                                Print this QR code and place it where users can scan to access the form.
                              </p>
                            </div>

                            {form.status !== 'published' && (
                              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                <p className="text-yellow-300 text-sm">
                                  This form must be published before the public URL will be active.
                                </p>
                              </div>
                            )}
                          </>
                        )}

                        <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                          <p className="text-slate-300 text-sm">
                            Public forms allow anyone to submit without logging in. Submissions include the
                            submitter&apos;s name and email (optional) and are marked as &quot;Public&quot; in your submissions list.
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end rounded-b-lg">
                  <button
                    onClick={() => setShowShareModal(false)}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
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
            onKeyDown={(e) => { if (e.key === 'Escape') setShowIntegrationModal(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowIntegrationModal(false)} aria-hidden="true" />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="integration-modal-title" className="text-lg font-medium text-white flex items-center space-x-2">
                      <Plug className="w-5 h-5 text-orange-400" aria-hidden="true" />
                      <span>Cross-Module Integrations</span>
                    </h3>
                    <button onClick={() => setShowIntegrationModal(false)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Current integrations */}
                  {selectedFormDetail?.integrations && selectedFormDetail.integrations.length > 0 && (
                    <div className="mb-4">
                      <p className="text-slate-300 text-sm font-medium mb-2">Active Integrations</p>
                      <div className="space-y-2">
                        {selectedFormDetail.integrations.map((integ) => (
                          <div key={integ.id} className="flex items-center justify-between p-3 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                            <div>
                              <p className="text-orange-300 text-sm font-medium capitalize">
                                {integ.target_module} - {integ.integration_type.replace(/_/g, ' ')}
                              </p>
                              <p className="text-slate-400 text-xs">
                                {integ.is_active ? 'Active' : 'Inactive'}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDeleteIntegration(integ.id)}
                              className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded"
                              aria-label="Delete integration"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add integration */}
                  <div className="border-t border-white/10 pt-4">
                    <p className="text-slate-300 text-sm font-medium mb-3">Add Integration</p>
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="integration-target" className="block text-xs text-slate-400 mb-1">Target Module</label>
                        <select
                          id="integration-target"
                          value={integrationTarget}
                          onChange={(e) => {
                            setIntegrationTarget(e.target.value);
                            setIntegrationType(
                              e.target.value === 'membership' ? 'membership_interest' : 'equipment_assignment'
                            );
                          }}
                          className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          <option value="membership">Membership</option>
                          <option value="inventory">Inventory</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="integration-type" className="block text-xs text-slate-400 mb-1">Integration Type</label>
                        <select
                          id="integration-type"
                          value={integrationType}
                          onChange={(e) => setIntegrationType(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                        >
                          {integrationTarget === 'membership' ? (
                            <option value="membership_interest">Membership Interest (captures prospective member data)</option>
                          ) : (
                            <option value="equipment_assignment">Equipment Assignment (assigns items to members)</option>
                          )}
                        </select>
                      </div>

                      <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
                        <p className="text-slate-300 text-xs">
                          {integrationTarget === 'membership'
                            ? 'Membership interest integration captures form submissions as prospective member records. Admins can review and process them from the submissions view.'
                            : 'Equipment assignment integration maps form fields to inventory assignments. Use member_lookup fields to select members and map equipment fields to create assignments automatically.'
                          }
                        </p>
                      </div>

                      <button
                        onClick={handleAddIntegration}
                        className="w-full px-4 py-2 bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 rounded-lg transition-colors flex items-center justify-center space-x-2"
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                        <span>Add Integration</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end rounded-b-lg">
                  <button
                    onClick={() => setShowIntegrationModal(false)}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
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
