/**
 * Compliance Requirements Configuration Page
 *
 * Allows compliance officers to configure:
 * - Compliance thresholds (what % = compliant vs at-risk vs non-compliant)
 * - Compliance profiles (role/membership-based requirement sets)
 * - Report scheduling (monthly/yearly auto-generation + email)
 * - Manual report generation and history
 */

import type { ChangeEvent, ReactElement } from 'react';
import { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Users,
  FileText,
  Plus,
  Trash2,
  Save,
  Mail,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Shield,
  BarChart3,
  Send,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDate, formatDateCustom } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { complianceConfigService } from '../services/trainingServices';
import type {
  ComplianceConfigData,
  ComplianceConfigUpdate,
  ComplianceProfile,
  ComplianceProfileCreate,
  AvailableRequirement,
  ComplianceReportSummary,
  ComplianceReportGenerate,
} from '../types/training';

// Shared form input classes
const inputClass = 'form-input';
const selectClass = 'form-input';
const labelClass = 'form-label';
const checkboxClass = 'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500';

type ActiveTab = 'thresholds' | 'profiles' | 'reports' | 'schedule';

const MEMBERSHIP_TYPES = [
  'active',
  'probationary',
  'administrative',
  'life',
  'retired',
  'honorary',
  'associate',
  'junior',
];

const REPORT_FREQUENCIES = [
  { value: 'none', label: 'Disabled' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

export default function ComplianceRequirementsConfigPage() {
  const tz = useTimezone();
  const [activeTab, setActiveTab] = useState<ActiveTab>('thresholds');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState<ComplianceConfigData | null>(null);
  const [requirements, setRequirements] = useState<AvailableRequirement[]>([]);
  const [reports, setReports] = useState<ComplianceReportSummary[]>([]);
  const [reportsTotal, setReportsTotal] = useState(0);

  // Config form state
  const [thresholdType, setThresholdType] = useState('percentage');
  const [compliantThreshold, setCompliantThreshold] = useState(100);
  const [atRiskThreshold, setAtRiskThreshold] = useState(75);
  const [gracePeriodDays, setGracePeriodDays] = useState(0);
  const [autoReportFrequency, setAutoReportFrequency] = useState('none');
  const [reportEmailRecipients, setReportEmailRecipients] = useState('');
  const [reportDayOfMonth, setReportDayOfMonth] = useState(1);
  const [notifyNonCompliant, setNotifyNonCompliant] = useState(false);
  const [notifyDaysBefore, setNotifyDaysBefore] = useState('30, 14, 7');

  // Profile form state
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileDescription, setProfileDescription] = useState('');
  const [profileMembershipTypes, setProfileMembershipTypes] = useState<string[]>([]);
  const [profileRequiredReqs, setProfileRequiredReqs] = useState<string[]>([]);
  const [profileOptionalReqs, setProfileOptionalReqs] = useState<string[]>([]);
  const [profileCompliantOverride, setProfileCompliantOverride] = useState('');
  const [profileAtRiskOverride, setProfileAtRiskOverride] = useState('');
  const [profilePriority, setProfilePriority] = useState(0);

  // Report generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportType, setReportType] = useState('monthly');
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1);
  const [reportSendEmail, setReportSendEmail] = useState(false);
  const [reportAdditionalRecipients, setReportAdditionalRecipients] = useState('');

  // Email modal state
  const [emailModalReportId, setEmailModalReportId] = useState<string | null>(null);
  const [emailRecipients, setEmailRecipients] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const data = await complianceConfigService.getConfig();
      setConfig(data);
      if (data) {
        setThresholdType(data.thresholdType);
        setCompliantThreshold(data.compliantThreshold);
        setAtRiskThreshold(data.atRiskThreshold);
        setGracePeriodDays(data.gracePeriodDays);
        setAutoReportFrequency(data.autoReportFrequency);
        setReportEmailRecipients(data.reportEmailRecipients?.join(', ') ?? '');
        setReportDayOfMonth(data.reportDayOfMonth ?? 1);
        setNotifyNonCompliant(data.notifyNonCompliantMembers);
        setNotifyDaysBefore(data.notifyDaysBeforeDeadline?.join(', ') ?? '30, 14, 7');
      }
    } catch {
      toast.error('Failed to load compliance configuration');
    }
  }, []);

  const loadRequirements = useCallback(async () => {
    try {
      const data = await complianceConfigService.getAvailableRequirements();
      setRequirements(data.requirements);
    } catch {
      // Non-critical — requirements list may be empty
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const data = await complianceConfigService.listReports({ limit: 20 });
      setReports(data.reports);
      setReportsTotal(data.total);
    } catch {
      toast.error('Failed to load reports');
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([loadConfig(), loadRequirements(), loadReports()]);
      setIsLoading(false);
    };
    void load();
  }, [loadConfig, loadRequirements, loadReports]);

  const handleSaveConfig = async () => {
    setIsSaving(true);
    try {
      const recipientsList = reportEmailRecipients
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      const daysList = notifyDaysBefore
        .split(',')
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !isNaN(n));

      const updateData: ComplianceConfigUpdate = {
        threshold_type: thresholdType,
        compliant_threshold: compliantThreshold,
        at_risk_threshold: atRiskThreshold,
        grace_period_days: gracePeriodDays,
        auto_report_frequency: autoReportFrequency,
        report_email_recipients: recipientsList.length > 0 ? recipientsList : undefined,
        report_day_of_month: reportDayOfMonth,
        notify_non_compliant_members: notifyNonCompliant,
        notify_days_before_deadline: daysList.length > 0 ? daysList : undefined,
      };

      if (config) {
        await complianceConfigService.updateConfig(updateData);
      } else {
        await complianceConfigService.initializeConfig(updateData);
      }

      await loadConfig();
      toast.success('Configuration saved');
    } catch {
      toast.error('Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const resetProfileForm = () => {
    setEditingProfileId(null);
    setProfileName('');
    setProfileDescription('');
    setProfileMembershipTypes([]);
    setProfileRequiredReqs([]);
    setProfileOptionalReqs([]);
    setProfileCompliantOverride('');
    setProfileAtRiskOverride('');
    setProfilePriority(0);
    setShowProfileForm(false);
  };

  const startEditProfile = (profile: ComplianceProfile) => {
    setEditingProfileId(profile.id);
    setProfileName(profile.name);
    setProfileDescription(profile.description ?? '');
    setProfileMembershipTypes(profile.membershipTypes ?? []);
    setProfileRequiredReqs(profile.requiredRequirementIds ?? []);
    setProfileOptionalReqs(profile.optionalRequirementIds ?? []);
    setProfileCompliantOverride(
      profile.compliantThresholdOverride?.toString() ?? '',
    );
    setProfileAtRiskOverride(
      profile.atRiskThresholdOverride?.toString() ?? '',
    );
    setProfilePriority(profile.priority);
    setShowProfileForm(true);
  };

  const handleSaveProfile = async () => {
    if (!profileName.trim()) {
      toast.error('Profile name is required');
      return;
    }

    setIsSaving(true);
    try {
      const profileData: ComplianceProfileCreate = {
        name: profileName.trim(),
        description: profileDescription.trim() || undefined,
        membership_types:
          profileMembershipTypes.length > 0 ? profileMembershipTypes : undefined,
        required_requirement_ids:
          profileRequiredReqs.length > 0 ? profileRequiredReqs : undefined,
        optional_requirement_ids:
          profileOptionalReqs.length > 0 ? profileOptionalReqs : undefined,
        compliant_threshold_override: profileCompliantOverride
          ? parseFloat(profileCompliantOverride)
          : undefined,
        at_risk_threshold_override: profileAtRiskOverride
          ? parseFloat(profileAtRiskOverride)
          : undefined,
        priority: profilePriority,
      };

      if (editingProfileId) {
        await complianceConfigService.updateProfile(editingProfileId, profileData);
        toast.success('Profile updated');
      } else {
        await complianceConfigService.createProfile(profileData);
        toast.success('Profile created');
      }

      resetProfileForm();
      await loadConfig();
    } catch {
      toast.error('Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!window.confirm('Delete this compliance profile?')) return;
    try {
      await complianceConfigService.deleteProfile(profileId);
      toast.success('Profile deleted');
      await loadConfig();
    } catch {
      toast.error('Failed to delete profile');
    }
  };

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    try {
      const additionalList = reportAdditionalRecipients
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);

      const data: ComplianceReportGenerate = {
        report_type: reportType,
        year: reportYear,
        month: reportType === 'monthly' ? reportMonth : undefined,
        send_email: reportSendEmail,
        additional_recipients: additionalList.length > 0 ? additionalList : undefined,
      };

      await complianceConfigService.generateReport(data);
      toast.success('Report generated successfully');
      await loadReports();
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEmailReport = async () => {
    if (!emailModalReportId) return;
    const recipients = emailRecipients
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      toast.error('Enter at least one email address');
      return;
    }
    try {
      await complianceConfigService.emailReport(emailModalReportId, recipients);
      toast.success('Report emailed');
      setEmailModalReportId(null);
      setEmailRecipients('');
      await loadReports();
    } catch {
      toast.error('Failed to email report');
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    if (!window.confirm('Delete this report?')) return;
    try {
      await complianceConfigService.deleteReport(reportId);
      toast.success('Report deleted');
      await loadReports();
    } catch {
      toast.error('Failed to delete report');
    }
  };

  const toggleMembershipType = (type: string) => {
    setProfileMembershipTypes((prev: string[]) =>
      prev.includes(type) ? prev.filter((t: string) => t !== type) : [...prev, type],
    );
  };

  const toggleRequirement = (
    reqId: string,
    list: string[],
    setter: (v: string[]) => void,
  ) => {
    setter(
      list.includes(reqId) ? list.filter((id: string) => id !== reqId) : [...list, reqId],
    );
  };

  const getRequirementName = (id: string) => {
    return requirements.find((r: AvailableRequirement) => r.id === id)?.name ?? id;
  };

  const tabs: { id: ActiveTab; label: string; icon: ReactElement }[] = [
    { id: 'thresholds', label: 'Thresholds', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'profiles', label: 'Profiles', icon: <Users className="h-4 w-4" /> },
    { id: 'schedule', label: 'Auto Reports', icon: <Clock className="h-4 w-4" /> },
    { id: 'reports', label: 'Report History', icon: <FileText className="h-4 w-4" /> },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-theme-text-secondary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">
              Compliance Requirements Configuration
            </h1>
            <p className="text-sm text-theme-text-secondary">
              Define what makes members compliant, configure profiles, and schedule reports
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-theme-surface-border bg-theme-surface p-1">
        {tabs.map((tab: { id: ActiveTab; label: string; icon: ReactElement }) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'thresholds' && (
        <div className="space-y-6 rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-theme-text-secondary" />
            <h2 className="text-lg font-semibold text-theme-text-primary">
              Compliance Thresholds
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label className={labelClass}>Threshold Type</label>
              <select
                className={selectClass}
                value={thresholdType}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setThresholdType(e.target.value)}
              >
                <option value="percentage">Percentage Based</option>
                <option value="all_required">All Requirements Must Be Met</option>
              </select>
              <p className="mt-1 text-xs text-theme-text-secondary">
                {thresholdType === 'percentage'
                  ? 'Members are compliant when they meet the configured percentage of their requirements'
                  : 'Members must meet 100% of their assigned requirements to be compliant'}
              </p>
            </div>

            {thresholdType === 'percentage' && (
              <>
                <div>
                  <label className={labelClass}>
                    Compliant Threshold (%)
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    min={0}
                    max={100}
                    value={compliantThreshold}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setCompliantThreshold(Number(e.target.value))
                    }
                  />
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    Members at or above this percentage are marked <span className="font-medium text-green-600">compliant</span>
                  </p>
                </div>

                <div>
                  <label className={labelClass}>
                    At-Risk Threshold (%)
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    min={0}
                    max={100}
                    value={atRiskThreshold}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setAtRiskThreshold(Number(e.target.value))
                    }
                  />
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    Members between this and the compliant threshold are <span className="font-medium text-yellow-600">at risk</span>.
                    Below this = <span className="font-medium text-red-600">non-compliant</span>
                  </p>
                </div>
              </>
            )}

            <div>
              <label className={labelClass}>Grace Period (days)</label>
              <input
                type="number"
                className={inputClass}
                min={0}
                max={365}
                value={gracePeriodDays}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setGracePeriodDays(Number(e.target.value))
                }
              />
              <p className="mt-1 text-xs text-theme-text-secondary">
                Days after a requirement deadline before marking non-compliant
              </p>
            </div>
          </div>

          {/* Threshold preview */}
          <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800">
            <h3 className="mb-3 text-sm font-medium text-theme-text-secondary">
              Status Preview
            </h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span className="text-sm text-theme-text-primary">
                  Compliant: {thresholdType === 'all_required' ? '100%' : `≥ ${compliantThreshold}%`}
                </span>
              </div>
              {thresholdType === 'percentage' && (
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-yellow-500" />
                  <span className="text-sm text-theme-text-primary">
                    At Risk: {atRiskThreshold}% – {compliantThreshold - 1}%
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <span className="text-sm text-theme-text-primary">
                  Non-Compliant: {thresholdType === 'all_required' ? '< 100%' : `< ${atRiskThreshold}%`}
                </span>
              </div>
            </div>
          </div>

          {/* Notification settings */}
          <div className="border-t border-theme-surface-border pt-4">
            <h3 className="mb-3 text-sm font-semibold text-theme-text-primary">
              Notifications
            </h3>
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={notifyNonCompliant}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNotifyNonCompliant(e.target.checked)}
                />
                <span className="text-sm text-theme-text-primary">
                  Notify members when they become non-compliant
                </span>
              </label>

              <div>
                <label className={labelClass}>
                  Reminder Days Before Deadline
                </label>
                <input
                  type="text"
                  className={inputClass}
                  value={notifyDaysBefore}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNotifyDaysBefore(e.target.value)}
                  placeholder="30, 14, 7"
                />
                <p className="mt-1 text-xs text-theme-text-secondary">
                  Comma-separated list of days before a requirement deadline to send reminders
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => void handleSaveConfig()}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'profiles' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-theme-text-secondary" />
              <h2 className="text-lg font-semibold text-theme-text-primary">
                Compliance Profiles
              </h2>
            </div>
            {!showProfileForm && config && (
              <button
                onClick={() => {
                  resetProfileForm();
                  setShowProfileForm(true);
                }}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add Profile
              </button>
            )}
          </div>

          {!config && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  Save the compliance thresholds first before creating profiles.
                </p>
              </div>
            </div>
          )}

          <p className="text-sm text-theme-text-secondary">
            Profiles let you define different compliance rules for different member groups.
            Assign specific training requirements as mandatory or optional for each group.
          </p>

          {/* Profile Form */}
          {showProfileForm && (
            <div className="rounded-lg border border-blue-200 bg-theme-surface p-6 dark:border-blue-800">
              <h3 className="mb-4 text-base font-semibold text-theme-text-primary">
                {editingProfileId ? 'Edit Profile' : 'New Profile'}
              </h3>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={labelClass}>Profile Name</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={profileName}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setProfileName(e.target.value)}
                    placeholder="e.g., Active Firefighter"
                  />
                </div>
                <div>
                  <label className={labelClass}>Priority</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={profilePriority}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setProfilePriority(Number(e.target.value))
                    }
                    min={0}
                  />
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    Higher = evaluated first when a member matches multiple profiles
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className={labelClass}>Description</label>
                  <input
                    type="text"
                    className={inputClass}
                    value={profileDescription}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setProfileDescription(e.target.value)}
                    placeholder="Description of this compliance profile"
                  />
                </div>

                {/* Membership Types */}
                <div className="md:col-span-2">
                  <label className={labelClass}>
                    Applies to Membership Types
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {MEMBERSHIP_TYPES.map((type: string) => (
                      <button
                        key={type}
                        onClick={() => toggleMembershipType(type)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          profileMembershipTypes.includes(type)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    Leave empty to apply to all membership types
                  </p>
                </div>

                {/* Threshold Overrides */}
                <div>
                  <label className={labelClass}>
                    Compliant Threshold Override (%)
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    value={profileCompliantOverride}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setProfileCompliantOverride(e.target.value)
                    }
                    placeholder="Use org default"
                    min={0}
                    max={100}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    At-Risk Threshold Override (%)
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    value={profileAtRiskOverride}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setProfileAtRiskOverride(e.target.value)
                    }
                    placeholder="Use org default"
                    min={0}
                    max={100}
                  />
                </div>

                {/* Required Requirements */}
                <div className="md:col-span-2">
                  <label className={labelClass}>
                    Required Training Requirements
                  </label>
                  <p className="mb-2 text-xs text-theme-text-secondary">
                    Members MUST complete these to be considered compliant
                  </p>
                  {requirements.length === 0 ? (
                    <p className="text-sm text-theme-text-secondary italic">
                      No training requirements found. Create training requirements first.
                    </p>
                  ) : (
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-theme-surface-border p-2">
                      {requirements.map((req: AvailableRequirement) => (
                        <label
                          key={req.id}
                          className="flex items-center gap-2 rounded p-1 hover:bg-theme-surface-hover"
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={profileRequiredReqs.includes(req.id)}
                            onChange={() =>
                              toggleRequirement(
                                req.id,
                                profileRequiredReqs,
                                setProfileRequiredReqs,
                              )
                            }
                          />
                          <span className="text-sm text-theme-text-primary">
                            {req.name}
                          </span>
                          <span className="text-xs text-theme-text-secondary">
                            ({req.requirement_type}
                            {req.source ? ` · ${req.source}` : ''})
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Optional Requirements */}
                <div className="md:col-span-2">
                  <label className={labelClass}>
                    Optional/Tracked Requirements
                  </label>
                  <p className="mb-2 text-xs text-theme-text-secondary">
                    Tracked for reporting but not required for compliance status
                  </p>
                  {requirements.length > 0 && (
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-theme-surface-border p-2">
                      {requirements
                        .filter((req: AvailableRequirement) => !profileRequiredReqs.includes(req.id))
                        .map((req: AvailableRequirement) => (
                          <label
                            key={req.id}
                            className="flex items-center gap-2 rounded p-1 hover:bg-theme-surface-hover"
                          >
                            <input
                              type="checkbox"
                              className={checkboxClass}
                              checked={profileOptionalReqs.includes(req.id)}
                              onChange={() =>
                                toggleRequirement(
                                  req.id,
                                  profileOptionalReqs,
                                  setProfileOptionalReqs,
                                )
                              }
                            />
                            <span className="text-sm text-theme-text-primary">
                              {req.name}
                            </span>
                            <span className="text-xs text-theme-text-secondary">
                              ({req.requirement_type})
                            </span>
                          </label>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={resetProfileForm}
                  className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSaveProfile()}
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving...' : editingProfileId ? 'Update Profile' : 'Create Profile'}
                </button>
              </div>
            </div>
          )}

          {/* Existing Profiles */}
          {config?.profiles.map((profile: ComplianceProfile) => (
            <div
              key={profile.id}
              className="rounded-lg border border-theme-surface-border bg-theme-surface p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-theme-text-primary">
                      {profile.name}
                    </h3>
                    {!profile.isActive && (
                      <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                        Inactive
                      </span>
                    )}
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      Priority: {profile.priority}
                    </span>
                  </div>
                  {profile.description && (
                    <p className="mt-1 text-sm text-theme-text-secondary">
                      {profile.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => startEditProfile(profile)}
                    className="rounded p-1 text-theme-text-secondary hover:bg-theme-surface-hover"
                    title="Edit"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void handleDeleteProfile(profile.id)}
                    className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-theme-text-secondary">
                {profile.membershipTypes && profile.membershipTypes.length > 0 && (
                  <span>
                    Types: {profile.membershipTypes.join(', ')}
                  </span>
                )}
                {profile.compliantThresholdOverride != null && (
                  <span>
                    Compliant: ≥{profile.compliantThresholdOverride}%
                  </span>
                )}
                {profile.requiredRequirementIds && profile.requiredRequirementIds.length > 0 && (
                  <span>
                    Required: {profile.requiredRequirementIds.length} requirement(s)
                  </span>
                )}
                {profile.optionalRequirementIds && profile.optionalRequirementIds.length > 0 && (
                  <span>
                    Optional: {profile.optionalRequirementIds.length} requirement(s)
                  </span>
                )}
              </div>

              {/* Show requirement names */}
              {profile.requiredRequirementIds && profile.requiredRequirementIds.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-medium text-theme-text-secondary">
                    Required:
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {profile.requiredRequirementIds.map((id: string) => (
                      <span
                        key={id}
                        className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300"
                      >
                        {getRequirementName(id)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {config && config.profiles.length === 0 && !showProfileForm && (
            <div className="rounded-lg border border-dashed border-theme-surface-border p-8 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-theme-text-secondary opacity-50" />
              <p className="text-sm text-theme-text-secondary">
                No compliance profiles configured yet. Create a profile to define
                which requirements apply to different member groups.
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="space-y-6 rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-theme-text-secondary" />
            <h2 className="text-lg font-semibold text-theme-text-primary">
              Automated Report Scheduling
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label className={labelClass}>Report Frequency</label>
              <select
                className={selectClass}
                value={autoReportFrequency}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setAutoReportFrequency(e.target.value)}
              >
                {REPORT_FREQUENCIES.map((f: { value: string; label: string }) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-theme-text-secondary">
                Reports are automatically generated, stored, and emailed
              </p>
            </div>

            {autoReportFrequency !== 'none' && (
              <>
                <div>
                  <label className={labelClass}>
                    Day of Month to Generate
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    min={1}
                    max={28}
                    value={reportDayOfMonth}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setReportDayOfMonth(Number(e.target.value))
                    }
                  />
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    Report covers the previous period (e.g., day 1 = report for last month)
                  </p>
                </div>

                <div className="md:col-span-2">
                  <label className={labelClass}>
                    Email Recipients
                  </label>
                  <input
                    type="text"
                    className={inputClass}
                    value={reportEmailRecipients}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setReportEmailRecipients(e.target.value)
                    }
                    placeholder="chief@dept.com, training@dept.com"
                  />
                  <p className="mt-1 text-xs text-theme-text-secondary">
                    Comma-separated email addresses. Reports are automatically emailed when generated.
                  </p>
                </div>
              </>
            )}
          </div>

          {autoReportFrequency !== 'none' && (
            <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
              <div className="flex items-start gap-2">
                <Mail className="mt-0.5 h-4 w-4 text-blue-600" />
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p className="font-medium">Schedule Summary</p>
                  <p className="mt-1">
                    A {autoReportFrequency} compliance report will be automatically generated on
                    day {reportDayOfMonth} of each{' '}
                    {autoReportFrequency === 'monthly'
                      ? 'month'
                      : autoReportFrequency === 'quarterly'
                        ? 'quarter (Jan, Apr, Jul, Oct)'
                        : 'year'}
                    {reportEmailRecipients
                      ? ` and emailed to ${reportEmailRecipients.split(',').length} recipient(s)`
                      : ''}
                    . All reports are also stored in the Report History tab.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={() => void handleSaveConfig()}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Schedule'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-6">
          {/* Generate Report */}
          <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-theme-text-secondary" />
              <h2 className="text-lg font-semibold text-theme-text-primary">
                Generate Report
              </h2>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <label className={labelClass}>Report Type</label>
                <select
                  className={selectClass}
                  value={reportType}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setReportType(e.target.value)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Year</label>
                <input
                  type="number"
                  className={inputClass}
                  value={reportYear}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setReportYear(Number(e.target.value))}
                  min={2020}
                  max={2100}
                />
              </div>
              {reportType === 'monthly' && (
                <div>
                  <label className={labelClass}>Month</label>
                  <select
                    className={selectClass}
                    value={reportMonth}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setReportMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_: unknown, i: number) => (
                      <option key={i + 1} value={i + 1}>
                        {formatDateCustom(new Date(2024, i), { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="flex items-center gap-2 pt-7">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={reportSendEmail}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setReportSendEmail(e.target.checked)}
                  />
                  <span className="text-sm text-theme-text-primary">
                    Email report
                  </span>
                </label>
              </div>
            </div>

            {reportSendEmail && (
              <div className="mt-3">
                <label className={labelClass}>
                  Additional Recipients (optional)
                </label>
                <input
                  type="text"
                  className={inputClass}
                  value={reportAdditionalRecipients}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setReportAdditionalRecipients(e.target.value)
                  }
                  placeholder="extra@dept.com"
                />
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => void handleGenerateReport()}
                disabled={isGenerating}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isGenerating ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <BarChart3 className="h-4 w-4" />
                )}
                {isGenerating ? 'Generating...' : 'Generate Report'}
              </button>
            </div>
          </div>

          {/* Report History */}
          <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-theme-text-primary">
                Report History ({reportsTotal})
              </h2>
              <button
                onClick={() => void loadReports()}
                className="rounded p-1 text-theme-text-secondary hover:bg-theme-surface-hover"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            {reports.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-theme-surface-border p-8 text-center">
                <FileText className="mx-auto mb-3 h-10 w-10 text-theme-text-secondary opacity-50" />
                <p className="text-sm text-theme-text-secondary">
                  No reports generated yet. Use the form above to generate your first report.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {reports.map((report: ComplianceReportSummary) => (
                  <div
                    key={report.id}
                    className="flex items-center justify-between rounded-lg border border-theme-surface-border p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`rounded-full p-2 ${
                          report.status === 'completed'
                            ? 'bg-green-100 text-green-600 dark:bg-green-900/20'
                            : report.status === 'failed'
                              ? 'bg-red-100 text-red-600 dark:bg-red-900/20'
                              : 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20'
                        }`}
                      >
                        {report.status === 'completed' ? (
                          <CheckCircle className="h-4 w-4" />
                        ) : report.status === 'failed' ? (
                          <AlertTriangle className="h-4 w-4" />
                        ) : (
                          <Clock className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-theme-text-primary">
                          {report.periodLabel}
                          <span className="ml-2 text-xs font-normal text-theme-text-secondary">
                            {report.reportType}
                          </span>
                        </p>
                        <p className="text-xs text-theme-text-secondary">
                          Generated{' '}
                          {formatDate(report.generatedAt, tz)}
                          {report.generationDurationMs != null &&
                            ` · ${(report.generationDurationMs / 1000).toFixed(1)}s`}
                          {report.emailedTo && report.emailedTo.length > 0 && (
                            <span className="ml-2">
                              · Emailed to {report.emailedTo.length} recipient(s)
                            </span>
                          )}
                        </p>
                        {report.summary && (
                          <p className="mt-1 text-xs text-theme-text-secondary">
                            Compliance: {report.summary.overall_compliance_pct.toFixed(1)}%
                            · {report.summary.fully_compliant_members}/{report.summary.total_members} members compliant
                          </p>
                        )}
                        {report.errorMessage && (
                          <p className="mt-1 text-xs text-red-600">
                            Error: {report.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setEmailModalReportId(report.id);
                          setEmailRecipients('');
                        }}
                        className="rounded p-2 text-theme-text-secondary hover:bg-theme-surface-hover"
                        title="Email report"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void handleDeleteReport(report.id)}
                        className="rounded p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Delete report"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Modal */}
      {emailModalReportId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-theme-surface p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-theme-text-primary">
                Email Report
              </h3>
              <button
                onClick={() => setEmailModalReportId(null)}
                className="rounded p-1 text-theme-text-secondary hover:bg-theme-surface-hover"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4">
              <label className={labelClass}>Recipients</label>
              <input
                type="text"
                className={inputClass}
                value={emailRecipients}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEmailRecipients(e.target.value)}
                placeholder="chief@dept.com, training@dept.com"
              />
              <p className="mt-1 text-xs text-theme-text-secondary">
                Comma-separated email addresses
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEmailModalReportId(null)}
                className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleEmailReport()}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
