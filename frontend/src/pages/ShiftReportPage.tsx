import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  ClipboardList,
  Star,
  Clock,
  Phone,
  User,
  Calendar,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Plus,
  Trash2,
  Send,
  FileText,
  TrendingUp,
} from 'lucide-react';
import { shiftCompletionService, userService, trainingProgramService } from '../services/api';
import type {
  ShiftCompletionReport,
  ShiftCompletionReportCreate,
  SkillObservation,
  TaskPerformed,
  TraineeShiftStats,
  ProgramEnrollment,
} from '../types/training';

// ==================== Star Rating ====================

const StarRating: React.FC<{
  value: number;
  onChange: (val: number) => void;
  size?: 'sm' | 'md';
}> = ({ value, onChange, size = 'md' }) => {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6';
  return (
    <div className="flex items-center space-x-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="focus:outline-none"
        >
          <Star
            className={`${sizeClass} ${star <= value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
          />
        </button>
      ))}
    </div>
  );
};

// ==================== Report Card ====================

const ReportCard: React.FC<{
  report: ShiftCompletionReport;
  memberMap: Record<string, string>;
}> = ({ report, memberMap }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <span className="text-white font-medium">
                {memberMap[report.trainee_id] || 'Unknown'}
              </span>
              {report.performance_rating && (
                <StarRating value={report.performance_rating} onChange={() => {}} size="sm" />
              )}
              {report.trainee_acknowledged && (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              )}
            </div>
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
              <span className="flex items-center space-x-1">
                <Calendar className="w-3 h-3" />
                <span>{report.shift_date}</span>
              </span>
              <span className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>{report.hours_on_shift}h</span>
              </span>
              {report.calls_responded > 0 && (
                <span className="flex items-center space-x-1">
                  <Phone className="w-3 h-3" />
                  <span>{report.calls_responded} calls</span>
                </span>
              )}
            </div>
          </div>
          {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-700 pt-3 space-y-3">
          {report.officer_narrative && (
            <div>
              <span className="text-gray-500 text-xs">Officer Narrative</span>
              <p className="text-gray-300 text-sm">{report.officer_narrative}</p>
            </div>
          )}
          {report.areas_of_strength && (
            <div>
              <span className="text-gray-500 text-xs">Strengths</span>
              <p className="text-green-300 text-sm">{report.areas_of_strength}</p>
            </div>
          )}
          {report.areas_for_improvement && (
            <div>
              <span className="text-gray-500 text-xs">Areas for Improvement</span>
              <p className="text-orange-300 text-sm">{report.areas_for_improvement}</p>
            </div>
          )}
          {report.skills_observed && report.skills_observed.length > 0 && (
            <div>
              <span className="text-gray-500 text-xs">Skills Observed</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {report.skills_observed.map((s, i) => (
                  <span key={i} className={`text-xs px-2 py-0.5 rounded ${s.demonstrated ? 'bg-green-500/20 text-green-400' : 'bg-gray-600 text-gray-400'}`}>
                    {s.skill_name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {report.tasks_performed && report.tasks_performed.length > 0 && (
            <div>
              <span className="text-gray-500 text-xs">Tasks Performed</span>
              <ul className="list-disc list-inside text-sm text-gray-300 mt-1">
                {report.tasks_performed.map((t, i) => (
                  <li key={i}>{t.task}{t.description ? ` - ${t.description}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          {report.requirements_progressed && report.requirements_progressed.length > 0 && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2 text-xs text-blue-300">
              Updated {report.requirements_progressed.length} pipeline requirement(s)
            </div>
          )}
          {report.trainee_comments && (
            <div className="bg-gray-700/50 rounded p-2">
              <span className="text-gray-400 text-xs">Trainee Comments: </span>
              <span className="text-gray-300 text-sm">{report.trainee_comments}</span>
            </div>
          )}
          <div className="text-xs text-gray-500">
            Filed by: {memberMap[report.officer_id] || 'Unknown Officer'} on {new Date(report.created_at).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== Main Page ====================

interface SimpleUser {
  id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  username: string;
}

const ShiftReportPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'new' | 'filed' | 'received'>('new');
  const [members, setMembers] = useState<SimpleUser[]>([]);
  const [enrollments, setEnrollments] = useState<ProgramEnrollment[]>([]);
  const [filedReports, setFiledReports] = useState<ShiftCompletionReport[]>([]);
  const [receivedReports, setReceivedReports] = useState<ShiftCompletionReport[]>([]);
  const [myStats, setMyStats] = useState<TraineeShiftStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});

  // Form state
  const [traineeId, setTraineeId] = useState('');
  const [shiftDate, setShiftDate] = useState(new Date().toISOString().split('T')[0]);
  const [hoursOnShift, setHoursOnShift] = useState<number>(0);
  const [callsResponded, setCallsResponded] = useState<number>(0);
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [callTypeInput, setCallTypeInput] = useState('');
  const [rating, setRating] = useState<number>(0);
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [narrative, setNarrative] = useState('');
  const [skills, setSkills] = useState<SkillObservation[]>([]);
  const [tasks, setTasks] = useState<TaskPerformed[]>([]);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [membersData, filedData, receivedData, statsData] = await Promise.all([
        userService.getUsers(),
        shiftCompletionService.getReportsByOfficer().catch(() => []),
        shiftCompletionService.getMyReports().catch(() => []),
        shiftCompletionService.getMyStats().catch(() => null),
      ]);

      setMembers(membersData as SimpleUser[]);
      const map: Record<string, string> = {};
      (membersData as SimpleUser[]).forEach((m) => {
        map[m.id] = m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username;
      });
      setMemberMap(map);
      setFiledReports(filedData);
      setReceivedReports(receivedData);
      setMyStats(statsData);
    } catch (error) {
      // Error silently handled - empty state shown
    } finally {
      setLoading(false);
    }
  };

  // Load enrollments when trainee is selected
  useEffect(() => {
    if (traineeId) {
      trainingProgramService.getUserEnrollments(traineeId).then(setEnrollments).catch(() => setEnrollments([]));
    } else {
      setEnrollments([]);
    }
  }, [traineeId]);

  const addCallType = () => {
    if (callTypeInput.trim() && !callTypes.includes(callTypeInput.trim())) {
      setCallTypes([...callTypes, callTypeInput.trim()]);
      setCallTypeInput('');
    }
  };

  const addSkill = () => {
    setSkills([...skills, { skill_name: '', demonstrated: false }]);
  };

  const updateSkill = (index: number, updates: Partial<SkillObservation>) => {
    setSkills(skills.map((s, i) => i === index ? { ...s, ...updates } : s));
  };

  const removeSkill = (index: number) => {
    setSkills(skills.filter((_, i) => i !== index));
  };

  const addTask = () => {
    setTasks([...tasks, { task: '' }]);
  };

  const updateTask = (index: number, updates: Partial<TaskPerformed>) => {
    setTasks(tasks.map((t, i) => i === index ? { ...t, ...updates } : t));
  };

  const removeTask = (index: number) => {
    setTasks(tasks.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!traineeId || !hoursOnShift) {
      toast.error('Please select a trainee and enter hours');
      return;
    }

    setSubmitting(true);
    try {
      const data: ShiftCompletionReportCreate = {
        shift_date: shiftDate,
        trainee_id: traineeId,
        hours_on_shift: hoursOnShift,
        calls_responded: callsResponded,
        call_types: callTypes.length > 0 ? callTypes : undefined,
        performance_rating: rating > 0 ? rating : undefined,
        areas_of_strength: strengths || undefined,
        areas_for_improvement: improvements || undefined,
        officer_narrative: narrative || undefined,
        skills_observed: skills.filter((s) => s.skill_name.trim()).length > 0 ? skills.filter((s) => s.skill_name.trim()) : undefined,
        tasks_performed: tasks.filter((t) => t.task.trim()).length > 0 ? tasks.filter((t) => t.task.trim()) : undefined,
        enrollment_id: enrollmentId || undefined,
      };

      const result = await shiftCompletionService.createReport(data);
      const progressCount = result.requirements_progressed?.length || 0;
      toast.success(
        progressCount > 0
          ? `Report filed! Updated ${progressCount} pipeline requirement(s).`
          : 'Shift completion report filed!'
      );

      // Reset form
      setTraineeId('');
      setHoursOnShift(0);
      setCallsResponded(0);
      setCallTypes([]);
      setRating(0);
      setStrengths('');
      setImprovements('');
      setNarrative('');
      setSkills([]);
      setTasks([]);
      setEnrollmentId('');
      loadData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to submit report';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcknowledge = async (reportId: string) => {
    try {
      await shiftCompletionService.acknowledgeReport(reportId);
      toast.success('Report acknowledged');
      loadData();
    } catch {
      toast.error('Failed to acknowledge report');
    }
  };

  const COMMON_CALL_TYPES = [
    'Structure Fire', 'Wildland Fire', 'Vehicle Fire',
    'Medical - ALS', 'Medical - BLS', 'MVA',
    'Hazmat', 'Rescue', 'Public Assist',
  ];

  return (
    <div className="min-h-screen">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-6">
          <button
            onClick={() => navigate('/training/officer')}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white flex items-center space-x-2">
              <ClipboardList className="w-7 h-7 text-red-500" />
              <span>Shift Completion Reports</span>
            </h1>
            <p className="text-gray-400 text-sm">
              Document trainee performance and experiences during shifts
            </p>
          </div>
        </div>

        {/* Stats Bar */}
        {myStats && myStats.total_reports > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">{myStats.total_reports}</div>
              <div className="text-xs text-gray-400">Reports</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">{myStats.total_hours}</div>
              <div className="text-xs text-gray-400">Shift Hours</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">{myStats.total_calls}</div>
              <div className="text-xs text-gray-400">Calls</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-white">{myStats.avg_rating || '-'}</div>
              <div className="text-xs text-gray-400">Avg Rating</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 bg-gray-800 p-1 rounded-lg mb-6">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeTab === 'new' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Plus className="w-4 h-4 inline mr-1" /> New Report
          </button>
          <button
            onClick={() => setActiveTab('filed')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeTab === 'filed' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <FileText className="w-4 h-4 inline mr-1" /> Filed ({filedReports.length})
          </button>
          <button
            onClick={() => setActiveTab('received')}
            className={`flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors ${
              activeTab === 'received' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <TrendingUp className="w-4 h-4 inline mr-1" /> My Reports ({receivedReports.length})
          </button>
        </div>

        {/* New Report Form */}
        {activeTab === 'new' && (
          <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg border border-gray-700 p-6 space-y-5">
            <h2 className="text-lg font-semibold text-white">File Shift Completion Report</h2>

            {/* Trainee + Date */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Trainee <span className="text-red-400">*</span></label>
                <select
                  value={traineeId}
                  onChange={(e) => setTraineeId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                >
                  <option value="">Select a trainee...</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Shift Date <span className="text-red-400">*</span></label>
                <input
                  type="date"
                  value={shiftDate}
                  onChange={(e) => setShiftDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>

            {/* Hours + Calls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Hours on Shift <span className="text-red-400">*</span></label>
                <input
                  type="number"
                  value={hoursOnShift || ''}
                  onChange={(e) => setHoursOnShift(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  required
                  min={0.5}
                  max={48}
                  step={0.5}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Calls Responded</label>
                <input
                  type="number"
                  value={callsResponded || ''}
                  onChange={(e) => setCallsResponded(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  min={0}
                />
              </div>
            </div>

            {/* Call Types */}
            {callsResponded > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Call Types</label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {COMMON_CALL_TYPES.map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => {
                        if (callTypes.includes(ct)) {
                          setCallTypes(callTypes.filter((t) => t !== ct));
                        } else {
                          setCallTypes([...callTypes, ct]);
                        }
                      }}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        callTypes.includes(ct)
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                      }`}
                    >
                      {ct}
                    </button>
                  ))}
                </div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={callTypeInput}
                    onChange={(e) => setCallTypeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCallType(); } }}
                    placeholder="Custom call type..."
                    className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                  <button type="button" onClick={addCallType} className="px-3 py-1.5 bg-gray-600 text-white rounded text-sm hover:bg-gray-500">
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* Pipeline Enrollment */}
            {traineeId && enrollments.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Link to Pipeline (optional)</label>
                <select
                  value={enrollmentId}
                  onChange={(e) => setEnrollmentId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">No specific pipeline</option>
                  {enrollments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.program?.name || 'Program'} ({Math.round(e.progress_percentage || 0)}% complete)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Shift hours and calls will automatically count toward pipeline requirements
                </p>
              </div>
            )}

            {/* Performance Rating */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Performance Rating</label>
              <StarRating value={rating} onChange={setRating} />
            </div>

            {/* Narrative Fields */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Officer Narrative</label>
              <textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                rows={3}
                placeholder="Describe the trainee's overall shift experience..."
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Areas of Strength</label>
                <textarea
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                  rows={2}
                  placeholder="What did the trainee do well?"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Areas for Improvement</label>
                <textarea
                  value={improvements}
                  onChange={(e) => setImprovements(e.target.value)}
                  rows={2}
                  placeholder="Where can the trainee improve?"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            {/* Skills Observed */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-300">Skills Observed</label>
                <button type="button" onClick={addSkill} className="text-xs text-red-400 hover:text-red-300 flex items-center space-x-1">
                  <Plus className="w-3 h-3" /><span>Add Skill</span>
                </button>
              </div>
              {skills.map((skill, i) => (
                <div key={i} className="flex items-center space-x-2 mb-2">
                  <input
                    type="text"
                    value={skill.skill_name}
                    onChange={(e) => updateSkill(i, { skill_name: e.target.value })}
                    placeholder="Skill name"
                    className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                  <label className="flex items-center space-x-1">
                    <input
                      type="checkbox"
                      checked={skill.demonstrated}
                      onChange={(e) => updateSkill(i, { demonstrated: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-green-600"
                    />
                    <span className="text-xs text-gray-400">Demo'd</span>
                  </label>
                  <button type="button" onClick={() => removeSkill(i)} className="text-gray-500 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Tasks Performed */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-300">Tasks Performed</label>
                <button type="button" onClick={addTask} className="text-xs text-red-400 hover:text-red-300 flex items-center space-x-1">
                  <Plus className="w-3 h-3" /><span>Add Task</span>
                </button>
              </div>
              {tasks.map((task, i) => (
                <div key={i} className="flex items-center space-x-2 mb-2">
                  <input
                    type="text"
                    value={task.task}
                    onChange={(e) => updateTask(i, { task: e.target.value })}
                    placeholder="Task name"
                    className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                  <input
                    type="text"
                    value={task.description || ''}
                    onChange={(e) => updateTask(i, { description: e.target.value || undefined })}
                    placeholder="Notes (optional)"
                    className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                  />
                  <button type="button" onClick={() => removeTask(i)} className="text-gray-500 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Submit */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-700">
              <p className="text-xs text-gray-500">
                {enrollmentId
                  ? 'Hours and calls will automatically update pipeline requirements.'
                  : 'Will update any active pipeline requirements for this trainee.'}
              </p>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center space-x-2 px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? 'Filing...' : 'File Report'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Filed Reports */}
        {activeTab === 'filed' && (
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500" />
              </div>
            ) : filedReports.length === 0 ? (
              <div className="text-center py-12 bg-gray-800 rounded-lg">
                <ClipboardList className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">No reports filed yet.</p>
              </div>
            ) : (
              filedReports.map((r) => (
                <ReportCard key={r.id} report={r} memberMap={memberMap} />
              ))
            )}
          </div>
        )}

        {/* Received Reports (trainee view) */}
        {activeTab === 'received' && (
          <div className="space-y-3">
            {loading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500" />
              </div>
            ) : receivedReports.length === 0 ? (
              <div className="text-center py-12 bg-gray-800 rounded-lg">
                <TrendingUp className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <p className="text-gray-400">No shift reports about you yet.</p>
              </div>
            ) : (
              receivedReports.map((r) => (
                <div key={r.id}>
                  <ReportCard report={r} memberMap={memberMap} />
                  {!r.trainee_acknowledged && (
                    <div className="mt-1 flex justify-end">
                      <button
                        onClick={() => handleAcknowledge(r.id)}
                        className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Acknowledge
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default ShiftReportPage;
