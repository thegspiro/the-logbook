import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  GraduationCap,
  Plus,
  Users,
  ListChecks,
  Target,
  Download,
  Search,
  ChevronRight,
  Award,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { trainingProgramService } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';
import type {
  TrainingProgram,
  TrainingRequirementEnhanced,
} from '../types/training';

type TabView = 'programs' | 'requirements' | 'templates';

const TrainingProgramsPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabView>('programs');
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirementEnhanced[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [importingRegistry, setImportingRegistry] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'programs' || activeTab === 'templates') {
        const data = await trainingProgramService.getPrograms({
          is_template: activeTab === 'templates',
        });
        setPrograms(data);
      } else if (activeTab === 'requirements') {
        const data = await trainingProgramService.getRequirementsEnhanced();
        setRequirements(data);
      }
    } catch (_error) {
      // Error silently handled - empty state shown
    } finally {
      setLoading(false);
    }
  };

  const handleImportRegistry = async (registryName: string) => {
    setImportingRegistry(registryName);
    try {
      const result = await trainingProgramService.importRegistry(registryName);
      toast.success(`Successfully imported ${result.imported_count} requirements from ${result.registry_name}`);
      loadData();
    } catch (error: unknown) {
      toast.error(`Failed to import registry: ${getErrorMessage(error)}`);
    } finally {
      setImportingRegistry(null);
    }
  };

  const filteredPrograms = programs.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredRequirements = requirements.filter((r) =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
              <GraduationCap className="w-8 h-8 text-red-700 dark:text-red-500" aria-hidden="true" />
              <span>Training Programs</span>
            </h1>
            <p className="text-theme-text-muted mt-2">
              Manage training programs, requirements, and member progress
            </p>
          </div>

          {activeTab === 'programs' && (
            <button
              onClick={() => navigate('/training/programs/new')}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              <Plus className="w-5 h-5" aria-hidden="true" />
              <span>New Pipeline</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-theme-surface-secondary p-1 rounded-lg mb-6" role="tablist" aria-label="Training program views">
          <button
            onClick={() => setActiveTab('programs')}
            role="tab"
            aria-selected={activeTab === 'programs'}
            aria-controls="tab-panel-programs"
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'programs'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Target className="w-4 h-4 inline mr-2" aria-hidden="true" />
            Programs
          </button>
          <button
            onClick={() => setActiveTab('requirements')}
            role="tab"
            aria-selected={activeTab === 'requirements'}
            aria-controls="tab-panel-requirements"
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'requirements'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <ListChecks className="w-4 h-4 inline mr-2" aria-hidden="true" />
            Requirements
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            role="tab"
            aria-selected={activeTab === 'templates'}
            aria-controls="tab-panel-templates"
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'templates'
                ? 'bg-red-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            <Award className="w-4 h-4 inline mr-2" aria-hidden="true" />
            Templates
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
            <label htmlFor="programs-search" className="sr-only">Search {activeTab}</label>
            <input
              id="programs-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12" role="status" aria-live="polite">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500" aria-hidden="true"></div>
            <p className="text-theme-text-muted mt-4">Loading {activeTab}...</p>
          </div>
        ) : (
          <>
            {activeTab === 'programs' || activeTab === 'templates' ? (
              <div className="grid gap-4" id="tab-panel-programs" role="tabpanel">
                {filteredPrograms.length === 0 ? (
                  <div className="text-center py-12 bg-theme-surface-secondary rounded-lg">
                    <GraduationCap className="w-16 h-16 text-theme-text-secondary mx-auto mb-4" aria-hidden="true" />
                    <p className="text-theme-text-muted">
                      {searchTerm ? 'No programs found' : `No ${activeTab} yet`}
                    </p>
                    {!searchTerm && activeTab === 'programs' && (
                      <button
                        onClick={() => navigate('/training/programs/new')}
                        className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        Create Your First Pipeline
                      </button>
                    )}
                  </div>
                ) : (
                  filteredPrograms.map((program) => (
                    <div
                      key={program.id}
                      className="bg-theme-surface-secondary rounded-lg p-6 hover:bg-theme-surface-hover cursor-pointer transition-colors"
                      onClick={() => navigate(`/training/programs/${program.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/training/programs/${program.id}`); } }}
                      tabIndex={0}
                      role="link"
                      aria-label={`${program.name}${program.target_position ? ` - ${program.target_position}` : ''} - ${program.structure_type}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-xl font-semibold text-theme-text-primary">{program.name}</h3>
                            {program.target_position && (
                              <span className="px-2 py-1 bg-red-500/20 text-red-700 dark:text-red-400 text-xs rounded">
                                {program.target_position}
                              </span>
                            )}
                            <span className="px-2 py-1 bg-blue-500/20 text-blue-700 dark:text-blue-400 text-xs rounded">
                              {program.structure_type}
                            </span>
                          </div>
                          {program.description && (
                            <p className="text-theme-text-muted mb-3">{program.description}</p>
                          )}
                          <div className="flex items-center space-x-6 text-sm text-theme-text-muted">
                            {program.time_limit_days && (
                              <div className="flex items-center space-x-1">
                                <Calendar className="w-4 h-4" aria-hidden="true" />
                                <span>{program.time_limit_days} days</span>
                              </div>
                            )}
                            <div className="flex items-center space-x-1">
                              <Users className="w-4 h-4" aria-hidden="true" />
                              <span>0 enrolled</span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div id="tab-panel-requirements" role="tabpanel">
                {/* Registry Import Section */}
                <div className="bg-theme-surface-secondary rounded-lg p-6 mb-6">
                  <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Import from Registry</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {['nfpa', 'nremt', 'proboard'].map((registry) => (
                      <button
                        key={registry}
                        onClick={() => handleImportRegistry(registry)}
                        disabled={importingRegistry !== null}
                        className="flex items-center justify-center space-x-2 px-4 py-3 bg-theme-surface text-theme-text-primary rounded-lg hover:bg-theme-surface-hover disabled:opacity-50"
                      >
                        <Download className="w-5 h-5" aria-hidden="true" />
                        <span>
                          {importingRegistry === registry ? 'Importing...' : `Import ${registry.toUpperCase()}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Requirements List */}
                <div className="grid gap-4">
                  {filteredRequirements.length === 0 ? (
                    <div className="text-center py-12 bg-theme-surface-secondary rounded-lg">
                      <ListChecks className="w-16 h-16 text-theme-text-secondary mx-auto mb-4" aria-hidden="true" />
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
                        className="bg-theme-surface-secondary rounded-lg p-6 hover:bg-theme-surface-hover transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <h3 className="text-lg font-semibold text-theme-text-primary">{req.name}</h3>
                              <span className={`px-2 py-1 text-xs rounded ${
                                req.source === 'national' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                                req.source === 'state' ? 'bg-green-500/20 text-green-700 dark:text-green-400' :
                                'bg-theme-surface-secondary text-theme-text-muted'
                              }`}>
                                {req.source}
                              </span>
                              {req.registry_name && (
                                <span className="px-2 py-1 bg-purple-500/20 text-purple-700 dark:text-purple-400 text-xs rounded">
                                  {req.registry_name}
                                </span>
                              )}
                              <span className="px-2 py-1 bg-orange-500/20 text-orange-700 dark:text-orange-400 text-xs rounded">
                                {req.requirement_type}
                              </span>
                            </div>
                            {req.description && (
                              <p className="text-theme-text-muted text-sm mb-2">{req.description}</p>
                            )}
                            <div className="flex items-center space-x-4 text-sm text-theme-text-muted">
                              {req.required_hours && (
                                <span>{req.required_hours} hours</span>
                              )}
                              {req.required_shifts && (
                                <span>{req.required_shifts} shifts</span>
                              )}
                              {req.required_calls && (
                                <span>{req.required_calls} calls</span>
                              )}
                              <span>{req.frequency}</span>
                            </div>
                          </div>
                          {!req.is_editable && (
                            <div aria-label="Registry requirement (read-only)">
                              <AlertCircle className="w-5 h-5 text-yellow-700 dark:text-yellow-500" aria-hidden="true" />
                            </div>
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

    </div>
  );
};

export default TrainingProgramsPage;
