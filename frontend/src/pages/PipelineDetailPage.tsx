import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Users,
  Layers,
  ListChecks,
  Calendar,
  Copy,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  AlertTriangle,
  UserPlus,
} from 'lucide-react';
import { trainingProgramService } from '../services/api';
import type {
  TrainingProgram,
  ProgramPhase,
  ProgramRequirement,
  ProgramMilestone,
  ProgramEnrollment,
  TrainingRequirementEnhanced,
  ProgramStructureType,
} from '../types/training';

// ==================== Types ====================

interface ProgramDetails extends TrainingProgram {
  phases?: ProgramPhase[];
  requirements?: (ProgramRequirement | TrainingRequirementEnhanced)[];
  milestones?: ProgramMilestone[];
  total_requirements?: number;
  total_required?: number;
}

type DetailTab = 'overview' | 'phases' | 'enrollments';

// ==================== Helper Components ====================

const StructureBadge: React.FC<{ type: ProgramStructureType }> = ({ type }) => {
  const colors: Record<ProgramStructureType, string> = {
    phases: 'bg-blue-500/20 text-blue-400',
    sequential: 'bg-purple-500/20 text-purple-400',
    flexible: 'bg-green-500/20 text-green-400',
  };

  return (
    <span className={`px-2 py-1 text-xs rounded ${colors[type]}`}>
      {type === 'phases' ? 'Phase-based' : type === 'sequential' ? 'Sequential' : 'Flexible'}
    </span>
  );
};

const PositionBadge: React.FC<{ position: string }> = ({ position }) => {
  const labels: Record<string, string> = {
    probationary: 'Probationary',
    firefighter: 'Firefighter',
    driver_candidate: 'Driver Candidate',
    driver: 'Driver',
    officer: 'Officer',
    aic: 'AIC',
  };

  return (
    <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
      {labels[position] || position}
    </span>
  );
};

const ReqTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const colors: Record<string, string> = {
    hours: 'bg-blue-500/20 text-blue-400',
    courses: 'bg-green-500/20 text-green-400',
    skills_evaluation: 'bg-purple-500/20 text-purple-400',
    checklist: 'bg-yellow-500/20 text-yellow-400',
    certification: 'bg-pink-500/20 text-pink-400',
    shifts: 'bg-orange-500/20 text-orange-400',
    calls: 'bg-red-500/20 text-red-400',
  };

  const labels: Record<string, string> = {
    hours: 'Hours',
    courses: 'Courses',
    skills_evaluation: 'Skills',
    checklist: 'Checklist',
    certification: 'Certification',
    shifts: 'Shifts',
    calls: 'Calls',
  };

  return (
    <span className={`px-2 py-0.5 text-xs rounded ${colors[type] || 'bg-gray-500/20 text-gray-400'}`}>
      {labels[type] || type}
    </span>
  );
};

// ==================== Enroll Modal ====================

const EnrollModal: React.FC<{
  isOpen: boolean;
  programId: string;
  programName: string;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ isOpen, programId, programName, onClose, onSuccess }) => {
  const [userIds, setUserIds] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const ids = userIds.split('\n').map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) {
        toast.error('Enter at least one user ID');
        return;
      }

      await trainingProgramService.bulkEnrollMembers(programId, {
        user_ids: ids,
        target_completion_date: targetDate || undefined,
      });
      toast.success(`Enrolled ${ids.length} member(s) in ${programName}`);
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to enroll members';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface rounded-lg max-w-lg w-full">
        <div className="p-6 border-b border-theme-surface-border">
          <h2 className="text-xl font-bold text-theme-text-primary">Enroll Members</h2>
          <p className="text-theme-text-muted text-sm mt-1">Enroll members into {programName}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Member IDs (one per line)
            </label>
            <textarea
              value={userIds}
              onChange={(e) => setUserIds(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Enter member user IDs, one per line..."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">Target Completion Date</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Enrolling...' : 'Enroll Members'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==================== Main Page ====================

const PipelineDetailPage: React.FC = () => {
  const { programId } = useParams<{ programId: string }>();
  const navigate = useNavigate();

  const [program, setProgram] = useState<ProgramDetails | null>(null);
  const [phases, setPhases] = useState<ProgramPhase[]>([]);
  const [programReqs, setProgramReqs] = useState<ProgramRequirement[]>([]);
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  useEffect(() => {
    if (programId) loadProgram();
  }, [programId]);

  const loadProgram = async () => {
    if (!programId) return;
    setLoading(true);
    try {
      const [programData, phasesData, reqsData] = await Promise.all([
        trainingProgramService.getProgram(programId),
        trainingProgramService.getProgramPhases(programId),
        trainingProgramService.getProgramRequirements(programId),
      ]);
      setProgram(programData);
      setPhases(phasesData);
      setProgramReqs(reqsData);

      // Expand all phases by default
      setExpandedPhases(new Set(phasesData.map((p: ProgramPhase) => p.id)));
    } catch (_error) {
      toast.error('Failed to load program');
      navigate('/training/programs');
    } finally {
      setLoading(false);
    }
  };

  const loadEnrollments = () => {
    if (!programId) return;
    // The API doesn't have a direct "get enrollments by program" endpoint,
    // but we can filter through the program data
    // For now we'll set an empty array
    setEnrollments([]);
  };

  useEffect(() => {
    if (activeTab === 'enrollments') loadEnrollments();
  }, [activeTab]);

  const handleDuplicate = async () => {
    if (!programId || !program) return;
    setIsDuplicating(true);
    try {
      const newProgram = await trainingProgramService.duplicateProgram(programId, `${program.name} (Copy)`);
      toast.success('Pipeline duplicated successfully');
      navigate(`/training/programs/${newProgram.id}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to duplicate pipeline';
      toast.error(msg);
    } finally {
      setIsDuplicating(false);
    }
  };

  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  // Get requirements for a specific phase
  const getPhaseReqs = (phaseId: string) =>
    programReqs.filter((r) => r.phase_id === phaseId).sort((a, b) => a.sort_order - b.sort_order);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-red-500" />
          <p className="text-gray-400 mt-4">Loading pipeline...</p>
        </div>
      </div>
    );
  }

  if (!program) return null;

  const totalReqs = programReqs.length;
  const requiredReqs = programReqs.filter((r) => r.is_required).length;

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-start space-x-4">
            <button
              onClick={() => navigate('/training/programs')}
              className="mt-1 p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface-hover"
              aria-label="Back to programs"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center space-x-3 mb-2">
                <h1 className="text-2xl font-bold text-theme-text-primary">{program.name}</h1>
                {program.is_template && (
                  <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">Template</span>
                )}
              </div>
              {program.description && (
                <p className="text-theme-text-muted text-sm max-w-2xl mb-3">{program.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {program.code && (
                  <span className="px-2 py-0.5 bg-theme-surface text-theme-text-secondary text-xs rounded font-mono">{program.code}</span>
                )}
                <StructureBadge type={program.structure_type} />
                {program.target_position && <PositionBadge position={program.target_position} />}
                {program.version > 1 && (
                  <span className="px-2 py-0.5 bg-theme-surface text-theme-text-muted text-xs rounded">v{program.version}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowEnrollModal(true)}
              className="flex items-center space-x-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
            >
              <UserPlus className="w-4 h-4" />
              <span>Enroll</span>
            </button>
            <button
              onClick={handleDuplicate}
              disabled={isDuplicating}
              className="flex items-center space-x-1 px-3 py-2 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover text-sm disabled:opacity-50"
            >
              <Copy className="w-4 h-4" />
              <span>{isDuplicating ? 'Copying...' : 'Duplicate'}</span>
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="flex items-center space-x-2 text-theme-text-muted mb-1">
              <Layers className="w-4 h-4" />
              <span className="text-xs uppercase">Phases</span>
            </div>
            <p className="text-2xl font-bold text-theme-text-primary">{phases.length}</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="flex items-center space-x-2 text-theme-text-muted mb-1">
              <ListChecks className="w-4 h-4" />
              <span className="text-xs uppercase">Requirements</span>
            </div>
            <p className="text-2xl font-bold text-theme-text-primary">{totalReqs}</p>
            <p className="text-xs text-theme-text-muted">{requiredReqs} required</p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="flex items-center space-x-2 text-theme-text-muted mb-1">
              <Calendar className="w-4 h-4" />
              <span className="text-xs uppercase">Time Limit</span>
            </div>
            <p className="text-2xl font-bold text-theme-text-primary">
              {program.time_limit_days ? `${program.time_limit_days}d` : '—'}
            </p>
          </div>
          <div className="bg-theme-surface rounded-lg p-4">
            <div className="flex items-center space-x-2 text-theme-text-muted mb-1">
              <Users className="w-4 h-4" />
              <span className="text-xs uppercase">Enrolled</span>
            </div>
            <p className="text-2xl font-bold text-theme-text-primary">{enrollments.length}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-theme-surface p-1 rounded-lg mb-6" role="tablist">
          {[
            { key: 'overview' as DetailTab, label: 'Phases & Requirements', icon: Layers },
            { key: 'enrollments' as DetailTab, label: 'Enrollments', icon: Users },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                role="tab"
                aria-selected={activeTab === tab.key}
                className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
                  activeTab === tab.key
                    ? 'bg-red-600 text-white'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {phases.length === 0 ? (
              <div className="text-center py-12 bg-theme-surface rounded-lg">
                <Layers className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <p className="text-theme-text-muted">No phases defined for this pipeline</p>
              </div>
            ) : (
              phases
                .sort((a, b) => a.phase_number - b.phase_number)
                .map((phase) => {
                  const phaseReqs = getPhaseReqs(phase.id);
                  const isExpanded = expandedPhases.has(phase.id);

                  return (
                    <div key={phase.id} className="bg-theme-surface rounded-lg border border-theme-surface-border">
                      {/* Phase header */}
                      <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-750"
                        onClick={() => togglePhase(phase.id)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-sm">
                            {phase.phase_number}
                          </div>
                          <div>
                            <h3 className="text-theme-text-primary font-medium">{phase.name}</h3>
                            <div className="flex items-center space-x-3 text-xs text-theme-text-muted">
                              <span>{phaseReqs.length} requirement{phaseReqs.length !== 1 ? 's' : ''}</span>
                              {phase.time_limit_days && (
                                <span className="flex items-center space-x-1">
                                  <Clock className="w-3 h-3" />
                                  <span>{phase.time_limit_days} day limit</span>
                                </span>
                              )}
                              {phase.requires_manual_advancement && (
                                <span className="flex items-center space-x-1 text-yellow-400">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>Manual advancement</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-theme-text-muted" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-theme-text-muted" />
                        )}
                      </div>

                      {/* Phase content */}
                      {isExpanded && (
                        <div className="border-t border-theme-surface-border p-4">
                          {phase.description && (
                            <p className="text-theme-text-muted text-sm mb-4">{phase.description}</p>
                          )}

                          {phaseReqs.length === 0 ? (
                            <p className="text-theme-text-muted text-sm text-center py-4">No requirements assigned to this phase.</p>
                          ) : (
                            <div className="space-y-2">
                              {phaseReqs.map((pr) => (
                                <div
                                  key={pr.id}
                                  className="bg-theme-surface-secondary rounded-lg p-3 flex items-start justify-between"
                                >
                                  <div className="flex items-start space-x-3">
                                    <CheckCircle2 className="w-5 h-5 text-gray-500 mt-0.5" />
                                    <div>
                                      <div className="flex items-center space-x-2 mb-1">
                                        <span className="text-white text-sm font-medium">
                                          {pr.requirement?.name || `Requirement ${pr.requirement_id.slice(0, 8)}`}
                                        </span>
                                        {pr.requirement?.requirement_type && (
                                          <ReqTypeBadge type={pr.requirement.requirement_type} />
                                        )}
                                        {pr.is_required && (
                                          <span className="text-red-400 text-xs">Required</span>
                                        )}
                                      </div>
                                      {pr.requirement?.description && (
                                        <p className="text-gray-400 text-xs">{pr.requirement.description}</p>
                                      )}
                                      {pr.program_specific_description && (
                                        <p className="text-gray-300 text-xs mt-1 italic">{pr.program_specific_description}</p>
                                      )}
                                      <div className="flex items-center space-x-3 mt-1 text-xs text-gray-500">
                                        {pr.requirement?.required_hours && (
                                          <span>{pr.requirement.required_hours}h required</span>
                                        )}
                                        {pr.requirement?.required_shifts && (
                                          <span>{pr.requirement.required_shifts} shifts</span>
                                        )}
                                        {pr.requirement?.checklist_items && (
                                          <span>{pr.requirement.checklist_items.length} items</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        )}

        {activeTab === 'enrollments' && (
          <div>
            {enrollments.length === 0 ? (
              <div className="text-center py-12 bg-gray-800 rounded-lg">
                <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400 mb-2">No members enrolled yet</p>
                <p className="text-gray-500 text-sm mb-4">
                  Use the Enroll button to add members to this pipeline
                </p>
                <button
                  onClick={() => setShowEnrollModal(true)}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                >
                  Enroll Members
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {enrollments.map((enrollment) => (
                  <div key={enrollment.id} className="bg-gray-800 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">{enrollment.user_id}</p>
                      <div className="flex items-center space-x-3 text-xs text-gray-400 mt-1">
                        <span>Status: {enrollment.status}</span>
                        <span>{enrollment.progress_percentage}% complete</span>
                      </div>
                    </div>
                    <div className="w-32 bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-red-500 h-2 rounded-full transition-all"
                        style={{ width: `${enrollment.progress_percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <EnrollModal
        isOpen={showEnrollModal}
        programId={programId || ''}
        programName={program.name}
        onClose={() => setShowEnrollModal(false)}
        onSuccess={loadProgram}
      />
    </div>
  );
};

export default PipelineDetailPage;
