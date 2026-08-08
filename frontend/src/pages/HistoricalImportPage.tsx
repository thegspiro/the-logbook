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
  Search,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { trainingService } from '../services/api';
import type {
  HistoricalImportParseResponse,
  UnmatchedCourse,
  CourseMappingEntry,
  HistoricalImportConfirmRequest,
  HistoricalImportResult,
  TrainingCourse,
  TrainingType,
} from '../types/training';

// ==================== Constants ====================

type MatchStrategy = 'email' | 'membership_number';

const MATCH_STRATEGIES: { value: MatchStrategy; label: string; description: string; requiredCol: string }[] = [
  {
    value: 'membership_number',
    label: 'Membership Number',
    description: 'Most reliable — match by membership number',
    requiredCol: 'membership_number',
  },
  { value: 'email', label: 'Email Address', description: 'Match members by their email address', requiredCol: 'email' },
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
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  isComplete
                    ? 'bg-green-600 text-white'
                    : isCurrent
                      ? 'bg-red-600 text-white'
                      : 'bg-theme-surface-hover text-theme-text-muted'
                }`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isComplete ? <CheckCircle2 className="h-5 w-5" /> : step.id}
              </span>
              <span
                className={`ml-2 text-sm font-medium ${
                  isCurrent ? 'text-theme-text-primary' : 'text-theme-text-muted'
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && <div className="bg-theme-surface-border mx-3 h-px w-12" />}
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

  const handleFile = useCallback(
    async (file: File) => {
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
    },
    [onParsed, matchBy]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        className={`rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
          dragActive ? 'border-red-500 bg-red-500/5' : 'border-theme-surface-border hover:border-red-400'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {uploading ? (
          <div className="space-y-3">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-red-500 border-t-transparent" />
            <p className="text-theme-text-muted">Parsing {fileName}...</p>
          </div>
        ) : (
          <>
            <Upload className="text-theme-text-muted mx-auto mb-4 h-12 w-12" />
            <p className="text-theme-text-primary mb-2 text-lg font-medium">
              Drop your CSV file here, or click to browse
            </p>
            <p className="text-theme-text-muted mb-4 text-sm">Accepts .csv files with member training history</p>
            <label className="btn-primary inline-flex cursor-pointer items-center">
              <Upload className="mr-2 h-4 w-4" />
              Choose File
              <input type="file" accept=".csv" className="hidden" onChange={handleInputChange} />
            </label>
          </>
        )}
      </div>

      {/* Match strategy selector */}
      <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-5">
        <h3 className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" />
          How should members be matched?
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {MATCH_STRATEGIES.map((strategy) => (
            <button
              key={strategy.value}
              onClick={() => onMatchByChange(strategy.value)}
              className={`rounded-lg border-2 p-3 text-left transition-colors ${
                matchBy === strategy.value
                  ? 'border-red-500 bg-red-600/10'
                  : 'border-theme-surface-border hover:border-theme-text-muted'
              }`}
            >
              <span
                className={`block text-sm font-medium ${
                  matchBy === strategy.value ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'
                }`}
              >
                {strategy.label}
              </span>
              <span className="text-theme-text-muted mt-0.5 block text-xs">{strategy.description}</span>
              <span className="text-theme-text-muted mt-1 block text-xs">
                Required column: <code className="text-red-500">{strategy.requiredCol}</code>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Required columns info */}
      <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-5">
        <h3 className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-semibold">
          <Info className="h-4 w-4" />
          CSV Format Guide
        </h3>
        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-theme-text-primary mb-1 font-medium">Required Columns</p>
            <ul className="text-theme-text-muted space-y-0.5">
              {matchBy === 'email' && (
                <li>
                  <code className="text-red-500">email</code> - Member email for matching
                </li>
              )}
              {matchBy === 'membership_number' && (
                <li>
                  <code className="text-red-500">membership_number</code> - Membership number
                </li>
              )}
              <li>
                <code className="text-red-500">course_name</code> - Training course title
              </li>
            </ul>
          </div>
          <div>
            <p className="text-theme-text-primary mb-1 font-medium">Optional Columns</p>
            <ul className="text-theme-text-muted space-y-0.5">
              <li>
                <code>completion_date</code>, <code>hours</code>, <code>training_type</code>
              </li>
              <li>
                <code>certification_number</code>, <code>expiration_date</code>
              </li>
              <li>
                <code>instructor</code>, <code>location</code>, <code>score</code>
              </li>
              <li>
                <code>issuing_agency</code>, <code>notes</code>, <code>name</code>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Sample CSV download */}
      <button
        onClick={() => {
          const templates: Record<MatchStrategy, string> = {
            email:
              'email,course_name,completion_date,hours,training_type,certification_number,expiration_date,instructor,location,score,notes\njohn@dept.gov,Firefighter I,2024-01-15,40,certification,FF-12345,2026-01-15,Chief Smith,Station 1,95,Annual certification\njane@dept.gov,EMT Refresher,2024-03-20,8,refresher,,,Dr. Jones,Training Center,,Quarterly refresher\n',
            membership_number:
              'membership_number,name,course_name,completion_date,hours,training_type,certification_number,expiration_date,instructor,location,score,notes\n1234,John Smith,Firefighter I,2024-01-15,40,certification,FF-12345,2026-01-15,Chief Smith,Station 1,95,Annual certification\n5678,Jane Doe,EMT Refresher,2024-03-20,8,refresher,,,Dr. Jones,Training Center,,Quarterly refresher\n',
          };
          const blob = new Blob([templates[matchBy]], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'training_import_template.csv';
          a.click();
          URL.revokeObjectURL(url);
        }}
        className="inline-flex items-center text-sm text-red-500 transition-colors hover:text-red-800 dark:hover:text-red-400"
      >
        <Download className="mr-1 h-4 w-4" />
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
    const existing = courseMappings.find((m) => m.csv_course_name === csvName);
    if (existing) {
      onMappingsChange(courseMappings.map((m) => (m.csv_course_name === csvName ? { ...m, ...update } : m)));
    } else {
      onMappingsChange([...courseMappings, { csv_course_name: csvName, action: 'create_new', ...update }]);
    }
  };

  const getMappingForCourse = (csvName: string): CourseMappingEntry => {
    return (
      courseMappings.find((m) => m.csv_course_name === csvName) || {
        csv_course_name: csvName,
        action: 'create_new',
      }
    );
  };

  if (unmatchedCourses.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-500" />
          <h3 className="text-theme-text-primary text-lg font-medium">All Courses Matched</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            Every course in your CSV matched an existing course in the system.
          </p>
        </div>
        <div className="flex justify-between">
          <button
            onClick={onBack}
            className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 transition-colors"
          >
            <ArrowLeft className="mr-1 inline h-4 w-4" /> Back
          </button>
          <button onClick={onNext} className="btn-primary px-6">
            Continue to Preview <ArrowRight className="ml-1 inline h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-500" />
          <div>
            <h3 className="text-theme-text-primary font-medium">
              {unmatchedCourses.length} course{unmatchedCourses.length !== 1 ? 's' : ''} not found in the system
            </h3>
            <p className="text-theme-text-muted mt-1 text-sm">
              For each course below, choose to map it to an existing course, create it as new, or skip those rows.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {unmatchedCourses.map((uc) => {
          const mapping = getMappingForCourse(uc.csv_course_name);
          const searchVal = courseSearch[uc.csv_course_name] || '';
          const filteredCourses = existingCourses.filter(
            (c) =>
              c.name.toLowerCase().includes(searchVal.toLowerCase()) ||
              (c.code && c.code.toLowerCase().includes(searchVal.toLowerCase()))
          );

          return (
            <div
              key={uc.csv_course_name}
              className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <span className="text-theme-text-primary font-medium">{uc.csv_course_name}</span>
                  {uc.csv_course_code && (
                    <span className="text-theme-text-muted ml-2 text-xs">({uc.csv_course_code})</span>
                  )}
                  <span className="bg-theme-surface-hover text-theme-text-muted ml-2 rounded-full px-2 py-0.5 text-xs">
                    {uc.occurrences} row{uc.occurrences !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mb-3 flex gap-2">
                {(['map_existing', 'create_new', 'skip'] as const).map((action) => (
                  <button
                    key={action}
                    onClick={() => updateMapping(uc.csv_course_name, { action })}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      mapping.action === action
                        ? action === 'skip'
                          ? 'bg-theme-surface-hover border-theme-surface-border text-theme-text-muted'
                          : 'border-red-500 bg-red-600/20 text-red-700 dark:text-red-400'
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
                    <Search
                      className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <label htmlFor={`course-search-${uc.csv_course_name}`} className="sr-only">
                      Search existing courses
                    </label>
                    <input
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      id={`course-search-${uc.csv_course_name}`}
                      type="text"
                      aria-label="Search existing courses..."
                      placeholder="Search existing courses..."
                      value={searchVal}
                      onChange={(e) => setCourseSearch((prev) => ({ ...prev, [uc.csv_course_name]: e.target.value }))}
                      className="form-input placeholder-theme-text-muted pr-4 pl-10 text-sm"
                    />
                  </div>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {filteredCourses.slice(0, 20).map((course) => (
                      <button
                        key={course.id}
                        onClick={() =>
                          updateMapping(uc.csv_course_name, {
                            action: 'map_existing',
                            existing_course_id: course.id,
                          })
                        }
                        className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          mapping.existing_course_id === course.id
                            ? 'border border-red-500 bg-red-600/20'
                            : 'hover:bg-theme-surface-hover text-theme-text-muted'
                        }`}
                      >
                        <span className="text-theme-text-primary">{course.name}</span>
                        {course.code && <span className="text-theme-text-muted ml-2 text-xs">({course.code})</span>}
                      </button>
                    ))}
                    {filteredCourses.length === 0 && (
                      <p className="text-theme-text-muted px-3 py-2 text-sm">No matching courses found</p>
                    )}
                  </div>
                </div>
              )}

              {/* Create new: show training type picker */}
              {mapping.action === 'create_new' && (
                <div>
                  <label
                    htmlFor={`training-type-${uc.csv_course_name}`}
                    className="text-theme-text-muted mb-1 block text-xs"
                  >
                    Training type for new course:
                  </label>
                  <select
                    id={`training-type-${uc.csv_course_name}`}
                    value={mapping.new_training_type || 'continuing_education'}
                    onChange={(e) => updateMapping(uc.csv_course_name, { new_training_type: e.target.value })}
                    className="form-input max-w-xs text-sm"
                  >
                    {TRAINING_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-between pt-4">
        <button
          onClick={onBack}
          className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 transition-colors"
        >
          <ArrowLeft className="mr-1 inline h-4 w-4" /> Back
        </button>
        <button onClick={onNext} className="btn-primary px-6">
          Continue to Preview <ArrowRight className="ml-1 inline h-4 w-4" />
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

const PreviewStep: React.FC<PreviewStepProps> = ({ parseResult, courseMappings, onConfirm, onBack, confirming }) => {
  const [showAll, setShowAll] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'matched' | 'unmatched' | 'errors'>('all');

  const skippedCourses = new Set(
    courseMappings.filter((m) => m.action === 'skip').map((m) => m.csv_course_name.toLowerCase())
  );

  const rows = parseResult.rows.filter((row) => {
    if (filterType === 'matched') return row.member_matched && !row.errors.length;
    if (filterType === 'unmatched') return !row.member_matched;
    if (filterType === 'errors') return row.errors.length > 0;
    return true;
  });

  const importableRows = parseResult.rows.filter(
    (r) => r.member_matched && !skippedCourses.has(r.course_name.toLowerCase())
  );

  const displayRows = showAll ? rows : rows.slice(0, 50);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-4 text-center">
          <div className="text-theme-text-primary text-2xl font-bold">{parseResult.total_rows}</div>
          <div className="text-theme-text-muted text-xs">Total Rows</div>
        </div>
        <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-center">
          <div className="text-2xl font-bold text-green-500">{importableRows.length}</div>
          <div className="text-xs text-green-700 dark:text-green-400">Will Import</div>
        </div>
        <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-4 text-center">
          <div className="text-theme-text-primary text-2xl font-bold">{parseResult.members_matched}</div>
          <div className="text-theme-text-muted text-xs">Members Matched</div>
        </div>
        <div
          className={`rounded-xl border p-4 text-center ${
            parseResult.members_unmatched > 0
              ? 'border-yellow-500/20 bg-yellow-500/10'
              : 'bg-theme-surface-secondary border-theme-surface-border'
          }`}
        >
          <div
            className={`text-2xl font-bold ${parseResult.members_unmatched > 0 ? 'text-yellow-500' : 'text-theme-text-primary'}`}
          >
            {parseResult.members_unmatched}
          </div>
          <div
            className={`text-xs ${parseResult.members_unmatched > 0 ? 'text-yellow-700 dark:text-yellow-400' : 'text-theme-text-muted'}`}
          >
            Members Not Found
          </div>
        </div>
      </div>

      {/* Parse errors */}
      {parseResult.parse_errors.length > 0 && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4">
          <h4 className="mb-2 flex items-center gap-2 font-medium text-yellow-700 dark:text-yellow-400">
            <AlertTriangle className="h-4 w-4" />
            Warnings ({parseResult.parse_errors.length})
          </h4>
          <ul className="text-theme-text-muted max-h-32 space-y-1 overflow-y-auto text-sm">
            {parseResult.parse_errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Filter buttons */}
      <div className="flex gap-2">
        {(['all', 'matched', 'unmatched', 'errors'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilterType(f)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              filterType === f
                ? 'border-red-500 bg-red-600/20 text-red-700 dark:text-red-400'
                : 'border-theme-surface-border text-theme-text-muted hover:border-theme-text-muted'
            }`}
          >
            {f === 'all' && `All (${parseResult.rows.length})`}
            {f === 'matched' &&
              `Ready (${parseResult.rows.filter((r) => r.member_matched && !r.errors.length).length})`}
            {f === 'unmatched' && `No Match (${parseResult.rows.filter((r) => !r.member_matched).length})`}
            {f === 'errors' && `Errors (${parseResult.rows.filter((r) => r.errors.length > 0).length})`}
          </button>
        ))}
      </div>

      {/* Data table */}
      <div className="border-theme-surface-border overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-theme-surface-secondary border-theme-surface-border border-b">
              <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase" scope="col">
                #
              </th>
              <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase" scope="col">
                Member
              </th>
              <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase" scope="col">
                Course
              </th>
              <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase" scope="col">
                Date
              </th>
              <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase" scope="col">
                Hours
              </th>
              <th className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase" scope="col">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-theme-surface-border divide-y">
            {displayRows.map((row) => {
              const isSkipped = skippedCourses.has(row.course_name.toLowerCase());
              return (
                <tr
                  key={row.row_number}
                  className={`${isSkipped ? 'opacity-40' : ''} ${row.errors.length > 0 ? 'bg-red-500/5' : ''}`}
                >
                  <td className="text-theme-text-muted px-4 py-2">{row.row_number}</td>
                  <td className="px-4 py-2">
                    {row.member_matched ? (
                      <div>
                        <span className="text-theme-text-primary">{row.matched_member_name}</span>
                        <span className="text-theme-text-muted block text-xs">
                          {row.email || row.membership_number || row.member_name}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <span className="text-yellow-700 dark:text-yellow-400">
                          {row.member_name || row.email || row.membership_number || 'Unknown'}
                        </span>
                        <span className="block text-xs text-yellow-500">No match</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-theme-text-primary">{row.course_name}</span>
                    {row.course_matched && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5 text-green-500" />}
                    {isSkipped && <span className="text-theme-text-muted ml-1 text-xs">(skipped)</span>}
                  </td>
                  <td className="text-theme-text-muted px-4 py-2">{row.completion_date || '-'}</td>
                  <td className="text-theme-text-muted px-4 py-2">{row.hours_completed ?? '-'}</td>
                  <td className="px-4 py-2">
                    {row.errors.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
                        <XCircle className="h-3.5 w-3.5" /> {row.errors[0]}
                      </span>
                    ) : row.member_matched ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-400">
                        <AlertTriangle className="h-3.5 w-3.5" /> Skipped
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
          className="text-sm text-red-500 hover:text-red-800 dark:hover:text-red-400"
        >
          Show all {rows.length} rows <ChevronDown className="inline h-4 w-4" />
        </button>
      )}
      {showAll && rows.length > 50 && (
        <button
          onClick={() => setShowAll(false)}
          className="text-sm text-red-500 hover:text-red-800 dark:hover:text-red-400"
        >
          Show fewer <ChevronUp className="inline h-4 w-4" />
        </button>
      )}

      {/* Action bar */}
      <div className="border-theme-surface-border flex items-center justify-between border-t pt-4">
        <button
          onClick={onBack}
          className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 transition-colors"
        >
          <ArrowLeft className="mr-1 inline h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-4">
          <span className="text-theme-text-muted text-sm">
            {importableRows.length} record{importableRows.length !== 1 ? 's' : ''} will be imported
          </span>
          <button
            onClick={onConfirm}
            disabled={confirming || importableRows.length === 0}
            className="btn-primary px-6 disabled:cursor-not-allowed"
          >
            {confirming ? (
              <>
                <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
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
    <div
      className={`rounded-xl p-8 text-center ${
        result.failed > 0
          ? 'border border-yellow-500/20 bg-yellow-500/10'
          : 'border border-green-500/20 bg-green-500/10'
      }`}
    >
      {result.failed > 0 ? (
        <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
      ) : (
        <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
      )}
      <h2 className="text-theme-text-primary mb-2 text-xl font-bold">Import Complete</h2>
      <p className="text-theme-text-muted">
        Successfully imported {result.imported} of {result.total} training records.
      </p>
    </div>

    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-4 text-center">
        <div className="text-theme-text-primary text-2xl font-bold">{result.total}</div>
        <div className="text-theme-text-muted text-xs">Total</div>
      </div>
      <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-center">
        <div className="text-2xl font-bold text-green-500">{result.imported}</div>
        <div className="text-xs text-green-700 dark:text-green-400">Imported</div>
      </div>
      <div className="bg-theme-surface-secondary border-theme-surface-border rounded-xl border p-4 text-center">
        <div className="text-theme-text-muted text-2xl font-bold">{result.skipped}</div>
        <div className="text-theme-text-muted text-xs">Skipped</div>
      </div>
      <div
        className={`rounded-xl border p-4 text-center ${
          result.failed > 0
            ? 'border-red-500/20 bg-red-500/10'
            : 'bg-theme-surface-secondary border-theme-surface-border'
        }`}
      >
        <div className={`text-2xl font-bold ${result.failed > 0 ? 'text-red-500' : 'text-theme-text-muted'}`}>
          {result.failed}
        </div>
        <div className={`text-xs ${result.failed > 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-muted'}`}>
          Failed
        </div>
      </div>
    </div>

    {result.errors.length > 0 && (
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
        <h4 className="mb-2 font-medium text-red-700 dark:text-red-400">Errors</h4>
        <ul className="text-theme-text-muted space-y-1 text-sm">
          {result.errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      </div>
    )}

    <div className="pt-4">
      <button onClick={onReset} className="btn-primary px-6">
        Import Another File
      </button>
    </div>
  </div>
);

// ==================== Main Component ====================

const HistoricalImportPage: React.FC = () => {
  const [step, setStep] = useState(1);
  const [matchBy, setMatchBy] = useState<MatchStrategy>('membership_number');
  const [parseResult, setParseResult] = useState<HistoricalImportParseResponse | null>(null);
  const [courseMappings, setCourseMappings] = useState<CourseMappingEntry[]>([]);
  const [existingCourses, setExistingCourses] = useState<TrainingCourse[]>([]);
  const [importResult, setImportResult] = useState<HistoricalImportResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const handleParsed = useCallback(async (result: HistoricalImportParseResponse) => {
    setParseResult(result);

    // Initialize course mappings for unmatched courses (default: create_new)
    const initialMappings: CourseMappingEntry[] = result.unmatched_courses.map((uc) => ({
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
    setMatchBy('membership_number');
    setParseResult(null);
    setCourseMappings([]);
    setImportResult(null);
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h2 className="text-theme-text-primary flex items-center gap-2 text-xl font-bold">
          <FileText className="h-5 w-5" />
          Import Historical Training
        </h2>
        <p className="text-theme-text-muted mt-1 text-sm">
          Upload a CSV file to bulk-import past training records for your members.
        </p>
      </div>

      <StepIndicator currentStep={step} />

      {step === 1 && (
        <UploadStep
          onParsed={(result) => {
            void handleParsed(result);
          }}
          matchBy={matchBy}
          onMatchByChange={setMatchBy}
        />
      )}

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
          onConfirm={() => {
            void handleConfirm();
          }}
          onBack={() => (parseResult.unmatched_courses.length > 0 ? setStep(2) : setStep(1))}
          confirming={confirming}
        />
      )}

      {step === 4 && importResult && <ResultsStep result={importResult} onReset={handleReset} />}
    </div>
  );
};

export default HistoricalImportPage;
