/**
 * Compliance Officer Dashboard
 *
 * Comprehensive compliance management view with:
 * - Annual compliance report with executive summary
 * - ISO/FSRS readiness scoring by category
 * - NFPA 1401 record completeness validation
 * - Formal compliance attestation workflow
 * - Compliance forecast integration
 *
 * Lazy-loaded as a tab in TrainingAdminPage.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  FileText,
  CheckCircle,
  AlertTriangle,
  Download,
  ClipboardCheck,
  BarChart3,
  Loader2,
  XCircle,
  Users,
  Award,
  TrendingUp,
  Settings,
} from 'lucide-react';
import { complianceOfficerService, reportExportService } from '../services/trainingServices';
import type {
  ISOReadiness,
  AnnualComplianceReport,
  RecordCompleteness,
  ComplianceAttestation,
  ComplianceForecast,
} from '../types/training';

type ActiveSection =
  | 'annual-report'
  | 'iso-readiness'
  | 'record-completeness'
  | 'attestations'
  | 'forecast';

const ComplianceOfficerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<ActiveSection>('annual-report');

  const sections: Array<{ id: ActiveSection; label: string; icon: React.ElementType }> = [
    { id: 'annual-report', label: 'Annual Report', icon: FileText },
    { id: 'iso-readiness', label: 'ISO Readiness', icon: BarChart3 },
    { id: 'record-completeness', label: 'Record Quality', icon: ClipboardCheck },
    { id: 'attestations', label: 'Attestations', icon: Shield },
    { id: 'forecast', label: 'Forecast', icon: TrendingUp },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Section Tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeSection === id
                ? 'bg-red-600 text-white'
                : 'bg-theme-input-bg text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
        <div className="ml-auto">
          <button
            onClick={() => navigate('/training/compliance-config')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-theme-input-bg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
            title="Compliance Requirements Configuration"
          >
            <Settings className="w-4 h-4" />
            Configure
          </button>
        </div>
      </div>

      {/* Section Content */}
      {activeSection === 'annual-report' && <AnnualReportSection />}
      {activeSection === 'iso-readiness' && <ISOReadinessSection />}
      {activeSection === 'record-completeness' && <RecordCompletenessSection />}
      {activeSection === 'attestations' && <AttestationsSection />}
      {activeSection === 'forecast' && <ForecastSection />}
    </div>
  );
};

// ============================================
// Annual Report Section
// ============================================

const AnnualReportSection: React.FC = () => {
  const [report, setReport] = useState<AnnualComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await complianceOfficerService.getAnnualReport(year);
      setReport(data);
    } catch {
      setError('Failed to load annual compliance report');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleExport = async () => {
    try {
      const blob = await complianceOfficerService.exportAnnualReport(year);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annual_compliance_${year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail - user will see no download
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !report) {
    return <ErrorMessage message={error || 'No data available'} />;
  }

  const { executive_summary: summary } = report;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
            <FileText className="h-5 w-5 text-red-500" />
            Annual Compliance Report — {year}
          </h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Generated {new Date(report.generated_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-theme-input-bg border border-theme-input-border rounded-md px-3 py-1.5 text-sm text-theme-text-primary"
          >
            {[0, 1, 2].map((offset) => {
              const y = new Date().getFullYear() - offset;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
          <button onClick={() => { void handleExport(); }} className="btn-primary flex items-center gap-2 text-sm">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Executive Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Overall Compliance"
          value={`${summary.overall_compliance_pct}%`}
          color={summary.overall_compliance_pct >= 80 ? 'green' : summary.overall_compliance_pct >= 50 ? 'yellow' : 'red'}
          icon={Shield}
        />
        <SummaryCard
          label="Members Compliant"
          value={`${summary.fully_compliant_members}/${summary.total_members}`}
          color="blue"
          icon={Users}
        />
        <SummaryCard
          label="Training Hours"
          value={summary.total_training_hours.toLocaleString()}
          color="purple"
          icon={Award}
        />
        <SummaryCard
          label="ISO Class Estimate"
          value={`Class ${summary.iso_class_estimate}`}
          color={summary.iso_class_estimate <= 3 ? 'green' : summary.iso_class_estimate <= 6 ? 'yellow' : 'red'}
          icon={BarChart3}
        />
      </div>

      {/* Certification Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Active Certifications</h3>
          <p className="text-2xl font-bold text-green-500">{summary.total_certifications_active}</p>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-medium text-theme-text-secondary mb-2">Expired Certifications</h3>
          <p className="text-2xl font-bold text-red-500">{summary.total_certifications_expired}</p>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-medium text-theme-text-secondary mb-2">ISO Readiness</h3>
          <p className="text-2xl font-bold text-theme-text-primary">{summary.iso_readiness_pct}%</p>
        </div>
      </div>

      {/* Sub-section summaries */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Recertification</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-theme-text-muted">Active Pathways</span><span className="text-theme-text-primary font-medium">{report.recertification_summary.active_pathways}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">Completed</span><span className="text-green-500 font-medium">{report.recertification_summary.tasks_completed}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">Pending</span><span className="text-yellow-500 font-medium">{report.recertification_summary.tasks_pending}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">Expired</span><span className="text-red-500 font-medium">{report.recertification_summary.tasks_expired}</span></div>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Instructors</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-theme-text-muted">Active Instructors</span><span className="text-theme-text-primary font-medium">{report.instructor_summary.active_instructors}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">Qualifications</span><span className="text-theme-text-primary font-medium">{report.instructor_summary.active_qualifications}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">Expiring</span><span className="text-yellow-500 font-medium">{report.instructor_summary.expiring_qualifications}</span></div>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Multi-Agency</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-theme-text-muted">Total Exercises</span><span className="text-theme-text-primary font-medium">{report.multi_agency_summary.total_exercises}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">NIMS Compliant</span><span className="text-green-500 font-medium">{report.multi_agency_summary.nims_compliant_exercises}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">Participants</span><span className="text-theme-text-primary font-medium">{report.multi_agency_summary.total_participants}</span></div>
          </div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-medium text-theme-text-secondary mb-3">Effectiveness</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-theme-text-muted">Evaluations</span><span className="text-theme-text-primary font-medium">{report.effectiveness_summary.total_evaluations}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">Avg Rating</span><span className="text-theme-text-primary font-medium">{report.effectiveness_summary.avg_reaction_rating ?? 'N/A'}</span></div>
            <div className="flex justify-between"><span className="text-theme-text-muted">Knowledge Gain</span><span className="text-theme-text-primary font-medium">{report.effectiveness_summary.avg_knowledge_gain != null ? `${report.effectiveness_summary.avg_knowledge_gain}%` : 'N/A'}</span></div>
          </div>
        </div>
      </div>

      {/* Record Completeness */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-theme-text-secondary">
            Record Completeness (NFPA 1401)
          </h3>
          <span className={`text-xs font-semibold px-2 py-1 rounded ${report.record_completeness.nfpa_1401_compliant ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
            {report.record_completeness.nfpa_1401_compliant ? 'NFPA 1401 Compliant' : 'Below NFPA 1401 Standard'}
          </span>
        </div>
        <div className="flex items-center gap-4 mb-3">
          <span className="text-theme-text-muted text-sm">{report.record_completeness.total_records} records</span>
          <div className="flex-1 h-2 bg-theme-surface-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${report.record_completeness.completeness_pct >= 90 ? 'bg-green-500' : report.record_completeness.completeness_pct >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${report.record_completeness.completeness_pct}%` }}
            />
          </div>
          <span className="text-theme-text-primary font-semibold text-sm">{report.record_completeness.completeness_pct}%</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {report.record_completeness.field_details.map((field) => (
            <div key={field.field_name} className="text-center">
              <p className="text-xs text-theme-text-muted capitalize">{field.field_name.replace('_', ' ')}</p>
              <p className={`text-sm font-semibold ${field.fill_rate_pct >= 90 ? 'text-green-500' : field.fill_rate_pct >= 70 ? 'text-yellow-500' : 'text-red-500'}`}>
                {field.fill_rate_pct}%
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Requirement Analysis Table */}
      {report.requirement_analysis.length > 0 && (
        <div className="card-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-theme-surface-border">
            <h3 className="text-sm font-medium text-theme-text-secondary">Requirement Compliance Analysis</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-theme-surface-border">
                  <th className="px-4 py-2 text-left text-xs font-medium text-theme-text-secondary uppercase">Requirement</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-theme-text-secondary uppercase">Type</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">Compliant</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">Compliance %</th>
                </tr>
              </thead>
              <tbody>
                {report.requirement_analysis.map((req) => (
                  <tr key={req.requirement_id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                    <td className="px-4 py-2 text-theme-text-primary">{req.name}</td>
                    <td className="px-4 py-2 text-theme-text-secondary capitalize">{req.type.replace('_', ' ')}</td>
                    <td className="px-4 py-2 text-center text-theme-text-primary">{req.members_compliant}/{req.members_total}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`font-semibold ${req.compliance_pct >= 80 ? 'text-green-500' : req.compliance_pct >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                        {req.compliance_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Member Compliance Table */}
      {report.member_compliance.length > 0 && (
        <div className="card-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-theme-surface-border">
            <h3 className="text-sm font-medium text-theme-text-secondary">Member Compliance Status</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-theme-surface-border">
                  <th className="px-4 py-2 text-left text-xs font-medium text-theme-text-secondary uppercase">Member</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">Hours</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">Requirements</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">Expired Certs</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.member_compliance.map((member) => (
                  <tr key={member.user_id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                    <td className="px-4 py-2 text-theme-text-primary font-medium">{member.name}</td>
                    <td className="px-4 py-2 text-center text-theme-text-secondary">{member.hours_completed}</td>
                    <td className="px-4 py-2 text-center text-theme-text-secondary">{member.requirements_met}/{member.requirements_total}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={member.expired_certifications > 0 ? 'text-red-500 font-semibold' : 'text-theme-text-muted'}>
                        {member.expired_certifications}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <StatusBadge status={member.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// ISO Readiness Section
// ============================================

const ISOReadinessSection: React.FC = () => {
  const [data, setData] = useState<ISOReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const result = await complianceOfficerService.getISOReadiness();
        setData(result);
      } catch {
        setError('Failed to load ISO readiness data');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error || !data) return <ErrorMessage message={error || 'No data available'} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-500" />
          ISO/FSRS Readiness Assessment — {data.year}
        </h2>
        <p className="text-sm text-theme-text-muted mt-1">
          Training hours measured against Insurance Services Office (ISO) Fire Suppression Rating Schedule requirements
        </p>
      </div>

      {/* Overall Score */}
      <div className="card p-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-theme-text-muted">Overall ISO Readiness</p>
          <p className="text-4xl font-bold text-theme-text-primary">{data.overall_readiness_pct}%</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-theme-text-muted">Estimated ISO Class</p>
          <p className={`text-4xl font-bold ${data.iso_class_estimate <= 3 ? 'text-green-500' : data.iso_class_estimate <= 6 ? 'text-yellow-500' : 'text-red-500'}`}>
            {data.iso_class_estimate}
          </p>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="space-y-4">
        {data.categories.map((cat) => (
          <div key={cat.name} className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold text-theme-text-primary">{cat.name}</h3>
                <p className="text-xs text-theme-text-muted">{cat.nfpa_standard} — {cat.required_hours} hrs/year required per member</p>
              </div>
              <div className="text-right">
                <p className={`text-lg font-bold ${cat.compliance_pct >= 80 ? 'text-green-500' : cat.compliance_pct >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {cat.compliance_pct}%
                </p>
                <p className="text-xs text-theme-text-muted">{cat.members_meeting_requirement}/{cat.total_members} members</p>
              </div>
            </div>
            <div className="h-2 bg-theme-surface-secondary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${cat.compliance_pct >= 80 ? 'bg-green-500' : cat.compliance_pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(100, cat.compliance_pct)}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-theme-text-muted">
              <span>Avg: {cat.avg_hours_completed} hrs/member</span>
              <span>Dept Total: {cat.total_department_hours} hrs</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================
// Record Completeness Section
// ============================================

const RecordCompletenessSection: React.FC = () => {
  const [data, setData] = useState<RecordCompleteness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const result = await complianceOfficerService.getRecordCompleteness();
        setData(result);
      } catch {
        setError('Failed to load record completeness data');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error || !data) return <ErrorMessage message={error || 'No data available'} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-purple-500" />
          Training Record Quality (NFPA 1401)
        </h2>
        <p className="text-sm text-theme-text-muted mt-1">
          Record completeness evaluation per NFPA 1401 training records management standard
        </p>
      </div>

      {/* Overall Score */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-theme-text-muted">{data.total_records} training records evaluated</p>
            <p className="text-sm text-theme-text-muted">{data.period_start} — {data.period_end}</p>
          </div>
          <div className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${data.nfpa_1401_compliant ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
            {data.nfpa_1401_compliant ? 'NFPA 1401 Compliant' : 'Below NFPA 1401 Standard (requires 90%)'}
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <span className="text-3xl font-bold text-theme-text-primary">{data.overall_completeness_pct}%</span>
          <div className="flex-1 h-3 bg-theme-surface-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${data.overall_completeness_pct >= 90 ? 'bg-green-500' : data.overall_completeness_pct >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${data.overall_completeness_pct}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {data.fields.map((field) => (
            <div key={field.field_name} className="bg-theme-input-bg/50 rounded-lg p-3">
              <p className="text-xs text-theme-text-muted capitalize mb-1">{field.field_name.replace(/_/g, ' ')}</p>
              <p className={`text-xl font-bold ${field.fill_rate_pct >= 90 ? 'text-green-500' : field.fill_rate_pct >= 70 ? 'text-yellow-500' : 'text-red-500'}`}>
                {field.fill_rate_pct}%
              </p>
              <p className="text-xs text-theme-text-muted">{field.records_with_value}/{data.total_records} records</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================
// Attestations Section
// ============================================

const AttestationsSection: React.FC = () => {
  const [attestations, setAttestations] = useState<ComplianceAttestation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await complianceOfficerService.getAttestations();
        setAttestations(data);
      } catch {
        setError('Failed to load attestation history');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      setSubmitting(true);
      const result = await complianceOfficerService.createAttestation({
        period_type: formData.get('period_type') as string,
        period_year: Number(formData.get('period_year')),
        compliance_percentage: Number(formData.get('compliance_percentage')),
        notes: formData.get('notes') as string || '',
        areas_reviewed: (formData.get('areas_reviewed') as string || '').split(',').map((s) => s.trim()).filter(Boolean),
        exceptions: [],
      });
      setAttestations((prev) => [result, ...prev]);
      setShowForm(false);
    } catch {
      // Error will show in form
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  const inputClass = 'w-full bg-theme-input-bg border border-theme-input-border rounded-md px-3 py-2 text-sm text-theme-text-primary';
  const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
            <Shield className="h-5 w-5 text-green-500" />
            Compliance Attestations
          </h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Formal sign-off records certifying department compliance
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
          {showForm ? 'Cancel' : 'New Attestation'}
        </button>
      </div>

      {/* Attestation Form */}
      {showForm && (
        <form onSubmit={(e) => { void handleSubmit(e); }} className="card p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Period Type</label>
              <select name="period_type" className={inputClass} required>
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Year</label>
              <input type="number" name="period_year" defaultValue={new Date().getFullYear()} className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>Compliance %</label>
              <input type="number" name="compliance_percentage" min="0" max="100" step="0.1" className={inputClass} required />
            </div>
          </div>
          <div>
            <label className={labelClass}>Areas Reviewed (comma-separated)</label>
            <input type="text" name="areas_reviewed" placeholder="Training records, Certifications, ISO compliance, NFPA 1401" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Notes</label>
            <textarea name="notes" rows={3} className={inputClass} placeholder="Observations, exceptions, recommendations..." />
          </div>
          <button type="submit" disabled={submitting} className="btn-success text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            {submitting ? 'Submitting...' : 'Submit Attestation'}
          </button>
        </form>
      )}

      {/* Attestation History */}
      {attestations.length === 0 ? (
        <div className="text-center py-12 text-theme-text-muted">
          <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No attestations on file. Create one to formally certify compliance.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {attestations.map((att) => (
            <div key={att.attestation_id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <div>
                    <p className="text-sm font-semibold text-theme-text-primary">
                      {att.period_type === 'annual' ? 'Annual' : `Q${att.period_quarter}`} Attestation — {att.period_year}
                    </p>
                    <p className="text-xs text-theme-text-muted">
                      {att.timestamp ? new Date(att.timestamp).toLocaleDateString() : att.created_at ? new Date(att.created_at).toLocaleDateString() : ''}
                    </p>
                  </div>
                </div>
                <span className={`text-lg font-bold ${att.compliance_percentage >= 80 ? 'text-green-500' : att.compliance_percentage >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
                  {att.compliance_percentage}%
                </span>
              </div>
              {att.notes && <p className="text-sm text-theme-text-muted mt-2">{att.notes}</p>}
              {att.areas_reviewed && att.areas_reviewed.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {att.areas_reviewed.map((area) => (
                    <span key={area} className="text-xs bg-theme-input-bg px-2 py-0.5 rounded text-theme-text-secondary">{area}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================
// Forecast Section
// ============================================

const ForecastSection: React.FC = () => {
  const [forecasts, setForecasts] = useState<ComplianceForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await reportExportService.getComplianceForecast();
        setForecasts(data);
      } catch {
        setError('Failed to load compliance forecast');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={error} />;

  if (forecasts.length === 0) {
    return (
      <div className="text-center py-12 text-theme-text-muted">
        <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>No forecast data available.</p>
      </div>
    );
  }

  // Calculate department-wide averages
  const avgCurrent = forecasts.reduce((s, f) => s + f.current_compliance_percentage, 0) / forecasts.length;
  const avg30 = forecasts.reduce((s, f) => s + f.forecast_30_days, 0) / forecasts.length;
  const avg60 = forecasts.reduce((s, f) => s + f.forecast_60_days, 0) / forecasts.length;
  const avg90 = forecasts.reduce((s, f) => s + f.forecast_90_days, 0) / forecasts.length;
  const atRiskMembers = forecasts.filter((f) => f.expiring_certifications.length > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-orange-500" />
          Predictive Compliance Forecast
        </h2>
        <p className="text-sm text-theme-text-muted mt-1">
          30/60/90-day compliance projections based on expiring certifications
        </p>
      </div>

      {/* Department Averages */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard label="Current" value={`${avgCurrent.toFixed(1)}%`} color={avgCurrent >= 80 ? 'green' : 'yellow'} icon={Shield} />
        <SummaryCard label="30 Days" value={`${avg30.toFixed(1)}%`} color={avg30 >= 80 ? 'green' : avg30 >= 60 ? 'yellow' : 'red'} icon={TrendingUp} />
        <SummaryCard label="60 Days" value={`${avg60.toFixed(1)}%`} color={avg60 >= 80 ? 'green' : avg60 >= 60 ? 'yellow' : 'red'} icon={TrendingUp} />
        <SummaryCard label="90 Days" value={`${avg90.toFixed(1)}%`} color={avg90 >= 80 ? 'green' : avg90 >= 60 ? 'yellow' : 'red'} icon={TrendingUp} />
        <SummaryCard label="At Risk" value={String(atRiskMembers)} color={atRiskMembers > 0 ? 'red' : 'green'} icon={AlertTriangle} />
      </div>

      {/* Per-Member Forecast */}
      <div className="card-secondary overflow-hidden">
        <div className="px-4 py-3 border-b border-theme-surface-border">
          <h3 className="text-sm font-medium text-theme-text-secondary">Member Compliance Projections</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-theme-surface-border">
                <th className="px-4 py-2 text-left text-xs font-medium text-theme-text-secondary uppercase">Member</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">Current</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">30 Days</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">60 Days</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">90 Days</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-theme-text-secondary uppercase">Expiring Certs</th>
              </tr>
            </thead>
            <tbody>
              {forecasts.map((f) => (
                <tr key={f.user_id} className="border-b border-theme-surface-border hover:bg-theme-surface-hover">
                  <td className="px-4 py-2 text-theme-text-primary font-medium">{f.user_name}</td>
                  <td className="px-4 py-2 text-center"><PctBadge pct={f.current_compliance_percentage} /></td>
                  <td className="px-4 py-2 text-center"><PctBadge pct={f.forecast_30_days} /></td>
                  <td className="px-4 py-2 text-center"><PctBadge pct={f.forecast_60_days} /></td>
                  <td className="px-4 py-2 text-center"><PctBadge pct={f.forecast_90_days} /></td>
                  <td className="px-4 py-2 text-center">
                    <span className={f.expiring_certifications.length > 0 ? 'text-red-500 font-semibold' : 'text-theme-text-muted'}>
                      {f.expiring_certifications.length}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ============================================
// Shared Components
// ============================================

const LoadingSpinner: React.FC = () => (
  <div className="flex justify-center items-center h-64">
    <Loader2 className="h-8 w-8 text-theme-text-muted animate-spin" />
  </div>
);

const ErrorMessage: React.FC<{ message: string }> = ({ message }) => (
  <div className="max-w-7xl mx-auto px-4 py-8">
    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 flex items-center gap-2">
      <XCircle className="w-5 h-5 shrink-0" />
      {message}
    </div>
  </div>
);

interface SummaryCardProps {
  label: string;
  value: string;
  color: 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'orange';
  icon: React.ElementType;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ label, value, color, icon: Icon }) => {
  const colorMap = {
    green: 'text-green-500',
    yellow: 'text-yellow-500',
    red: 'text-red-500',
    blue: 'text-blue-500',
    purple: 'text-purple-500',
    orange: 'text-orange-500',
  };

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${colorMap[color]}`} />
        <p className="text-xs text-theme-text-muted">{label}</p>
      </div>
      <p className={`text-xl font-bold ${colorMap[color]}`}>{value}</p>
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    compliant: { bg: 'bg-green-500/10', text: 'text-green-500', label: 'Compliant' },
    at_risk: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', label: 'At Risk' },
    non_compliant: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Non-Compliant' },
  };
  const c = config[status] ?? { bg: 'bg-theme-surface-secondary', text: 'text-theme-text-muted', label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
};

const PctBadge: React.FC<{ pct: number }> = ({ pct }) => (
  <span className={`font-semibold text-sm ${pct >= 80 ? 'text-green-500' : pct >= 50 ? 'text-yellow-500' : 'text-red-500'}`}>
    {pct.toFixed(1)}%
  </span>
);

export default ComplianceOfficerDashboard;
