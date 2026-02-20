/**
 * Historical Training Import Page
 *
 * Multi-step wizard for importing historical member training records from CSV.
 * Steps:
 *   1. Upload CSV file
 *   2. Map unmatched courses to existing courses or create new ones
 *   3. Preview matched rows and review warnings
 *   4. Confirm import and see results
 *
 * Requires: training.manage permission
 */

import React, { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Download,
  Users,
  BookOpen,
  Search,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { trainingService } from '../services/api';
import type {
  HistoricalImportParseResponse,
  HistoricalImportParsedRow,
  UnmatchedCourse,
  CourseMappingEntry,
  HistoricalImportConfirmRequest,
  HistoricalImportResult,
  TrainingCourse,
  TrainingType,
} from '../types/training';

// ==================== Constants ====================

type MatchStrategy = 'email' | 'badge_number' | 'name';

const MATCH_STRATEGIES: { value: MatchStrategy; label: string; description: string; requiredCol: string }[] = [
  { value: 'email', label: 'Email Address', description: 'Match members by their email address', requiredCol: 'email' },
  { value: 'badge_number', label: 'Badge Number', description: 'Match members by badge/employee number', requiredCol: 'badge_number' },
  { value: 'name', label: 'Full Name', description: 'Match members by first + last name (case-insensitive)', requiredCol: 'name' },
];

const TRAINING_TYPE_OPTIONS: { value: TrainingType; label: string }[] = [
  { value: 'certification', label: 'Certification' },
  { value: 'continuing_education', label: 'Continuing Education' },
  { value: 'skills_practice', label: 'Skills Practice' },
  { value: 'orientation', label: 'Orientation' },
  { value: 'refresher', label: 'Refresher' },
  { value: 'specialty', label: 'Specialty' },
];

const STEPS = [
  { id: 1, label: 'Upload CSV' },
  { id: 2, label: 'Map Courses' },
  { id: 3, label: 'Preview' },
  { id: 4, label: 'Results' },
];

// ==================== Step Indicator ====================

const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => (
  <nav aria-label="Import progress" className="mb-8">
    <ol className="flex items-center">
      {STEPS.map((step, idx) => {
        const isComplete = currentStep > step.id;
        const isCurrent = currentStep === step.id;
        return (
          <li key={step.id} className="flex items-center">
            <div className="flex items-center">
              <span
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  isComplete
                    ? 'bg-green-600 text-white'
                    : isCurrent
                    ? 'bg-red-600 text-white'
                    : 'bg-theme-surface-hover text-theme-text-muted'
                }`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isComplete ? <CheckCircle2 className="w-5 h-5" /> : step.id}
              </span>
              <span
                className={`ml-2 text-sm font-medium ${
                  isCurrent ? 'text-theme-text-primary' : 'text-theme-text-muted'
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className="w-12 mx-3 h-px bg-theme-surface-border" />
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);

// ==================== Step 1: Upload CSV ====================

interface UploadStepProps {
  onParsed: (result: HistoricalImportParseResponse) => void;
  matchBy: MatchStrategy;
  onMatchByChange: (strategy: MatchStrategy) => void;
}

const UploadStep: React.FC<UploadStepProps> = ({ onParsed, matchBy, onMatchByChange }) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }
    setFileName(file.name);
    setUploading(true);
    try {
      const result = await trainingService.parseHistoricalImport(file, matchBy);
      onParsed(result);
      toast.success(`Parsed ${result.total_rows} rows from ${file.name}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
      setFileName(null);
    } finally {
      setUploading(false);
    }
  }, [onParsed, matchBy]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          dragActive
            ? 'border-red-500 bg-red-500/5'
            : 'border-theme-surface-border hover:border-red-400'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {uploading ? (
          <div className="space-y-3">
            <div className="animate-spin mx-auto w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full" />
            <p className="text-theme-text-muted">Parsing {fileName}...</p>
          </div>
        ) : (
          <>
            <Upload className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
            <p className="text-lg font-medium text-theme-text-primary mb-2">
              Drop your CSV file here, or click to browse
            </p>
            <p className="text-sm text-theme-text-muted mb-4">
              Accepts .csv files with member training history
            </p>
            <label className="inline-flex items-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg cursor-pointer transition-colors">
              <Upload className="w-4 h-4 mr-2" />
              Choose File
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleInputChange}
              />
            </label>
          </>
        )}
      </div>

      {/* Match strategy selector */}
      <div className="bg-theme-surface-secondary rounded-xl p-5 border border-theme-surface-border">
        <h3 className="text-sm font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
          <Users className="w-4 h-4" />
          How should members be matched?
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MATCH_STRATEGIES.map((strategy) => (
            <button
              key={strategy.value}
              onClick={() => onMatchByChange(strategy.value)}
              className={`text-left p-3 rounded-lg border-2 transition-colors ${
                matchBy === strategy.value
                  ? 'border-red-500 bg-red-600/10'
                  : 'border-theme-surface-border hover:border-theme-text-muted'
              }`}
            >
              <span className={`block text-sm font-medium ${
                matchBy === strategy.value ? 'text-red-400' : 'text-theme-text-primary'
              }`}>
                {strategy.label}
              </span>
              <span className="block text-xs text-theme-text-muted mt-0.5">
                {strategy.description}
              </span>
              <span className="block text-xs text-theme-text-muted mt-1">
                Required column: <code className="text-red-500">{strategy.requiredCol}</code>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Required columns info */}
      <div className="bg-theme-surface-secondary rounded-xl p-5 border border-theme-surface-border">
        <h3 className="text-sm font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
          <Info className="w-4 h-4" />
          CSV Format Guide
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-medium text-theme-text-primary mb-1">Required Columns</p>
            <ul className="text-theme-text-muted space-y-0.5">
              {matchBy === 'email' && <li><code className="text-red-500">email</code> - Member email for matching</li>}
              {matchBy === 'badge_number' && <li><code className="text-red-500">badge_number</code> - Badge or employee number</li>}
              {matchBy === 'name' && <li><code className="text-red-500">name</code> - Full name (or <code>first_name</code> + <code>last_name</code>)</li>}
              <li><code className="text-red-500">course_name</code> - Training course title</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-theme-text-primary mb-1">Optional Columns</p>
            <ul className="text-theme-text-muted space-y-0.5">
              <li><code>completion_date</code>, <code>hours</code>, <code>training_type</code></li>
              <li><code>certification_number</code>, <code>expiration_date</code></li>
              <li><code>instructor</code>, <code>location</code>, <code>score</code></li>
              <li><code>issuing_agency</code>, <code>notes</code>, <code>name</code></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Sample CSV download */}
      <button
        onClick={() => {
          const templates: Record<MatchStrategy, string> = {
            email: 'email,course_name,completion_date,hours,training_type,certification_number,expiration_date,instructor,location,score,notes\njohn@dept.gov,Firefighter I,2024-01-15,40,certification,FF-12345,2026-01-15,Chief Smith,Station 1,95,Annual certification\njane@dept.gov,EMT Refresher,2024-03-20,8,refresher,,,Dr. Jones,Training Center,,Quarterly refresher\n',
            badge_number: 'badge_number,name,course_name,completion_date,hours,training_type,certification_number,expiration_date,instructor,location,score,notes\n1234,John Smith,Firefighter I,2024-01-15,40,certification,FF-12345,2026-01-15,Chief Smith,Station 1,95,Annual certification\n5678,Jane Doe,EMT Refresher,2024-03-20,8,refresher,,,Dr. Jones,Training Center,,Quarterly refresher\n',
            name: 'name,course_name,completion_date,hours,training_type,certification_number,expiration_date,instructor,location,score,notes\nJohn Smith,Firefighter I,2024-01-15,40,certification,FF-12345,2026-01-15,Chief Smith,Station 1,95,Annual certification\nJane Doe,EMT Refresher,2024-03-20,8,refresher,,,Dr. Jones,Training Center,,Quarterly refresher\n',
          };
          const blob = new Blob([templates[matchBy]], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'training_import_template.csv';
          a.click();
          URL.revokeObjectURL(url);
        }}
        className="inline-flex items-center text-sm text-red-500 hover:text-red-400 transition-colors"
      >
        <Download className="w-4 h-4 mr-1" />
        Download sample CSV template
      </button>
    </div>
  );
};

// ==================== Step 2: Map Courses ====================

interface MapCoursesStepProps {
  unmatchedCourses: UnmatchedCourse[];
  existingCourses: TrainingCourse[];
  courseMappings: CourseMappingEntry[];
  onMappingsChange: (mappings: CourseMappingEntry[]) => void;
  onNext: () => void;
  onBack: () => void;
}

const MapCoursesStep: React.FC<MapCoursesStepProps> = ({
  unmatchedCourses,
  existingCourses,
  courseMappings,
  onMappingsChange,
  onNext,
  onBack,
}) => {
  const [courseSearch, setCourseSearch] = useState<Record<string, string>>({});

  const updateMapping = (csvName: string, update: Partial<CourseMappingEntry>) => {
    const existing = courseMappings.find(m => m.csv_course_name === csvName);
    if (existing) {
      onMappingsChange(
        courseMappings.map(m =>
          m.csv_course_name === csvName ? { ...m, ...update } : m
        )
      );
    } else {
      onMappingsChange([
        ...courseMappings,
        { csv_course_name: csvName, action: 'create_new', ...update },
      ]);
    }
  };

  const getMappingForCourse = (csvName: string): CourseMappingEntry => {
    return courseMappings.find(m => m.csv_course_name === csvName) || {
      csv_course_name: csvName,
      action: 'create_new',
    };
  };

  if (unmatchedCourses.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-6 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary">All Courses Matched</h3>
          <p className="text-sm text-theme-text-muted mt-1">
            Every course in your CSV matched an existing course in the system.
          </p>
        </div>
        <div className="flex justify-between">
          <button onClick={onBack} className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors">
            <ArrowLeft className="w-4 h-4 inline mr-1" /> Back
          </button>
          <button onClick={onNext} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">
            Continue to Preview <ArrowRight className="w-4 h-4 inline ml-1" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-medium text-theme-text-primary">
              {unmatchedCourses.length} course{unmatchedCourses.length !== 1 ? 's' : ''} not found in the system
            </h3>
            <p className="text-sm text-theme-text-muted mt-1">
              For each course below, choose to map it to an existing course, create it as new, or skip those rows.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {unmatchedCourses.map((uc) => {
          const mapping = getMappingForCourse(uc.csv_course_name);
          const searchVal = courseSearch[uc.csv_course_name] || '';
          const filteredCourses = existingCourses.filter(c =>
            c.name.toLowerCase().includes(searchVal.toLowerCase()) ||
            (c.code && c.code.toLowerCase().includes(searchVal.toLowerCase()))
          );

          return (
            <div
              key={uc.csv_course_name}
              className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-medium text-theme-text-primary">{uc.csv_course_name}</span>
                  {uc.csv_course_code && (
                    <span className="ml-2 text-xs text-theme-text-muted">({uc.csv_course_code})</span>
                  )}
                  <span className="ml-2 text-xs bg-theme-surface-hover px-2 py-0.5 rounded-full text-theme-text-muted">
                    {uc.occurrences} row{uc.occurrences !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 mb-3">
                {(['map_existing', 'create_new', 'skip'] as const).map((action) => (
                  <button
                    key={action}
                    onClick={() => updateMapping(uc.csv_course_name, { action })}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      mapping.action === action
                        ? action === 'skip'
                          ? 'bg-gray-500/20 border-gray-500 text-gray-300'
                          : 'bg-red-600/20 border-red-500 text-red-400'
                        : 'border-theme-surface-border text-theme-text-muted hover:border-theme-text-muted'
                    }`}
                  >
                    {action === 'map_existing' && 'Map to Existing'}
                    {action === 'create_new' && 'Create New'}
                    {action === 'skip' && 'Skip'}
                  </button>
                ))}
              </div>

              {/* Map existing: show course picker */}
              {mapping.action === 'map_existing' && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                    <label htmlFor={`course-search-${uc.csv_course_name}`} className="sr-only">
                      Search existing courses
                    </label>
                    <input
                      id={`course-search-${uc.csv_course_name}`}
                      type="text"
                      placeholder="Search existing courses..."
                      value={searchVal}
                      onChange={(e) => setCourseSearch(prev => ({ ...prev, [uc.csv_course_name]: e.target.value }))}
                      className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {filteredCourses.slice(0, 20).map((course) => (
                      <button
                        key={course.id}
                        onClick={() => updateMapping(uc.csv_course_name, {
                          action: 'map_existing',
                          existing_course_id: course.id,
                        })}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          mapping.existing_course_id === course.id
                            ? 'bg-red-600/20 border border-red-500'
                            : 'hover:bg-theme-surface-hover text-theme-text-muted'
                        }`}
                      >
                        <span className="text-theme-text-primary">{course.name}</span>
                        {course.code && (
                          <span className="ml-2 text-xs text-theme-text-muted">({course.code})</span>
                        )}
                      </button>
                    ))}
                    {filteredCourses.length === 0 && (
                      <p className="text-sm text-theme-text-muted py-2 px-3">No matching courses found</p>
                    )}
                  </div>
                </div>
              )}

              {/* Create new: show training type picker */}
              {mapping.action === 'create_new' && (
                <div>
                  <label htmlFor={`training-type-${uc.csv_course_name}`} className="block text-xs text-theme-text-muted mb-1">
                    Training type for new course:
                  </label>
                  <select
                    id={`training-type-${uc.csv_course_name}`}
                    value={mapping.new_training_type || 'continuing_education'}
                    onChange={(e) => updateMapping(uc.csv_course_name, { new_training_type: e.target.value })}
                    className="w-full max-w-xs px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {TRAINING_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between pt-4">
        <button onClick={onBack} className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors">
          <ArrowLeft className="w-4 h-4 inline mr-1" /> Back
        </button>
        <button onClick={onNext} className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors">
          Continue to Preview <ArrowRight className="w-4 h-4 inline ml-1" />
        </button>
      </div>
    </div>
  );
};

// ==================== Step 3: Preview ====================

interface PreviewStepProps {
  parseResult: HistoricalImportParseResponse;
  courseMappings: CourseMappingEntry[];
  onConfirm: () => void;
  onBack: () => void;
  confirming: boolean;
}

const PreviewStep: React.FC<PreviewStepProps> = ({
  parseResult,
  courseMappings,
  onConfirm,
  onBack,
  confirming,
}) => {
  const [showAll, setShowAll] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'matched' | 'unmatched' | 'errors'>('all');

  const skippedCourses = new Set(
    courseMappings.filter(m => m.action === 'skip').map(m => m.csv_course_name.toLowerCase())
  );

  const rows = parseResult.rows.filter(row => {
    if (filterType === 'matched') return row.member_matched && !row.errors.length;
    if (filterType === 'unmatched') return !row.member_matched;
    if (filterType === 'errors') return row.errors.length > 0;
    return true;
  });

  const importableRows = parseResult.rows.filter(
    r => r.member_matched && !skippedCourses.has(r.course_name.toLowerCase())
  );

  const displayRows = showAll ? rows : rows.slice(0, 50);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-theme-text-primary">{parseResult.total_rows}</div>
          <div className="text-xs text-theme-text-muted">Total Rows</div>
        </div>
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-green-500">{importableRows.length}</div>
          <div className="text-xs text-green-400">Will Import</div>
        </div>
        <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-theme-text-primary">{parseResult.members_matched}</div>
          <div className="text-xs text-theme-text-muted">Members Matched</div>
        </div>
        <div className={`border rounded-xl p-4 text-center ${
          parseResult.members_unmatched > 0
            ? 'bg-yellow-500/10 border-yellow-500/20'
            : 'bg-theme-surface-secondary border-theme-surface-border'
        }`}>
          <div className={`text-2xl font-bold ${parseResult.members_unmatched > 0 ? 'text-yellow-500' : 'text-theme-text-primary'}`}>
            {parseResult.members_unmatched}
          </div>
          <div className={`text-xs ${parseResult.members_unmatched > 0 ? 'text-yellow-400' : 'text-theme-text-muted'}`}>
            Members Not Found
          </div>
        </div>
      </div>

      {/* Parse errors */}
      {parseResult.parse_errors.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4">
          <h4 className="font-medium text-yellow-400 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Warnings ({parseResult.parse_errors.length})
          </h4>
          <ul className="text-sm text-theme-text-muted space-y-1 max-h-32 overflow-y-auto">
            {parseResult.parse_errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Filter buttons */}
      <div className="flex gap-2">
        {(['all', 'matched', 'unmatched', 'errors'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilterType(f)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              filterType === f
                ? 'bg-red-600/20 border-red-500 text-red-400'
                : 'border-theme-surface-border text-theme-text-muted hover:border-theme-text-muted'
            }`}
          >
            {f === 'all' && `All (${parseResult.rows.length})`}
            {f === 'matched' && `Ready (${parseResult.rows.filter(r => r.member_matched && !r.errors.length).length})`}
            {f === 'unmatched' && `No Match (${parseResult.rows.filter(r => !r.member_matched).length})`}
            {f === 'errors' && `Errors (${parseResult.rows.filter(r => r.errors.length > 0).length})`}
          </button>
        ))}
      </div>

      {/* Data table */}
      <div className="overflow-x-auto border border-theme-surface-border rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-theme-surface-secondary border-b border-theme-surface-border">
              <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase" scope="col">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase" scope="col">Member</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase" scope="col">Course</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase" scope="col">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase" scope="col">Hours</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-theme-text-muted uppercase" scope="col">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-theme-surface-border">
            {displayRows.map((row) => {
              const isSkipped = skippedCourses.has(row.course_name.toLowerCase());
              return (
                <tr
                  key={row.row_number}
                  className={`${
                    isSkipped ? 'opacity-40' : ''
                  } ${
                    row.errors.length > 0 ? 'bg-red-500/5' : ''
                  }`}
                >
                  <td className="px-4 py-2 text-theme-text-muted">{row.row_number}</td>
                  <td className="px-4 py-2">
                    {row.member_matched ? (
                      <div>
                        <span className="text-theme-text-primary">{row.matched_member_name}</span>
                        <span className="block text-xs text-theme-text-muted">
                          {row.email || row.badge_number || row.member_name}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-yellow-400">
                          {row.member_name || row.email || row.badge_number || 'Unknown'}
                        </span>
                        <span className="block text-xs text-yellow-500">No match</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-theme-text-primary">{row.course_name}</span>
                    {row.course_matched && (
                      <CheckCircle2 className="inline w-3.5 h-3.5 text-green-500 ml-1" />
                    )}
                    {isSkipped && <span className="text-xs text-gray-400 ml-1">(skipped)</span>}
                  </td>
                  <td className="px-4 py-2 text-theme-text-muted">{row.completion_date || '-'}</td>
                  <td className="px-4 py-2 text-theme-text-muted">{row.hours_completed ?? '-'}</td>
                  <td className="px-4 py-2">
                    {row.errors.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-400">
                        <XCircle className="w-3.5 h-3.5" /> {row.errors[0]}
                      </span>
                    ) : row.member_matched ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
                        <AlertTriangle className="w-3.5 h-3.5" /> Skipped
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > 50 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-sm text-red-500 hover:text-red-400"
        >
          Show all {rows.length} rows <ChevronDown className="w-4 h-4 inline" />
        </button>
      )}
      {showAll && rows.length > 50 && (
        <button
          onClick={() => setShowAll(false)}
          className="text-sm text-red-500 hover:text-red-400"
        >
          Show fewer <ChevronUp className="w-4 h-4 inline" />
        </button>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between pt-4 border-t border-theme-surface-border">
        <button onClick={onBack} className="px-4 py-2 text-theme-text-muted hover:text-theme-text-primary transition-colors">
          <ArrowLeft className="w-4 h-4 inline mr-1" /> Back
        </button>
        <div className="flex items-center gap-4">
          <span className="text-sm text-theme-text-muted">
            {importableRows.length} record{importableRows.length !== 1 ? 's' : ''} will be imported
          </span>
          <button
            onClick={onConfirm}
            disabled={confirming || importableRows.length === 0}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {confirming ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                Importing...
              </>
            ) : (
              <>Confirm Import</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== Step 4: Results ====================

interface ResultsStepProps {
  result: HistoricalImportResult;
  onReset: () => void;
}

const ResultsStep: React.FC<ResultsStepProps> = ({ result, onReset }) => (
  <div className="space-y-6">
    <div className={`rounded-xl p-8 text-center ${
      result.failed > 0
        ? 'bg-yellow-500/10 border border-yellow-500/20'
        : 'bg-green-500/10 border border-green-500/20'
    }`}>
      {result.failed > 0 ? (
        <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
      ) : (
        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
      )}
      <h2 className="text-xl font-bold text-theme-text-primary mb-2">
        Import Complete
      </h2>
      <p className="text-theme-text-muted">
        Successfully imported {result.imported} of {result.total} training records.
      </p>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-theme-text-primary">{result.total}</div>
        <div className="text-xs text-theme-text-muted">Total</div>
      </div>
      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-green-500">{result.imported}</div>
        <div className="text-xs text-green-400">Imported</div>
      </div>
      <div className="bg-theme-surface-secondary border border-theme-surface-border rounded-xl p-4 text-center">
        <div className="text-2xl font-bold text-theme-text-muted">{result.skipped}</div>
        <div className="text-xs text-theme-text-muted">Skipped</div>
      </div>
      <div className={`border rounded-xl p-4 text-center ${
        result.failed > 0
          ? 'bg-red-500/10 border-red-500/20'
          : 'bg-theme-surface-secondary border-theme-surface-border'
      }`}>
        <div className={`text-2xl font-bold ${result.failed > 0 ? 'text-red-500' : 'text-theme-text-muted'}`}>
          {result.failed}
        </div>
        <div className={`text-xs ${result.failed > 0 ? 'text-red-400' : 'text-theme-text-muted'}`}>Failed</div>
      </div>
    </div>

    {result.errors.length > 0 && (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
        <h4 className="font-medium text-red-400 mb-2">Errors</h4>
        <ul className="text-sm text-theme-text-muted space-y-1">
          {result.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      </div>
    )}

    <div className="pt-4">
      <button
        onClick={onReset}
        className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
      >
        Import Another File
      </button>
    </div>
  </div>
);

// ==================== Main Component ====================

const HistoricalImportPage: React.FC = () => {
  const [step, setStep] = useState(1);
  const [matchBy, setMatchBy] = useState<MatchStrategy>('email');
  const [parseResult, setParseResult] = useState<HistoricalImportParseResponse | null>(null);
  const [courseMappings, setCourseMappings] = useState<CourseMappingEntry[]>([]);
  const [existingCourses, setExistingCourses] = useState<TrainingCourse[]>([]);
  const [importResult, setImportResult] = useState<HistoricalImportResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleParsed = useCallback(async (result: HistoricalImportParseResponse) => {
    setParseResult(result);

    // Initialize course mappings for unmatched courses (default: create_new)
    const initialMappings: CourseMappingEntry[] = result.unmatched_courses.map(uc => ({
      csv_course_name: uc.csv_course_name,
      action: 'create_new' as const,
      new_training_type: 'continuing_education',
    }));
    setCourseMappings(initialMappings);

    // Load existing courses for mapping step
    try {
      const courses = await trainingService.getCourses(true);
      setExistingCourses(courses);
    } catch {
      // Non-critical: mapping step will just have no courses to pick from
    }

    // Skip to step 2 (or 3 if no unmatched courses)
    if (result.unmatched_courses.length === 0) {
      setStep(3);
    } else {
      setStep(2);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!parseResult) return;
    setConfirming(true);
    try {
      const request: HistoricalImportConfirmRequest = {
        rows: parseResult.rows,
        course_mappings: courseMappings,
        default_training_type: 'continuing_education',
        default_status: 'completed',
      };
      const result = await trainingService.confirmHistoricalImport(request);
      setImportResult(result);
      setStep(4);
      toast.success(`Imported ${result.imported} training records`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  }, [parseResult, courseMappings]);

  const handleReset = useCallback(() => {
    setStep(1);
    setMatchBy('email');
    setParseResult(null);
    setCourseMappings([]);
    setImportResult(null);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Import Historical Training
        </h2>
        <p className="mt-1 text-sm text-theme-text-muted">
          Upload a CSV file to bulk-import past training records for your members.
        </p>
      </div>

      <StepIndicator currentStep={step} />

      {step === 1 && <UploadStep onParsed={handleParsed} matchBy={matchBy} onMatchByChange={setMatchBy} />}

      {step === 2 && parseResult && (
        <MapCoursesStep
          unmatchedCourses={parseResult.unmatched_courses}
          existingCourses={existingCourses}
          courseMappings={courseMappings}
          onMappingsChange={setCourseMappings}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && parseResult && (
        <PreviewStep
          parseResult={parseResult}
          courseMappings={courseMappings}
          onConfirm={handleConfirm}
          onBack={() => parseResult.unmatched_courses.length > 0 ? setStep(2) : setStep(1)}
          confirming={confirming}
        />
      )}

      {step === 4 && importResult && (
        <ResultsStep result={importResult} onReset={handleReset} />
      )}
    </div>
  );
};

export default HistoricalImportPage;
