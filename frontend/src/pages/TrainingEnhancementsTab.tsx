/**
 * Training Enhancements Tab
 *
 * Admin interface for new training features:
 * - Recertification Pathways (NREMT renewal, NFPA recertification)
 * - Competency Tracking (Dreyfus model progression)
 * - Instructor Qualifications (NFPA 1041 compliance)
 * - Training Effectiveness (Kirkpatrick Model evaluation)
 * - Multi-Agency Training (NIMS/ICS joint exercises)
 * - Report Exports (compliance CSV/PDF, forecasting)
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  RefreshCw,
  Plus,
  Download,
  Users,
  Award,
  BookOpen,
  BarChart3,
  Globe,
  FileText,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { getErrorMessage } from '../utils/errorHandling';
import {
  recertificationService,
  competencyService,
  instructorService,
  effectivenessService,
  multiAgencyService,
  reportExportService,
} from '../services/trainingServices';
import type {
  RecertificationPathway,
  RecertificationPathwayCreate,
  RenewalTask,
  CompetencyMatrix,
  CompetencyMatrixCreate,
  InstructorQualification,
  InstructorQualificationCreate,
  InstructorQualificationType,
  MultiAgencyTraining,
  MultiAgencyTrainingCreate,
  TrainingEffectivenessEvaluation,
  EvaluationLevel,
  ComplianceForecast,
  ParticipatingOrganization,
} from '../types/training';

const inputClass =
  'w-full px-3 py-2 bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';
const selectClass = inputClass;

// ==================== Add Pathway Modal ====================

interface AddPathwayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const RENEWAL_TYPES = [
  { value: 'hours', label: 'Hours' },
  { value: 'courses', label: 'Courses' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'combination', label: 'Combination' },
] as const;

const AddPathwayModal: React.FC<AddPathwayModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [renewalType, setRenewalType] = useState<RecertificationPathwayCreate['renewal_type']>('hours');
  const [requiredHours, setRequiredHours] = useState('');
  const [renewalWindowDays, setRenewalWindowDays] = useState('90');
  const [gracePeriodDays, setGracePeriodDays] = useState('30');

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setRenewalType('hours');
      setRequiredHours('');
      setRenewalWindowDays('90');
      setGracePeriodDays('30');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const data: RecertificationPathwayCreate = {
        name: name.trim(),
        description: description.trim() || undefined,
        renewal_type: renewalType,
        required_hours: requiredHours ? Number(requiredHours) : undefined,
        renewal_window_days: Number(renewalWindowDays) || undefined,
        grace_period_days: Number(gracePeriodDays) || undefined,
      };
      await recertificationService.createPathway(data);
      toast.success('Pathway created');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create pathway'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Recertification Pathway" size="md">
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        <div>
          <label className={labelClass}>Name *</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NREMT Recertification" required />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Renewal pathway details..." />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Renewal Type *</label>
            <select className={selectClass} value={renewalType} onChange={(e) => setRenewalType(e.target.value as RecertificationPathwayCreate['renewal_type'])}>
              {RENEWAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Required Hours</label>
            <input className={inputClass} type="number" min="0" step="0.5" value={requiredHours} onChange={(e) => setRequiredHours(e.target.value)} placeholder="e.g. 40" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Renewal Window (days)</label>
            <input className={inputClass} type="number" min="1" value={renewalWindowDays} onChange={(e) => setRenewalWindowDays(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Grace Period (days)</label>
            <input className={inputClass} type="number" min="0" value={gracePeriodDays} onChange={(e) => setGracePeriodDays(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm rounded-lg flex items-center gap-1">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Creating...' : 'Create Pathway'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ==================== Add Matrix Modal ====================

interface AddMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const AddMatrixModal: React.FC<AddMatrixModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [position, setPosition] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      setPosition('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !position.trim()) {
      toast.error('Name and position are required');
      return;
    }
    setSaving(true);
    try {
      const data: CompetencyMatrixCreate = {
        name: name.trim(),
        description: description.trim() || undefined,
        position: position.trim(),
        skill_requirements: [],
      };
      await competencyService.createMatrix(data);
      toast.success('Matrix created');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create matrix'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Competency Matrix" size="md">
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        <div>
          <label className={labelClass}>Name *</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Firefighter I Competency Matrix" required />
        </div>
        <div>
          <label className={labelClass}>Position *</label>
          <input className={inputClass} value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Firefighter, Lieutenant, Captain" required />
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Matrix description..." />
        </div>
        <p className="text-xs text-theme-text-muted">Skill requirements can be added after creating the matrix.</p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm rounded-lg flex items-center gap-1">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Creating...' : 'Create Matrix'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ==================== Add Qualification Modal ====================

interface AddQualificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const QUALIFICATION_TYPES: { value: InstructorQualificationType; label: string }[] = [
  { value: 'instructor', label: 'Instructor' },
  { value: 'evaluator', label: 'Evaluator' },
  { value: 'lead_instructor', label: 'Lead Instructor' },
  { value: 'mentor', label: 'Mentor' },
];

const AddQualificationModal: React.FC<AddQualificationModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState('');
  const [qualificationType, setQualificationType] = useState<InstructorQualificationType>('instructor');
  const [certificationNumber, setCertificationNumber] = useState('');
  const [issuingAgency, setIssuingAgency] = useState('');
  const [certificationLevel, setCertificationLevel] = useState('');
  const [issuedDate, setIssuedDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      setUserId('');
      setQualificationType('instructor');
      setCertificationNumber('');
      setIssuingAgency('');
      setCertificationLevel('');
      setIssuedDate('');
      setExpirationDate('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) {
      toast.error('User ID is required');
      return;
    }
    setSaving(true);
    try {
      const data: InstructorQualificationCreate = {
        user_id: userId.trim(),
        qualification_type: qualificationType,
        certification_number: certificationNumber.trim() || undefined,
        issuing_agency: issuingAgency.trim() || undefined,
        certification_level: certificationLevel.trim() || undefined,
        issued_date: issuedDate || undefined,
        expiration_date: expirationDate || undefined,
      };
      await instructorService.createQualification(data);
      toast.success('Qualification added');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add qualification'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Instructor Qualification" size="md">
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        <div>
          <label className={labelClass}>User ID *</label>
          <input className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Member user ID" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Qualification Type *</label>
            <select className={selectClass} value={qualificationType} onChange={(e) => setQualificationType(e.target.value as InstructorQualificationType)}>
              {QUALIFICATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Certification Level</label>
            <input className={inputClass} value={certificationLevel} onChange={(e) => setCertificationLevel(e.target.value)} placeholder="e.g. Level I, Level II" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Certification Number</label>
            <input className={inputClass} value={certificationNumber} onChange={(e) => setCertificationNumber(e.target.value)} placeholder="Cert #" />
          </div>
          <div>
            <label className={labelClass}>Issuing Agency</label>
            <input className={inputClass} value={issuingAgency} onChange={(e) => setIssuingAgency(e.target.value)} placeholder="e.g. State Fire Marshal" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Issued Date</label>
            <input className={inputClass} type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Expiration Date</label>
            <input className={inputClass} type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm rounded-lg flex items-center gap-1">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Adding...' : 'Add Qualification'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ==================== Add Exercise Modal ====================

interface AddExerciseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const EXERCISE_TYPES = [
  { value: 'joint_training', label: 'Joint Training' },
  { value: 'mutual_aid_drill', label: 'Mutual Aid Drill' },
  { value: 'regional_exercise', label: 'Regional Exercise' },
  { value: 'tabletop', label: 'Tabletop' },
  { value: 'full_scale', label: 'Full Scale' },
] as const;

const AddExerciseModal: React.FC<AddExerciseModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [exerciseName, setExerciseName] = useState('');
  const [exerciseType, setExerciseType] = useState<MultiAgencyTrainingCreate['exercise_type']>('joint_training');
  const [description, setDescription] = useState('');
  const [exerciseDate, setExerciseDate] = useState('');
  const [leadAgency, setLeadAgency] = useState('');
  const [totalParticipants, setTotalParticipants] = useState('');
  const [nimsCompliant, setNimsCompliant] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgRole, setOrgRole] = useState<ParticipatingOrganization['role']>('participant');

  useEffect(() => {
    if (isOpen) {
      setExerciseName('');
      setExerciseType('joint_training');
      setDescription('');
      setExerciseDate(new Date().toISOString().split('T')[0] ?? '');
      setLeadAgency('');
      setTotalParticipants('');
      setNimsCompliant(false);
      setOrgName('');
      setOrgRole('participant');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exerciseName.trim() || !exerciseDate) {
      toast.error('Exercise name and date are required');
      return;
    }
    setSaving(true);
    try {
      const orgs: ParticipatingOrganization[] = orgName.trim()
        ? [{ name: orgName.trim(), role: orgRole }]
        : [];
      const data: MultiAgencyTrainingCreate = {
        exercise_name: exerciseName.trim(),
        exercise_type: exerciseType,
        description: description.trim() || undefined,
        exercise_date: exerciseDate,
        lead_agency: leadAgency.trim() || undefined,
        total_participants: totalParticipants ? Number(totalParticipants) : undefined,
        nims_compliant: nimsCompliant || undefined,
        participating_organizations: orgs,
      };
      await multiAgencyService.createExercise(data);
      toast.success('Exercise created');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create exercise'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Multi-Agency Exercise" size="lg">
      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        <div>
          <label className={labelClass}>Exercise Name *</label>
          <input className={inputClass} value={exerciseName} onChange={(e) => setExerciseName(e.target.value)} placeholder="e.g. Regional MCI Drill" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Exercise Type *</label>
            <select className={selectClass} value={exerciseType} onChange={(e) => setExerciseType(e.target.value as MultiAgencyTrainingCreate['exercise_type'])}>
              {EXERCISE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Exercise Date *</label>
            <input className={inputClass} type="date" value={exerciseDate} onChange={(e) => setExerciseDate(e.target.value)} required />
          </div>
        </div>
        <div>
          <label className={labelClass}>Description</label>
          <textarea className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Exercise scenario and objectives..." />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Lead Agency</label>
            <input className={inputClass} value={leadAgency} onChange={(e) => setLeadAgency(e.target.value)} placeholder="e.g. County Fire Authority" />
          </div>
          <div>
            <label className={labelClass}>Total Participants</label>
            <input className={inputClass} type="number" min="1" value={totalParticipants} onChange={(e) => setTotalParticipants(e.target.value)} placeholder="# of participants" />
          </div>
        </div>
        <fieldset className="border border-theme-surface-border rounded-lg p-3">
          <legend className="text-sm font-medium text-theme-text-secondary px-1">Participating Organization</legend>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Organization Name</label>
              <input className={inputClass} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Agency name" />
            </div>
            <div>
              <label className={labelClass}>Role</label>
              <select className={selectClass} value={orgRole} onChange={(e) => setOrgRole(e.target.value as ParticipatingOrganization['role'])}>
                <option value="host">Host</option>
                <option value="participant">Participant</option>
                <option value="observer">Observer</option>
                <option value="evaluator">Evaluator</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-theme-text-muted mt-2">Additional organizations can be added after creating the exercise.</p>
        </fieldset>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="nims-compliant" checked={nimsCompliant} onChange={(e) => setNimsCompliant(e.target.checked)} className="rounded border-theme-surface-border" />
          <label htmlFor="nims-compliant" className="text-sm text-theme-text-secondary">NIMS/ICS Compliant</label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm rounded-lg flex items-center gap-1">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Creating...' : 'Create Exercise'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

// ==================== Section Components ====================

const RecertificationSection: React.FC = () => {
  const [pathways, setPathways] = useState<RecertificationPathway[]>([]);
  const [renewalTasks, setRenewalTasks] = useState<RenewalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pathwaysData, tasksData] = await Promise.all([
        recertificationService.getPathways(),
        recertificationService.getMyRenewalTasks(),
      ]);
      setPathways(pathwaysData);
      setRenewalTasks(tasksData);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateTasks = async () => {
    try {
      const result = await recertificationService.generateRenewalTasks();
      toast.success(`Generated ${result.tasks_created} renewal tasks`);
      void loadData();
    } catch {
      toast.error('Failed to generate renewal tasks');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Recertification Pathways</h3>
          <p className="text-sm text-theme-text-muted">
            Define renewal requirements for expiring certifications (NREMT, ACLS, etc.)
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => { void handleGenerateTasks(); }}
            className="btn-secondary flex items-center gap-1 px-3 py-2 text-sm rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Generate Tasks</span>
          </button>
          <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-1 px-3 py-2 text-sm rounded-lg">
            <Plus className="w-4 h-4" />
            <span>Add Pathway</span>
          </button>
        </div>
      </div>

      {pathways.length === 0 ? (
        <div className="card-secondary p-8 text-center">
          <Award className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No recertification pathways configured yet.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Create pathways to define how members renew expiring certifications.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {pathways.map((pathway) => (
            <div key={pathway.id} className="card-secondary p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-theme-text-primary">{pathway.name}</h4>
                  {pathway.description && (
                    <p className="text-sm text-theme-text-muted mt-1">{pathway.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-theme-text-muted">
                    <span>Type: {pathway.renewal_type}</span>
                    {pathway.required_hours && <span>Hours: {pathway.required_hours}</span>}
                    <span>Window: {pathway.renewal_window_days} days</span>
                    {pathway.grace_period_days > 0 && (
                      <span>Grace: {pathway.grace_period_days} days</span>
                    )}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 text-xs rounded-sm ${
                    pathway.active
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                      : 'bg-theme-surface-secondary text-theme-text-muted'
                  }`}
                >
                  {pathway.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {renewalTasks.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium text-theme-text-primary mb-3">Active Renewal Tasks</h4>
          <div className="space-y-2">
            {renewalTasks.map((task) => (
              <div key={task.id} className="card-secondary p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm text-theme-text-primary">{task.pathway_name || 'Renewal'}</span>
                  <span className="text-xs text-theme-text-muted ml-2">
                    Expires: {task.certification_expiration_date}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-24 bg-theme-surface-secondary rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${task.progress_percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-theme-text-muted">{Math.round(task.progress_percentage)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddPathwayModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSaved={() => { void loadData(); }} />
    </div>
  );
};

const CompetencySection: React.FC = () => {
  const [matrices, setMatrices] = useState<CompetencyMatrix[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await competencyService.getMatrices();
      setMatrices(data);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  const competencyLevels = [
    { level: 'novice', label: 'Novice', color: 'bg-theme-text-muted' },
    { level: 'advanced_beginner', label: 'Advanced Beginner', color: 'bg-blue-400' },
    { level: 'competent', label: 'Competent', color: 'bg-green-400' },
    { level: 'proficient', label: 'Proficient', color: 'bg-yellow-400' },
    { level: 'expert', label: 'Expert', color: 'bg-red-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Competency Matrices</h3>
          <p className="text-sm text-theme-text-muted">
            Define required skill levels by position (Dreyfus model: novice to expert)
          </p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center space-x-1 px-3 py-2 text-sm rounded-lg">
          <Plus className="w-4 h-4" />
          <span>Add Matrix</span>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {competencyLevels.map((l) => (
          <div key={l.level} className="flex items-center gap-1 text-xs text-theme-text-muted">
            <div className={`w-3 h-3 rounded-full ${l.color}`} />
            <span>{l.label}</span>
          </div>
        ))}
      </div>

      {matrices.length === 0 ? (
        <div className="card-secondary p-8 text-center">
          <TrendingUp className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No competency matrices configured.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Create matrices to map positions to required skill levels per NFPA 1021/1041.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {matrices.map((matrix) => (
            <div key={matrix.id} className="card-secondary p-4">
              <h4 className="font-medium text-theme-text-primary">{matrix.name}</h4>
              <p className="text-xs text-theme-text-muted mt-1">Position: {matrix.position}</p>
              <p className="text-xs text-theme-text-muted">
                Skills: {matrix.skill_requirements.length} requirements
              </p>
            </div>
          ))}
        </div>
      )}

      <AddMatrixModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSaved={() => { void loadData(); }} />
    </div>
  );
};

const InstructorsSection: React.FC = () => {
  const [qualifications, setQualifications] = useState<InstructorQualification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await instructorService.getQualifications();
      setQualifications(data);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Instructor Qualifications</h3>
          <p className="text-sm text-theme-text-muted">
            Track who is qualified to instruct and evaluate per NFPA 1041
          </p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center space-x-1 px-3 py-2 text-sm rounded-lg">
          <Plus className="w-4 h-4" />
          <span>Add Qualification</span>
        </button>
      </div>

      {qualifications.length === 0 ? (
        <div className="card-secondary p-8 text-center">
          <BookOpen className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No instructor qualifications recorded.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Add qualifications to track who can instruct which courses and evaluate which skills.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-theme-text-muted border-b border-theme-surface-border">
                <th scope="col" className="pb-2 pr-4">Instructor</th>
                <th scope="col" className="pb-2 pr-4">Type</th>
                <th scope="col" className="pb-2 pr-4">Level</th>
                <th scope="col" className="pb-2 pr-4">Cert #</th>
                <th scope="col" className="pb-2 pr-4">Expires</th>
                <th scope="col" className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {qualifications.map((qual) => (
                <tr key={qual.id} className="border-b border-theme-surface-border/50">
                  <td className="py-2 pr-4 text-theme-text-primary">{qual.user_name || qual.user_id}</td>
                  <td className="py-2 pr-4 capitalize">{qual.qualification_type}</td>
                  <td className="py-2 pr-4">{qual.certification_level || '-'}</td>
                  <td className="py-2 pr-4">{qual.certification_number || '-'}</td>
                  <td className="py-2 pr-4">{qual.expiration_date || '-'}</td>
                  <td className="py-2">
                    <span
                      className={`px-2 py-0.5 text-xs rounded-sm ${
                        qual.verified
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                          : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                      }`}
                    >
                      {qual.verified ? 'Verified' : 'Pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddQualificationModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSaved={() => { void loadData(); }} />
    </div>
  );
};

const KIRKPATRICK_LEVELS: { key: EvaluationLevel; level: string; desc: string; icon: typeof FileText; color: string }[] = [
  { key: 'reaction', level: 'Level 1: Reaction', desc: 'Post-training surveys', icon: FileText, color: 'text-blue-500' },
  { key: 'learning', level: 'Level 2: Learning', desc: 'Pre/post assessments', icon: BookOpen, color: 'text-green-500' },
  { key: 'behavior', level: 'Level 3: Behavior', desc: 'On-the-job observation', icon: Users, color: 'text-yellow-500' },
  { key: 'results', level: 'Level 4: Results', desc: 'Organizational impact', icon: BarChart3, color: 'text-red-500' },
];

const EffectivenessSection: React.FC = () => {
  const [evaluations, setEvaluations] = useState<TrainingEffectivenessEvaluation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await effectivenessService.getEvaluations();
      setEvaluations(data);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  const countByLevel = (level: EvaluationLevel) =>
    evaluations.filter((ev) => ev.evaluation_level === level).length;

  const avgRatingByLevel = (level: EvaluationLevel): string => {
    const levelEvals = evaluations.filter((ev) => ev.evaluation_level === level && ev.overall_rating != null);
    if (levelEvals.length === 0) return '-';
    const sum = levelEvals.reduce((acc, ev) => acc + (ev.overall_rating ?? 0), 0);
    return (sum / levelEvals.length).toFixed(1);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Training Effectiveness</h3>
        <p className="text-sm text-theme-text-muted">
          Kirkpatrick Model evaluation: Reaction, Learning, Behavior, Results
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {KIRKPATRICK_LEVELS.map((item) => {
          const Icon = item.icon;
          const count = countByLevel(item.key);
          const avg = avgRatingByLevel(item.key);
          return (
            <div key={item.level} className="card-secondary p-4 text-center">
              <Icon className={`w-8 h-8 mx-auto mb-2 ${item.color}`} />
              <h4 className="text-sm font-medium text-theme-text-primary">{item.level}</h4>
              <p className="text-xs text-theme-text-muted mt-1">{item.desc}</p>
              <div className="mt-2 pt-2 border-t border-theme-surface-border">
                <span className="text-lg font-semibold text-theme-text-primary">{count}</span>
                <span className="text-xs text-theme-text-muted ml-1">evaluation{count !== 1 ? 's' : ''}</span>
                {avg !== '-' && (
                  <p className="text-xs text-theme-text-muted mt-0.5">Avg rating: {avg}/5</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {evaluations.length === 0 ? (
        <div className="card-secondary p-6 text-center">
          <BarChart3 className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No effectiveness evaluations recorded yet.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Members can submit post-training surveys. Pre/post assessments measure knowledge gain.
          </p>
        </div>
      ) : (
        <div>
          <h4 className="text-sm font-medium text-theme-text-primary mb-3">Recent Evaluations</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-theme-text-muted border-b border-theme-surface-border">
                  <th scope="col" className="pb-2 pr-4">Level</th>
                  <th scope="col" className="pb-2 pr-4">Rating</th>
                  <th scope="col" className="pb-2 pr-4">Knowledge Gain</th>
                  <th scope="col" className="pb-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.slice(0, 20).map((ev) => (
                  <tr key={ev.id} className="border-b border-theme-surface-border/50">
                    <td className="py-2 pr-4 capitalize text-theme-text-primary">{ev.evaluation_level}</td>
                    <td className="py-2 pr-4">{ev.overall_rating != null ? `${ev.overall_rating}/5` : '-'}</td>
                    <td className="py-2 pr-4">
                      {ev.knowledge_gain_percentage != null ? (
                        <span className={ev.knowledge_gain_percentage >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {ev.knowledge_gain_percentage > 0 ? '+' : ''}{ev.knowledge_gain_percentage}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-2 text-theme-text-muted">{ev.created_at.split('T')[0] ?? ''}</td>
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

const MultiAgencySection: React.FC = () => {
  const [exercises, setExercises] = useState<MultiAgencyTraining[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await multiAgencyService.getExercises();
      setExercises(data);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-theme-text-primary">Multi-Agency Training</h3>
          <p className="text-sm text-theme-text-muted">
            Joint exercises, mutual aid drills, and regional training per NFPA 1500 / NIMS
          </p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center space-x-1 px-3 py-2 text-sm rounded-lg">
          <Plus className="w-4 h-4" />
          <span>Add Exercise</span>
        </button>
      </div>

      {exercises.length === 0 ? (
        <div className="card-secondary p-8 text-center">
          <Globe className="w-12 h-12 mx-auto text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No multi-agency exercises recorded.</p>
          <p className="text-sm text-theme-text-muted mt-1">
            Log joint training exercises with other departments, mutual aid drills, and regional exercises.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {exercises.map((exercise) => (
            <div key={exercise.id} className="card-secondary p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-theme-text-primary">{exercise.exercise_name}</h4>
                  <div className="flex items-center space-x-3 mt-1 text-xs text-theme-text-muted">
                    <span className="capitalize">{exercise.exercise_type.replace(/_/g, ' ')}</span>
                    <span>{exercise.exercise_date}</span>
                    {exercise.total_participants && (
                      <span>{exercise.total_participants} participants</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {exercise.participating_organizations.map((org, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs bg-theme-surface-secondary rounded-sm text-theme-text-muted"
                      >
                        {org.name} ({org.role})
                      </span>
                    ))}
                  </div>
                </div>
                {exercise.nims_compliant && (
                  <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-700 dark:text-green-400 rounded-sm">
                    NIMS Compliant
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddExerciseModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSaved={() => { void loadData(); }} />
    </div>
  );
};

const ReportsSection: React.FC = () => {
  const [forecasts, setForecasts] = useState<ComplianceForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (reportType: string) => {
    setExporting(true);
    try {
      const blob = await reportExportService.exportReport({
        report_type: reportType as 'compliance' | 'department',
        format: 'csv',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `training_report_${reportType}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setExporting(false);
    }
  };

  const handleLoadForecast = async () => {
    setLoading(true);
    try {
      const data = await reportExportService.getComplianceForecast();
      setForecasts(data);
    } catch {
      toast.error('Failed to load forecast');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Reports & Analytics</h3>
        <p className="text-sm text-theme-text-muted">
          Export compliance reports, individual training records, and view predictive forecasts
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <button
          onClick={() => void handleExport('compliance')}
          disabled={exporting}
          className="card-secondary p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <Download className="w-6 h-6 text-blue-500 mb-2" />
          <h4 className="text-sm font-medium text-theme-text-primary">Compliance Report</h4>
          <p className="text-xs text-theme-text-muted mt-1">
            Department-wide compliance status for all members and requirements
          </p>
        </button>

        <button
          onClick={() => void handleExport('hours_summary')}
          disabled={exporting}
          className="card-secondary p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <Download className="w-6 h-6 text-green-500 mb-2" />
          <h4 className="text-sm font-medium text-theme-text-primary">Hours Summary</h4>
          <p className="text-xs text-theme-text-muted mt-1">
            Training hours by member, category, and type for state reporting
          </p>
        </button>

        <button
          onClick={() => void handleExport('certification')}
          disabled={exporting}
          className="card-secondary p-4 text-left hover:bg-theme-surface-hover transition-colors"
        >
          <Download className="w-6 h-6 text-yellow-500 mb-2" />
          <h4 className="text-sm font-medium text-theme-text-primary">Certification Report</h4>
          <p className="text-xs text-theme-text-muted mt-1">
            All certifications with expiration status and renewal tracking
          </p>
        </button>
      </div>

      <div className="border-t border-theme-surface-border pt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-medium text-theme-text-primary">Compliance Forecast</h4>
            <p className="text-xs text-theme-text-muted">
              Predictive 30/60/90 day compliance based on expiring certifications
            </p>
          </div>
          <button
            onClick={() => { void handleLoadForecast(); }}
            disabled={loading}
            className="btn-secondary flex items-center space-x-1 px-3 py-2 text-sm rounded-lg"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
            <span>Load Forecast</span>
          </button>
        </div>

        {forecasts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-theme-text-muted border-b border-theme-surface-border">
                  <th scope="col" className="pb-2 pr-4">Member</th>
                  <th scope="col" className="pb-2 pr-4">Current</th>
                  <th scope="col" className="pb-2 pr-4">30 Days</th>
                  <th scope="col" className="pb-2 pr-4">60 Days</th>
                  <th scope="col" className="pb-2 pr-4">90 Days</th>
                  <th scope="col" className="pb-2">At Risk</th>
                </tr>
              </thead>
              <tbody>
                {forecasts.map((f) => (
                  <tr key={f.user_id} className="border-b border-theme-surface-border/50">
                    <td className="py-2 pr-4 text-theme-text-primary">{f.user_name || f.user_id}</td>
                    <td className="py-2 pr-4">
                      <span className={f.current_compliance_percentage >= 80 ? 'text-green-600' : f.current_compliance_percentage >= 50 ? 'text-yellow-600' : 'text-red-600'}>
                        {f.current_compliance_percentage}%
                      </span>
                    </td>
                    <td className="py-2 pr-4">{f.forecast_30_days}%</td>
                    <td className="py-2 pr-4">{f.forecast_60_days}%</td>
                    <td className="py-2 pr-4">{f.forecast_90_days}%</td>
                    <td className="py-2">
                      {f.at_risk_requirements.length > 0 && (
                        <span className="text-xs text-red-500">
                          {f.at_risk_requirements.length} requirement{f.at_risk_requirements.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== Main Component ====================

interface TrainingEnhancementsTabProps {
  activeTab: string;
}

export const TrainingEnhancementsTab: React.FC<TrainingEnhancementsTabProps> = ({ activeTab }) => {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {activeTab === 'recertification' && <RecertificationSection />}
      {activeTab === 'competency' && <CompetencySection />}
      {activeTab === 'instructors' && <InstructorsSection />}
      {activeTab === 'effectiveness' && <EffectivenessSection />}
      {activeTab === 'multi-agency' && <MultiAgencySection />}
      {activeTab === 'reports' && <ReportsSection />}
    </div>
  );
};

export default TrainingEnhancementsTab;
