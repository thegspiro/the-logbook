import React, { useCallback, useEffect, useState } from 'react';
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
  BarChart3,
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
import { FormBuilder, FormRenderer, SubmissionViewer, FormResultsPanel } from '../components/forms';
import { FormStatus } from '../constants/enums';

/** Target fields each integration type expects the user to map. */
const INTEGRATION_TARGET_FIELDS: Record<string, { key: string; label: string; required: boolean }[]> = {
  membership_interest: [
    { key: 'first_name', label: 'First Name', required: true },
    { key: 'last_name', label: 'Last Name', required: true },
    { key: 'email', label: 'Email', required: true },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'mobile', label: 'Mobile', required: false },
    { key: 'date_of_birth', label: 'Date of Birth', required: false },
    { key: 'address_street', label: 'Street Address', required: false },
    { key: 'address_city', label: 'City', required: false },
    { key: 'address_state', label: 'State', required: false },
    { key: 'address_zip', label: 'ZIP Code', required: false },
    { key: 'interest_reason', label: 'Interest / Reason', required: false },
    { key: 'referral_source', label: 'Referral Source', required: false },
  ],
  equipment_assignment: [
    { key: 'member_id', label: 'Member (member_lookup field)', required: true },
    { key: 'item_id', label: 'Item ID', required: true },
    { key: 'reason', label: 'Reason / Notes', required: false },
  ],
  event_registration: [
    { key: 'event_id', label: 'Event ID', required: true },
    { key: 'notes', label: 'Notes', required: false },
  ],
  event_request: [
    { key: 'contact_name', label: 'Contact Name', required: true },
    { key: 'contact_email', label: 'Contact Email', required: true },
    { key: 'contact_phone', label: 'Contact Phone', required: false },
    { key: 'organization_name', label: 'Organization Name', required: false },
    { key: 'outreach_type', label: 'Outreach Type', required: false },
    { key: 'description', label: 'Description', required: false },
    { key: 'preferred_timeframe', label: 'Preferred Date / Timeframe', required: false },
    { key: 'audience_size', label: 'Expected Attendees', required: false },
    { key: 'venue_address', label: 'Venue / Location', required: false },
    { key: 'special_requests', label: 'Special Requests / Notes', required: false },
  ],
};

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
    color: 'text-red-700 dark:text-red-400',
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
    color: 'text-cyan-700 dark:text-cyan-400',
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
    color: 'text-emerald-700 dark:text-emerald-400',
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
    color: 'text-orange-700 dark:text-orange-400',
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
    color: 'text-blue-700 dark:text-blue-400',
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
    color: 'text-purple-700 dark:text-purple-400',
  },
  {
    id: 'community-event-request',
    name: 'Community Event Request',
    description: 'Public form for community members to request fire department participation at events',
    category: 'Administration',
    fields: [
      { label: 'Contact Name', field_type: 'text', required: true },
      { label: 'Contact Email', field_type: 'email', required: true },
      { label: 'Contact Phone', field_type: 'phone', required: false },
      { label: 'Organization Name', field_type: 'text', required: false },
      { label: 'Outreach Type', field_type: 'select', required: true },
      { label: 'Description', field_type: 'textarea', required: true },
      { label: 'Preferred Timeframe', field_type: 'text', required: false },
      { label: 'Time of Day', field_type: 'select', required: false },
      { label: 'Expected Attendees', field_type: 'number', required: false },
      { label: 'Age Group', field_type: 'select', required: false },
      { label: 'Venue Address', field_type: 'text', required: false },
      { label: 'Special Requests', field_type: 'textarea', required: false },
    ],
    icon: <Send className="w-6 h-6" aria-hidden="true" />,
    color: 'text-teal-700 dark:text-teal-400',
    isPublic: true,
    integrationHint: 'event_request',
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
  const [integrationHealth, setIntegrationHealth] = useState<{ total: number; processed: number; succeeded: number; failed: number } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formsRes, summaryRes] = await Promise.all([
        formsService.getForms({
          search: searchQuery ?? undefined,
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
        description: formData.description ?? undefined,
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
      const message = err instanceof Error ? err.message : 'Failed to load form details';
      setError(message);
    }
  };

  const handleAddIntegration = async () => {
    if (!selectedFormId) return;

    // Validate that required mappings are present
    const targetFields = INTEGRATION_TARGET_FIELDS[integrationType] ?? [];
    const missingRequired = targetFields
      .filter((tf) => tf.required && !fieldMappings[tf.key])
      .map((tf) => tf.label);
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
    void navigator.clipboard.writeText(url);
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
      case 'published': return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30';
      case 'draft': return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
      case 'archived': return 'bg-slate-500/10 text-theme-text-muted border-slate-500/30';
      default: return 'bg-slate-500/10 text-theme-text-muted border-slate-500/30';
    }
  };

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-pink-600 rounded-lg p-2">
              <FormInput className="w-6 h-6 text-theme-text-primary" aria-hidden="true" />
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
              onClick={() => { void loadData(); }}
              className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
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
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Total Forms</p>
              <p className="text-theme-text-primary text-2xl font-bold mt-1">{summary.total_forms}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Published</p>
              <p className="text-green-700 dark:text-green-400 text-2xl font-bold mt-1">{summary.published_forms}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Drafts</p>
              <p className="text-yellow-700 dark:text-yellow-400 text-2xl font-bold mt-1">{summary.draft_forms}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Public Forms</p>
              <p className="text-cyan-700 dark:text-cyan-400 text-2xl font-bold mt-1">{summary.public_forms}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Submissions This Month</p>
              <p className="text-pink-700 dark:text-pink-400 text-2xl font-bold mt-1">{summary.submissions_this_month}</p>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6" role="alert">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300" aria-label="Dismiss error">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-theme-surface-secondary rounded-lg p-1 w-fit" role="tablist" aria-label="Forms views">
          <button
            onClick={() => setActiveTab('forms')}
            role="tab"
            aria-selected={activeTab === 'forms'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'forms' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            My Forms
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            role="tab"
            aria-selected={activeTab === 'templates'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'templates' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            Starter Templates
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            role="tab"
            aria-selected={activeTab === 'submissions'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'submissions' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            Submissions
          </button>
        </div>

        {/* Search & Filters */}
        <div className="card mb-6 p-4" role="search" aria-label="Search and filter forms">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
              <label htmlFor="forms-search" className="sr-only">Search forms</label>
              <input
                id="forms-search"
                type="text"
                placeholder="Search forms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input focus:ring-pink-500 pl-10 placeholder-theme-text-muted pr-4"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />
              <label htmlFor="forms-category-filter" className="sr-only">Filter by category</label>
              <select
                id="forms-category-filter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as FormCategory)}
                className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-pink-500"
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
              <div className="card p-12 text-center">
                <RefreshCw className="w-8 h-8 text-theme-text-muted mx-auto mb-3 animate-spin" aria-hidden="true" />
                <p className="text-theme-text-secondary" role="status" aria-live="polite">Loading forms...</p>
              </div>
            ) : forms.length === 0 ? (
              <div className="card p-12 text-center">
                <FormInput className="w-16 h-16 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Custom Forms Yet</h3>
                <p className="text-theme-text-secondary mb-2">
                  Build custom forms for incident reports, equipment inspections, public signup pages, and more.
                </p>
                <p className="text-theme-text-muted text-sm mb-6">
                  Start from a template for a quick setup, or create a blank form from scratch.
                </p>
                {canManage && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex items-center justify-center space-x-3">
                      <button
                        onClick={() => setActiveTab('templates')}
                        className="px-6 py-3 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
                      >
                        <Copy className="w-5 h-5" aria-hidden="true" />
                        <span>Browse Templates</span>
                      </button>
                      <button
                        onClick={() => setShowCreateModal(true)}
                        className="px-6 py-3 bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-secondary rounded-lg transition-colors inline-flex items-center space-x-2"
                      >
                        <Plus className="w-5 h-5" aria-hidden="true" />
                        <span>Blank Form</span>
                      </button>
                    </div>
                    <p className="text-theme-text-muted text-xs mt-2">
                      Tip: The &quot;Membership Interest Form&quot; template is great for collecting prospective member signups from a public link.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {forms.map((form) => (
                  <div key={form.id} className="stat-card hover:border-pink-500/30 transition-all">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="text-theme-text-primary font-semibold">{form.name}</h3>
                        <div className="flex items-center space-x-2 mt-1 flex-wrap gap-y-1">
                          <span className={`px-2 py-0.5 text-xs rounded-sm border ${statusColor(form.status)}`}>
                            {form.status}
                          </span>
                          <span className="px-2 py-0.5 text-xs bg-pink-500/10 text-pink-700 dark:text-pink-400 rounded-sm border border-pink-500/30">
                            {form.category}
                          </span>
                          {form.is_public && (
                            <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 rounded-sm border border-cyan-500/30 inline-flex items-center space-x-1">
                              <Globe className="w-3 h-3" aria-hidden="true" />
                              <span>Public</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {form.description && (
                      <p className="text-theme-text-secondary text-sm mb-3 line-clamp-2">{form.description}</p>
                    )}

                    {/* Public URL */}
                    {form.is_public && form.public_slug && form.status === FormStatus.PUBLISHED && (
                      <div className="flex items-center space-x-2 mb-3 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2">
                        <Link className="w-4 h-4 text-cyan-700 dark:text-cyan-400 shrink-0" aria-hidden="true" />
                        <span className="text-cyan-700 dark:text-cyan-300 text-xs truncate flex-1">{getPublicUrl(form.public_slug)}</span>
                        <button
                          onClick={() => copyPublicUrl(form.public_slug ?? '')}
                          className="shrink-0 text-cyan-700 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 transition-colors"
                          aria-label="Copy public URL"
                        >
                          {copiedSlug === form.public_slug ? (
                            <Check className="w-4 h-4 text-green-700 dark:text-green-400" aria-hidden="true" />
                          ) : (
                            <Copy className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    )}

                    {/* Workflow guidance for draft forms */}
                    {canManage && form.status === FormStatus.DRAFT && (
                      <div className="mb-3 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
                        <p className="text-yellow-700 dark:text-yellow-300 text-xs font-medium mb-1">Next steps:</p>
                        <div className="flex items-center gap-3 text-xs text-yellow-700 dark:text-yellow-400">
                          <span className={`flex items-center gap-1 ${(form.field_count ?? 0) > 0 ? 'line-through opacity-50' : 'font-medium'}`}>
                            <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">1</span>
                            Add fields
                          </span>
                          <span className="text-yellow-500/40">&rarr;</span>
                          <span className="flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">2</span>
                            Publish
                          </span>
                          <span className="text-yellow-500/40">&rarr;</span>
                          <span className="flex items-center gap-1">
                            <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">3</span>
                            Share link
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4 text-xs text-theme-text-muted">
                        <span>{form.field_count ?? 0} fields</span>
                        <span>{form.submission_count ?? 0} submissions</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-theme-surface-border">
                      {canManage && (
                        <button
                          onClick={() => { void handleEditForm(form.id); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-pink-700 dark:text-pink-400 bg-pink-500/10 hover:bg-pink-500/20 rounded-lg transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          Edit Fields
                        </button>
                      )}
                      <button
                        onClick={() => handleViewSubmissions(form.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-theme-text-muted hover:text-theme-text-primary bg-theme-surface-secondary hover:bg-theme-surface-hover rounded-lg transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        Submissions
                      </button>
                      {canManage && (
                        <button
                          onClick={() => handleShareForm(form)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 rounded-lg transition-colors"
                        >
                          <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                          Share
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={() => { void handleOpenIntegrationModal(form.id); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-orange-700 dark:text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 rounded-lg transition-colors"
                        >
                          <Plug className="w-3.5 h-3.5" aria-hidden="true" />
                          Integrations
                        </button>
                      )}
                      {canManage && form.status === FormStatus.DRAFT && (
                        <button
                          onClick={() => { void handlePublish(form.id); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20 rounded-lg transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" aria-hidden="true" />
                          Publish
                        </button>
                      )}
                      {canManage && form.status === FormStatus.PUBLISHED && (
                        <button
                          onClick={() => { void handleArchive(form.id); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-yellow-700 dark:text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-lg transition-colors"
                        >
                          <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                          Archive
                        </button>
                      )}
                      {canManage && (
                        <button
                          onClick={() => { void handleDelete(form.id); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors ml-auto"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTemplates.map((template) => (
              <div key={template.id} className="stat-card hover:border-pink-500/30 transition-all">
                <div className="flex items-start space-x-4">
                  <div className={`p-3 rounded-lg bg-theme-surface-secondary ${template.color}`}>
                    {template.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <h3 className="text-theme-text-primary font-semibold">{template.name}</h3>
                      <div className="flex items-center space-x-1">
                        {template.isPublic && (
                          <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 rounded-sm border border-cyan-500/30">
                            Public
                          </span>
                        )}
                        <span className="px-2 py-0.5 text-xs bg-pink-500/10 text-pink-700 dark:text-pink-400 rounded-sm border border-pink-500/30">
                          {template.category}
                        </span>
                      </div>
                    </div>
                    <p className="text-theme-text-secondary text-sm mt-1">{template.description}</p>
                    {template.integrationHint && (
                      <div className="flex items-center space-x-1 mt-2">
                        <Plug className="w-3 h-3 text-orange-700 dark:text-orange-400" aria-hidden="true" />
                        <span className="text-orange-700 dark:text-orange-400 text-xs">Supports cross-module integration</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-theme-text-muted text-xs">{template.fields.length} fields</span>
                      <div className="flex space-x-2">
                        {canManage && (
                          <button
                            onClick={() => { void handleUseTemplate(template); }}
                            disabled={creating}
                            className="px-3 py-1 text-xs bg-pink-600/20 text-pink-700 dark:text-pink-400 hover:bg-pink-600/30 rounded-sm transition-colors flex items-center space-x-1 disabled:opacity-50"
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
            {/* Form selector dropdown */}
            <div className="flex items-center gap-3 mb-4">
              <label htmlFor="submission-form-select" className="text-sm font-medium text-theme-text-secondary shrink-0">
                Form:
              </label>
              <select
                id="submission-form-select"
                value={selectedFormId ?? ''}
                onChange={(e) => { setSelectedFormId(e.target.value || null); setSubmissionsView('list'); }}
                className="card-secondary focus:border-pink-500 focus:ring-2 focus:ring-pink-500 px-3 py-2 text-sm text-theme-text-primary flex-1 max-w-md"
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
                <div className="flex bg-theme-surface-secondary rounded-lg p-0.5">
                  <button
                    onClick={() => setSubmissionsView('list')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                      submissionsView === 'list' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    Responses
                  </button>
                  <button
                    onClick={() => setSubmissionsView('results')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                      submissionsView === 'results' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    <BarChart3 className="w-3 h-3" />
                    Results
                  </button>
                </div>
              )}
            </div>

            {selectedFormId ? (
              submissionsView === 'list' ? (
                <SubmissionViewer
                  formId={selectedFormId}
                  allowDelete={canManage}
                />
              ) : (
                <FormResultsPanel formId={selectedFormId} />
              )
            ) : (
              <div className="card-secondary p-12 text-center">
                <FileCheck className="w-12 h-12 text-theme-text-muted mx-auto mb-3" aria-hidden="true" />
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
            className="fixed inset-0 z-50 bg-theme-surface overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="form-editor-title"
            onKeyDown={(e) => { if (e.key === 'Escape') handleCloseEditor(); }}
          >
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCloseEditor}
                    className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
                    aria-label="Close editor"
                  >
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <div>
                    <h2 id="form-editor-title" className="text-theme-text-primary text-xl font-bold">{editingForm.name}</h2>
                    <p className="text-theme-text-muted text-sm">{editingForm.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 text-xs rounded-sm border ${statusColor(editingForm.status)}`}>
                    {editingForm.status}
                  </span>
                  <span className="px-2 py-0.5 text-xs bg-pink-500/10 text-pink-700 dark:text-pink-400 rounded-sm border border-pink-500/30">
                    {editingForm.category}
                  </span>
                </div>
              </div>

              {/* Detail Tabs */}
              <div className="flex space-x-1 mb-6 bg-theme-surface-secondary rounded-lg p-1 w-fit" role="tablist" aria-label="Form editor views">
                <button
                  onClick={() => setDetailTab('builder')}
                  role="tab"
                  aria-selected={detailTab === 'builder'}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    detailTab === 'builder' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  Form Builder
                </button>
                <button
                  onClick={() => setDetailTab('preview')}
                  role="tab"
                  aria-selected={detailTab === 'preview'}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    detailTab === 'preview' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  Preview & Submit
                </button>
                <button
                  onClick={() => setDetailTab('submissions')}
                  role="tab"
                  aria-selected={detailTab === 'submissions'}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    detailTab === 'submissions' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  Submissions
                </button>
                <button
                  onClick={() => setDetailTab('results')}
                  role="tab"
                  aria-selected={detailTab === 'results'}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    detailTab === 'results' ? 'bg-pink-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  Results
                </button>
              </div>

              {/* Builder Tab */}
              {detailTab === 'builder' && (
                <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-6">
                  <FormBuilder formId={editingForm.id} />
                </div>
              )}

              {/* Preview & Submit Tab */}
              {detailTab === 'preview' && (
                <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-6">
                  <FormRenderer
                    formId={editingForm.id}
                    submitLabel="Submit Form"
                    allowResubmit
                  />
                </div>
              )}

              {/* Submissions Tab */}
              {detailTab === 'submissions' && (
                <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-6">
                  <SubmissionViewer
                    formId={editingForm.id}
                    allowDelete={canManage}
                  />
                </div>
              )}

              {/* Results Tab */}
              {detailTab === 'results' && (
                <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-6">
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
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="create-form-title" className="text-lg font-medium text-theme-text-primary">Create New Form</h3>
                    <button onClick={() => setShowCreateModal(false)} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="form-name" className="block text-sm font-medium text-theme-text-secondary mb-1">Form Name <span aria-hidden="true">*</span></label>
                      <input
                        id="form-name"
                        type="text" required aria-required="true" value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="form-input focus:ring-pink-500"
                        placeholder="e.g., Monthly Safety Report"
                      />
                    </div>
                    <div>
                      <label htmlFor="form-category" className="block text-sm font-medium text-theme-text-secondary mb-1">Category</label>
                      <select
                        id="form-category"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="form-input focus:ring-pink-500"
                      >
                        <option value="Safety">Safety</option>
                        <option value="Operations">Operations</option>
                        <option value="Administration">Administration</option>
                        <option value="Training">Training</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="form-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
                      <textarea
                        id="form-description"
                        rows={3} value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="form-input focus:ring-pink-500"
                        placeholder="Describe the purpose of this form..."
                      />
                    </div>
                    <div className="flex items-center space-x-3 p-3 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
                      <input
                        type="checkbox"
                        id="is_public"
                        checked={formData.is_public}
                        onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })}
                        className="w-4 h-4 text-cyan-600 rounded-sm"
                      />
                      <label htmlFor="is_public" className="text-sm cursor-pointer">
                        <span className="text-cyan-700 dark:text-cyan-300 font-medium">Public Form</span>
                        <p className="text-theme-text-muted text-xs mt-0.5">
                          Allow anyone to fill out this form via a public URL (no login required)
                        </p>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-input-bg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { void handleCreateForm(); }}
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
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="share-form-title" className="text-lg font-medium text-theme-text-primary flex items-center space-x-2">
                      <Globe className="w-5 h-5 text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
                      <span>Public Sharing Settings</span>
                    </h3>
                    <button onClick={() => setShowShareModal(false)} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  {(() => {
                    const form = forms.find(f => f.id === selectedFormId);
                    if (!form) return null;
                    return (
                      <div className="space-y-4">
                        <div className="card-secondary flex items-center justify-between p-4">
                          <div>
                            <p className="text-theme-text-primary font-medium">Public Access</p>
                            <p className="text-theme-text-muted text-xs mt-0.5">
                              Anyone with the link can view and submit this form
                            </p>
                          </div>
                          <button
                            onClick={() => { void handleTogglePublic(form); }}
                            aria-label={form.is_public ? 'Disable public access' : 'Enable public access'}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              form.is_public ? 'bg-cyan-600' : 'bg-theme-surface-hover'
                            }`}
                          >
                            <span className={`toggle-knob-sm ${
                              form.is_public ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                        </div>

                        {form.is_public && form.public_slug && (
                          <>
                            <div>
                              <label htmlFor="share-public-url" className="block text-sm font-medium text-theme-text-secondary mb-2">Public URL</label>
                              <div className="flex items-center space-x-2">
                                <input
                                  id="share-public-url"
                                  readOnly
                                  value={getPublicUrl(form.public_slug)}
                                  className="flex-1 px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-cyan-700 dark:text-cyan-300 text-sm"
                                  aria-label="Public URL"
                                />
                                <button
                                  onClick={() => copyPublicUrl(form.public_slug ?? '')}
                                  className="px-3 py-2 bg-cyan-600/20 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-600/30 rounded-lg transition-colors"
                                  aria-label="Copy public URL"
                                >
                                  {copiedSlug === form.public_slug ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                                </button>
                                <a
                                  href={getPublicUrl(form.public_slug)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-2 bg-cyan-600/20 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-600/30 rounded-lg transition-colors"
                                  aria-label="Open public URL in new tab"
                                >
                                  <ExternalLink className="w-4 h-4" aria-hidden="true" />
                                </a>
                              </div>
                            </div>

                            {/* QR Code */}
                            <div>
                              <label className="block text-sm font-medium text-theme-text-secondary mb-2 flex items-center space-x-2">
                                <QrCode className="w-4 h-4" aria-hidden="true" />
                                <span>QR Code</span>
                              </label>
                              <div className="flex flex-col items-center p-4 bg-white dark:bg-slate-900 rounded-lg border border-theme-surface-border">
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
                                  className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-600/20 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-600/30 rounded-lg transition-colors text-sm"
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
                                  className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-600/20 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-600/30 rounded-lg transition-colors text-sm"
                                  aria-label="Download QR code as SVG"
                                >
                                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Download SVG</span>
                                </button>
                              </div>
                              <p className="text-theme-text-muted text-xs text-center mt-2">
                                Print this QR code and place it where users can scan to access the form.
                              </p>
                            </div>

                            {form.status !== 'published' && (
                              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                <p className="text-yellow-700 dark:text-yellow-300 text-sm">
                                  This form must be published before the public URL will be active.
                                </p>
                              </div>
                            )}
                          </>
                        )}

                        <div className="card-secondary p-3">
                          <p className="text-theme-text-secondary text-sm">
                            Public forms allow anyone to submit without logging in. Submissions include the
                            submitter&apos;s name and email (optional) and are marked as &quot;Public&quot; in your submissions list.
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end rounded-b-lg">
                  <button
                    onClick={() => setShowShareModal(false)}
                    className="px-4 py-2 bg-theme-input-bg hover:bg-theme-surface-hover text-theme-text-primary rounded-lg transition-colors"
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
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="integration-modal-title" className="text-lg font-medium text-theme-text-primary flex items-center space-x-2">
                      <Plug className="w-5 h-5 text-orange-700 dark:text-orange-400" aria-hidden="true" />
                      <span>Cross-Module Integrations</span>
                    </h3>
                    <button onClick={() => setShowIntegrationModal(false)} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Integration Health Stats */}
                  {integrationHealth && integrationHealth.processed > 0 && (
                    <div className="mb-4 grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-theme-surface-secondary p-2.5 text-center">
                        <p className="text-lg font-bold text-theme-text-primary">{integrationHealth.processed}</p>
                        <p className="text-[10px] text-theme-text-muted uppercase tracking-wide">Processed</p>
                      </div>
                      <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-2.5 text-center">
                        <p className="text-lg font-bold text-green-700 dark:text-green-400">{integrationHealth.succeeded}</p>
                        <p className="text-[10px] text-green-700 dark:text-green-400 uppercase tracking-wide">Succeeded</p>
                      </div>
                      <div className={`rounded-lg p-2.5 text-center ${
                        integrationHealth.failed > 0
                          ? 'bg-red-500/10 border border-red-500/20'
                          : 'bg-theme-surface-secondary'
                      }`}>
                        <p className={`text-lg font-bold ${
                          integrationHealth.failed > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'
                        }`}>{integrationHealth.failed}</p>
                        <p className={`text-[10px] uppercase tracking-wide ${
                          integrationHealth.failed > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-muted'
                        }`}>Failed</p>
                      </div>
                    </div>
                  )}

                  {/* Current integrations */}
                  {selectedFormDetail?.integrations && selectedFormDetail.integrations.length > 0 && (
                    <div className="mb-4">
                      <p className="text-theme-text-secondary text-sm font-medium mb-2">Active Integrations</p>
                      <div className="space-y-2">
                        {selectedFormDetail.integrations.map((integ) => {
                          const mappingCount = Object.keys(integ.field_mappings ?? {}).length;
                          return (
                            <div key={integ.id} className="p-3 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-orange-700 dark:text-orange-300 text-sm font-medium capitalize">
                                    {integ.target_module} &mdash; {integ.integration_type.replace(/_/g, ' ')}
                                  </p>
                                  <p className="text-theme-text-muted text-xs">
                                    {integ.is_active ? 'Active' : 'Inactive'}
                                    {mappingCount > 0 && <> &middot; {mappingCount} field{mappingCount !== 1 ? 's' : ''} mapped</>}
                                    {mappingCount === 0 && <span className="text-yellow-700 dark:text-yellow-400"> &middot; No field mappings configured</span>}
                                  </p>
                                </div>
                                <button
                                  onClick={() => { void handleDeleteIntegration(integ.id); }}
                                  className="p-1 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-500/10 rounded-sm shrink-0"
                                  aria-label="Delete integration"
                                >
                                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                                </button>
                              </div>
                              {mappingCount > 0 && (
                                <div className="mt-2 pt-2 border-t border-orange-500/10">
                                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                                    {Object.entries(integ.field_mappings).map(([formFieldId, targetKey]) => {
                                      const formField = selectedFormDetail.fields.find((f) => f.id === formFieldId);
                                      return (
                                        <div key={formFieldId} className="text-[11px] text-theme-text-muted truncate">
                                          <span className="text-theme-text-secondary">{formField?.label ?? formFieldId.slice(0, 8)}</span>
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
                  <div className="border-t border-theme-surface-border pt-4">
                    <p className="text-theme-text-secondary text-sm font-medium mb-3">Add Integration</p>
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="integration-target" className="block text-xs text-theme-text-muted mb-1">Target Module</label>
                        <select
                          id="integration-target"
                          value={integrationTarget}
                          onChange={(e) => {
                            setIntegrationTarget(e.target.value);
                            const defaultType = e.target.value === 'membership' ? 'membership_interest'
                              : e.target.value === 'inventory' ? 'equipment_assignment'
                              : e.target.value === 'events' ? 'event_registration'
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
                        <label htmlFor="integration-type" className="block text-xs text-theme-text-muted mb-1">Integration Type</label>
                        <select
                          id="integration-type"
                          value={integrationType}
                          onChange={(e) => { setIntegrationType(e.target.value); setFieldMappings({}); }}
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
                          <p className="text-xs font-medium text-theme-text-muted mb-2">
                            Map your form fields to the integration&apos;s target fields:
                          </p>
                          <div className="space-y-2">
                            {(INTEGRATION_TARGET_FIELDS[integrationType] ?? []).map((tf) => (
                              <div key={tf.key} className="flex items-center gap-2">
                                <label
                                  htmlFor={`mapping-${tf.key}`}
                                  className="text-xs text-theme-text-secondary w-32 shrink-0 truncate"
                                  title={tf.label}
                                >
                                  {tf.label}
                                  {tf.required && <span className="text-red-700 dark:text-red-400 ml-0.5">*</span>}
                                </label>
                                <select
                                  id={`mapping-${tf.key}`}
                                  value={fieldMappings[tf.key] ?? ''}
                                  onChange={(e) => setFieldMappings((prev) => ({ ...prev, [tf.key]: e.target.value }))}
                                  className="card-secondary focus:border-pink-500 focus:ring-2 focus:ring-pink-500 px-2 py-1.5 text-xs text-theme-text-primary flex-1"
                                >
                                  <option value="">{tf.required ? 'Select a field...' : '(none)'}</option>
                                  {selectedFormDetail.fields
                                    .filter((f) => f.field_type !== 'section_header')
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
                        onClick={() => { void handleAddIntegration(); }}
                        className="w-full px-4 py-2 bg-orange-600/20 text-orange-700 dark:text-orange-400 hover:bg-orange-600/30 rounded-lg transition-colors flex items-center justify-center space-x-2"
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                        <span>Add Integration</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end rounded-b-lg">
                  <button
                    onClick={() => setShowIntegrationModal(false)}
                    className="px-4 py-2 bg-theme-input-bg hover:bg-theme-surface-hover text-theme-text-primary rounded-lg transition-colors"
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
