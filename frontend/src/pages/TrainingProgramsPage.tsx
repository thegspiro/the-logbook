import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import {
  GraduationCap,
  Plus,
  Users,
  ListChecks,
  Target,
  Download,
  Upload,
  Search,
  ChevronRight,
  Award,
  Calendar,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Layers,
  Loader2,
  Edit,
} from 'lucide-react';
import { trainingProgramService, trainingService } from '../services/api';
import RegistryImportModal from './RegistryImportModal';
import { RequirementModal } from '../components/training/RequirementModal';
import { getErrorMessage } from '@/utils/errorHandling';
import { enumLabel } from '@/utils/displayValue';
import type {
  TrainingProgram,
  TrainingRequirementEnhanced,
  TrainingRequirementCreate,
  TrainingRequirementUpdate,
  TrainingCategory,
  RegistryInfo,
  SampleTemplateSummary,
} from '../types/training';

type TabView = 'programs' | 'requirements' | 'templates';

const TrainingProgramsPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabView>('programs');
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirementEnhanced[]>([]);
  const [registries, setRegistries] = useState<RegistryInfo[]>([]);
  const [sampleTemplates, setSampleTemplates] = useState<SampleTemplateSummary[]>([]);
  const [instantiatingKey, setInstantiatingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [registryModal, setRegistryModal] = useState<{ key: string; name: string } | null>(null);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [showRequirementModal, setShowRequirementModal] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<TrainingRequirementEnhanced | null>(null);
  const importFileRef = React.useRef<HTMLInputElement>(null);

  const handleExportProgram = async (e: React.MouseEvent, programId: string, programName: string) => {
    e.stopPropagation();
    try {
      const data = await trainingProgramService.exportProgram(programId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${programName.replace(/[^a-zA-Z0-9]/g, '_')}_pipeline.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Program exported');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Export failed'));
    }
  };

  const handleImportProgram = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      const result = await trainingProgramService.importProgram(data);
      toast.success(result.message);
      void loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Import failed'));
    } finally {
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'programs' || activeTab === 'templates') {
        const data = await trainingProgramService.getPrograms({
          is_template: activeTab === 'templates',
        });
        setPrograms(data);
        if (activeTab === 'templates') {
          // Built-in starter templates for the gallery; failure is non-fatal.
          try {
            setSampleTemplates(await trainingProgramService.getSampleTemplates());
          } catch {
            setSampleTemplates([]);
          }
        }
      } else if (activeTab === 'requirements') {
        const [reqs, regs, cats] = await Promise.all([
          trainingProgramService.getRequirementsEnhanced(),
          trainingProgramService.getRegistries(),
          // Categories feed the edit form's category picker; a failure there
          // must not blank the requirements list, so it degrades to empty.
          trainingService.getCategories(false).catch(() => [] as TrainingCategory[]),
        ]);
        setRequirements(reqs);
        setRegistries(regs);
        setCategories(cats);
      }
    } catch (_error) {
      // Error silently handled - empty state shown
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSaveRequirement = async (
    data: TrainingRequirementCreate | TrainingRequirementUpdate,
    isEdit: boolean,
    id?: string
  ) => {
    try {
      if (isEdit && id) {
        const updated = await trainingService.updateRequirement(id, data);
        setRequirements((prev) => prev.map((r) => (r.id === id ? updated : r)));
        toast.success('Requirement updated');
      } else {
        const created = await trainingService.createRequirement(data as TrainingRequirementCreate);
        setRequirements((prev) => [...prev, created]);
        toast.success('Requirement created');
      }
      setShowRequirementModal(false);
      setEditingRequirement(null);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save requirement'));
    }
  };

  const handleAddSampleTemplate = async (template: SampleTemplateSummary) => {
    setInstantiatingKey(template.key);
    try {
      const program = await trainingProgramService.instantiateSampleTemplate(template.key);
      toast.success(`Added "${program.name}" to your templates`);
      void navigate(`/training/programs/${program.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add template'));
    } finally {
      setInstantiatingKey(null);
    }
  };

  const filteredPrograms = programs.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredRequirements = requirements.filter(
    (r) =>
      r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-theme-text-primary flex items-center space-x-3 text-2xl font-bold sm:text-3xl">
              <GraduationCap className="h-8 w-8 shrink-0 text-red-700 dark:text-red-500" aria-hidden="true" />
              <span>Training Programs</span>
            </h1>
            <p className="text-theme-text-muted mt-2">Manage training programs, requirements, and member progress</p>
          </div>

          {activeTab === 'programs' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                onChange={(e) => {
                  void handleImportProgram(e);
                }}
                className="hidden"
                aria-label="Import pipeline JSON file"
              />
              <button
                onClick={() => importFileRef.current?.click()}
                className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors max-md:min-h-[44px]"
              >
                <Upload className="h-5 w-5" aria-hidden="true" />
                <span>Import</span>
              </button>
              <button
                onClick={() => void navigate('/training/programs/new')}
                className="btn-primary flex items-center space-x-2"
              >
                <Plus className="h-5 w-5" aria-hidden="true" />
                <span>New Pipeline</span>
              </button>
            </div>
          )}

          {activeTab === 'requirements' && (
            <button
              onClick={() => {
                setEditingRequirement(null);
                setShowRequirementModal(true);
              }}
              className="btn-primary flex items-center space-x-2"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              <span>New Requirement</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <div
          className="bg-theme-surface-secondary hscroll mb-6 flex space-x-1 rounded-lg p-1"
          role="tablist"
          aria-label="Training program views"
        >
          <button
            onClick={() => setActiveTab('programs')}
            role="tab"
            aria-selected={activeTab === 'programs'}
            aria-controls="tab-panel-programs"
            className={`flex-1 rounded-md px-4 py-2 font-medium transition-colors ${
              activeTab === 'programs'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Target className="mr-2 inline h-4 w-4" aria-hidden="true" />
            Programs
          </button>
          <button
            onClick={() => setActiveTab('requirements')}
            role="tab"
            aria-selected={activeTab === 'requirements'}
            aria-controls="tab-panel-requirements"
            className={`flex-1 rounded-md px-4 py-2 font-medium transition-colors ${
              activeTab === 'requirements'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <ListChecks className="mr-2 inline h-4 w-4" aria-hidden="true" />
            Requirements
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            role="tab"
            aria-selected={activeTab === 'templates'}
            aria-controls="tab-panel-templates"
            className={`flex-1 rounded-md px-4 py-2 font-medium transition-colors ${
              activeTab === 'templates'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Award className="mr-2 inline h-4 w-4" aria-hidden="true" />
            Templates
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Search
              className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
              aria-hidden="true"
            />
            <label htmlFor="programs-search" className="sr-only">
              Search {activeTab}
            </label>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              id="programs-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="form-input pr-4 pl-10"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-12 text-center" role="status" aria-live="polite">
            <div
              className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-red-500"
              aria-hidden="true"
            ></div>
            <p className="text-theme-text-muted mt-4">Loading {activeTab}...</p>
          </div>
        ) : (
          <>
            {activeTab === 'programs' || activeTab === 'templates' ? (
              <div id="tab-panel-programs" role="tabpanel">
                {activeTab === 'templates' && !searchTerm && sampleTemplates.length > 0 && (
                  <section className="mb-8" aria-label="Sample templates">
                    <div className="mb-1 flex items-center space-x-2">
                      <Sparkles className="h-5 w-5 text-red-700 dark:text-red-500" aria-hidden="true" />
                      <h2 className="text-theme-text-primary text-lg font-semibold">Start from a sample template</h2>
                    </div>
                    <p className="text-theme-text-muted mb-4 text-sm">
                      Real-world starting points you can add to your department, then edit and enroll members.
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {sampleTemplates.map((template) => (
                        <div
                          key={template.key}
                          className="bg-theme-surface-secondary border-theme-surface-border flex flex-col rounded-lg border p-5"
                        >
                          <h3 className="text-theme-text-primary mb-1 text-base font-semibold">{template.name}</h3>
                          {template.description && (
                            <p className="text-theme-text-muted mb-3 line-clamp-4 text-sm">{template.description}</p>
                          )}
                          <div className="text-theme-text-muted mt-auto mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            <span className="flex items-center space-x-1">
                              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{template.phase_count} phases</span>
                            </span>
                            <span className="flex items-center space-x-1">
                              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{template.requirement_count} requirements</span>
                            </span>
                            {template.time_limit_days && (
                              <span className="flex items-center space-x-1">
                                <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{template.time_limit_days} days</span>
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              void handleAddSampleTemplate(template);
                            }}
                            disabled={instantiatingKey !== null}
                            className="btn-primary flex items-center justify-center space-x-2 disabled:opacity-50"
                            aria-label={`Add ${template.name} to my department`}
                          >
                            {instantiatingKey === template.key ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Plus className="h-4 w-4" aria-hidden="true" />
                            )}
                            <span>Add to my department</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <div className="grid gap-4">
                  {filteredPrograms.length === 0 ? (
                    <div className="bg-theme-surface-secondary rounded-lg py-12 text-center">
                      <GraduationCap className="text-theme-text-secondary mx-auto mb-4 h-16 w-16" aria-hidden="true" />
                      <p className="text-theme-text-muted">
                        {searchTerm ? 'No programs found' : `No ${activeTab} yet`}
                      </p>
                      {!searchTerm && activeTab === 'programs' && (
                        <button onClick={() => void navigate('/training/programs/new')} className="btn-primary mt-4">
                          Create Your First Pipeline
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredPrograms.map((program) => (
                      <div
                        key={program.id}
                        className="bg-theme-surface-secondary hover:bg-theme-surface-hover cursor-pointer rounded-lg p-6 transition-colors"
                        onClick={() => void navigate(`/training/programs/${program.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void navigate(`/training/programs/${program.id}`);
                          }
                        }}
                        tabIndex={0}
                        role="link"
                        aria-label={`${program.name}${program.target_position ? ` - ${program.target_position}` : ''} - ${program.structure_type}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <h3 className="text-theme-text-primary text-xl font-semibold">{program.name}</h3>
                              {program.target_position && (
                                <span className="rounded-sm bg-red-500/20 px-2 py-1 text-xs text-red-700 dark:text-red-400">
                                  {program.target_position}
                                </span>
                              )}
                              <span className="rounded-sm bg-blue-500/20 px-2 py-1 text-xs text-blue-700 dark:text-blue-400">
                                {enumLabel(program.structure_type)}
                              </span>
                            </div>
                            {program.description && <p className="text-theme-text-muted mb-3">{program.description}</p>}
                            <div className="text-theme-text-muted flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                              {program.time_limit_days && (
                                <div className="flex items-center space-x-1">
                                  <Calendar className="h-4 w-4" aria-hidden="true" />
                                  <span>{program.time_limit_days} days</span>
                                </div>
                              )}
                              <div className="flex items-center space-x-1">
                                <Users className="h-4 w-4" aria-hidden="true" />
                                <span>{program.enrolled_count} enrolled</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={(e) => {
                                void handleExportProgram(e, program.id, program.name);
                              }}
                              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface rounded-lg p-2 transition-colors"
                              title="Export as JSON"
                              aria-label={`Export ${program.name}`}
                            >
                              <Download className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <ChevronRight className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div id="tab-panel-requirements" role="tabpanel">
                {/* Registry Import Section */}
                <div className="bg-theme-surface-secondary mb-6 rounded-lg p-6">
                  <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Import from Registry</h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {(registries.length > 0
                      ? registries
                      : [
                          { key: 'nfpa', name: 'NFPA', description: '', requirement_count: 0 },
                          { key: 'proboard', name: 'Pro Board', description: '', requirement_count: 0 },
                          { key: 'emr', name: 'NREMT — EMR', description: '', requirement_count: 0 },
                          { key: 'emt', name: 'NREMT — EMT', description: '', requirement_count: 0 },
                          { key: 'aemt', name: 'NREMT — Advanced EMT (AEMT)', description: '', requirement_count: 0 },
                          { key: 'paramedic', name: 'NREMT — Paramedic', description: '', requirement_count: 0 },
                        ]
                    ).map((registry) => (
                      <button
                        key={registry.key}
                        onClick={() => setRegistryModal({ key: registry.key, name: registry.name })}
                        className="bg-theme-surface text-theme-text-primary hover:bg-theme-surface-hover flex flex-col items-center rounded-lg px-4 py-3"
                      >
                        <div className="flex items-center space-x-2">
                          <Download className="h-5 w-5" aria-hidden="true" />
                          <span>Import {registry.name}</span>
                        </div>
                        {registry.last_updated && (
                          <span className="text-theme-text-muted mt-1 text-xs">Updated {registry.last_updated}</span>
                        )}
                        {registry.requirement_count > 0 && (
                          <span className="text-theme-text-muted text-xs">
                            {registry.requirement_count} requirements
                          </span>
                        )}
                        {registry.source_url && (
                          <a
                            href={registry.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 flex items-center space-x-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            <span>Source</span>
                          </a>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Requirements List */}
                <div className="grid gap-4">
                  {filteredRequirements.length === 0 ? (
                    <div className="bg-theme-surface-secondary rounded-lg py-12 text-center">
                      <ListChecks className="text-theme-text-secondary mx-auto mb-4 h-16 w-16" aria-hidden="true" />
                      <p className="text-theme-text-muted">
                        {searchTerm ? 'No requirements found' : 'No requirements yet'}
                      </p>
                      <p className="text-theme-text-muted mt-2 text-sm">
                        Import from a registry or create custom requirements
                      </p>
                    </div>
                  ) : (
                    filteredRequirements.map((req) => (
                      <div
                        key={req.id}
                        className="bg-theme-surface-secondary hover:bg-theme-surface-hover rounded-lg p-6 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <h3 className="text-theme-text-primary text-lg font-semibold">{req.name}</h3>
                              <span
                                className={`rounded px-2 py-1 text-xs ${
                                  req.source === 'national'
                                    ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                                    : req.source === 'state'
                                      ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                                      : 'bg-theme-surface-secondary text-theme-text-muted'
                                }`}
                              >
                                {req.source}
                              </span>
                              {req.registry_name && (
                                <span className="rounded-sm bg-purple-500/20 px-2 py-1 text-xs text-purple-700 dark:text-purple-400">
                                  {req.registry_name}
                                </span>
                              )}
                              <span className="rounded-sm bg-orange-500/20 px-2 py-1 text-xs text-orange-700 dark:text-orange-400">
                                {req.requirement_type}
                              </span>
                            </div>
                            {req.description && <p className="text-theme-text-muted mb-2 text-sm">{req.description}</p>}
                            <div className="text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                              {req.required_hours && <span>{req.required_hours} hours</span>}
                              {req.required_shifts && <span>{req.required_shifts} shifts</span>}
                              {req.required_calls && <span>{req.required_calls} calls</span>}
                              <span>{req.frequency}</span>
                            </div>
                          </div>
                          {/* Registry-imported requirements are locked upstream
                              (the backend refuses to update them), so the edit
                              affordance is replaced by the read-only marker
                              rather than shown and failing on save. */}
                          {req.is_editable === false ? (
                            <div aria-label="Registry requirement (read-only)">
                              <AlertCircle
                                className="h-5 w-5 text-yellow-700 dark:text-yellow-500"
                                aria-hidden="true"
                              />
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingRequirement(req);
                                setShowRequirementModal(true);
                              }}
                              className="ml-4 rounded-lg bg-blue-600/20 p-2 text-blue-700 transition-colors hover:bg-blue-600/30 dark:text-blue-400"
                              title="Edit"
                              aria-label={`Edit ${req.name}`}
                            >
                              <Edit className="h-5 w-5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {registryModal && (
        <RegistryImportModal
          registryKey={registryModal.key}
          registryName={registryModal.name}
          onClose={() => setRegistryModal(null)}
          onImported={() => {
            void loadData();
          }}
        />
      )}

      {showRequirementModal && (
        <RequirementModal
          requirement={editingRequirement}
          categories={categories}
          onClose={() => {
            setShowRequirementModal(false);
            setEditingRequirement(null);
          }}
          onSave={(...args) => {
            void handleSaveRequirement(...args);
          }}
        />
      )}
    </div>
  );
};

export default TrainingProgramsPage;
