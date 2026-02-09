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
import { AppLayout } from '../components/layout';
import { trainingProgramService } from '../services/api';
import type {
  TrainingProgram,
  TrainingRequirementEnhanced,
  ProgramStructureType,
} from '../types/training';

type TabView = 'programs' | 'requirements' | 'templates';

interface CreateProgramModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateProgramModal: React.FC<CreateProgramModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    target_position: '',
    structure_type: 'flexible' as ProgramStructureType,
    time_limit_days: '',
    warning_days_before: '30',
    is_template: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      await trainingProgramService.createProgram({
        name: formData.name,
        description: formData.description || undefined,
        target_position: formData.target_position || undefined,
        structure_type: formData.structure_type,
        time_limit_days: formData.time_limit_days ? parseInt(formData.time_limit_days) : undefined,
        warning_days_before: parseInt(formData.warning_days_before),
        is_template: formData.is_template,
      });

      onSuccess();
      onClose();
      setFormData({
        name: '',
        description: '',
        target_position: '',
        structure_type: 'flexible',
        time_limit_days: '',
        warning_days_before: '30',
        is_template: false,
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create program');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-2xl font-bold text-white">Create Training Program</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Program Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Target Position
              </label>
              <select
                value={formData.target_position}
                onChange={(e) => setFormData({ ...formData, target_position: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="">All Positions</option>
                <option value="probationary">Probationary</option>
                <option value="firefighter">Firefighter</option>
                <option value="driver_candidate">Driver Candidate</option>
                <option value="driver">Driver</option>
                <option value="officer">Officer</option>
                <option value="aic">AIC (Attendant in Charge)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Structure Type
              </label>
              <select
                value={formData.structure_type}
                onChange={(e) => setFormData({ ...formData, structure_type: e.target.value as ProgramStructureType })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="flexible">Flexible</option>
                <option value="sequential">Sequential</option>
                <option value="phases">Phases</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Time Limit (days)
              </label>
              <input
                type="number"
                value={formData.time_limit_days}
                onChange={(e) => setFormData({ ...formData, time_limit_days: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Warning (days before)
              </label>
              <input
                type="number"
                value={formData.warning_days_before}
                onChange={(e) => setFormData({ ...formData, warning_days_before: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="is_template"
              checked={formData.is_template}
              onChange={(e) => setFormData({ ...formData, is_template: e.target.checked })}
              className="w-4 h-4 text-red-500 bg-gray-700 border-gray-600 rounded focus:ring-red-500"
            />
            <label htmlFor="is_template" className="text-sm text-gray-300">
              Save as template (can be reused for other positions)
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Program'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TrainingProgramsPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabView>('programs');
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [requirements, setRequirements] = useState<TrainingRequirementEnhanced[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
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
    } catch (error) {
      console.error('Failed to load data:', error);
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
    } catch (error: any) {
      toast.error(`Failed to import registry: ${error.response?.data?.detail || error.message}`);
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
    <AppLayout>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center space-x-3">
              <GraduationCap className="w-8 h-8 text-red-500" />
              <span>Training Programs</span>
            </h1>
            <p className="text-gray-400 mt-2">
              Manage training programs, requirements, and member progress
            </p>
          </div>

          {activeTab === 'programs' && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              <Plus className="w-5 h-5" />
              <span>New Program</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-gray-800 p-1 rounded-lg mb-6">
          <button
            onClick={() => setActiveTab('programs')}
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'programs'
                ? 'bg-red-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Target className="w-4 h-4 inline mr-2" />
            Programs
          </button>
          <button
            onClick={() => setActiveTab('requirements')}
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'requirements'
                ? 'bg-red-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <ListChecks className="w-4 h-4 inline mr-2" />
            Requirements
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'templates'
                ? 'bg-red-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Award className="w-4 h-4 inline mr-2" />
            Templates
          </button>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={`Search ${activeTab}...`}
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
            <p className="text-gray-400 mt-4">Loading {activeTab}...</p>
          </div>
        ) : (
          <>
            {activeTab === 'programs' || activeTab === 'templates' ? (
              <div className="grid gap-4">
                {filteredPrograms.length === 0 ? (
                  <div className="text-center py-12 bg-gray-800 rounded-lg">
                    <GraduationCap className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-400">
                      {searchTerm ? 'No programs found' : `No ${activeTab} yet`}
                    </p>
                    {!searchTerm && activeTab === 'programs' && (
                      <button
                        onClick={() => setShowCreateModal(true)}
                        className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                      >
                        Create Your First Program
                      </button>
                    )}
                  </div>
                ) : (
                  filteredPrograms.map((program) => (
                    <div
                      key={program.id}
                      className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 cursor-pointer transition-colors"
                      onClick={() => navigate(`/training/programs/${program.id}`)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-xl font-semibold text-white">{program.name}</h3>
                            {program.target_position && (
                              <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                                {program.target_position}
                              </span>
                            )}
                            <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                              {program.structure_type}
                            </span>
                          </div>
                          {program.description && (
                            <p className="text-gray-400 mb-3">{program.description}</p>
                          )}
                          <div className="flex items-center space-x-6 text-sm text-gray-400">
                            {program.time_limit_days && (
                              <div className="flex items-center space-x-1">
                                <Calendar className="w-4 h-4" />
                                <span>{program.time_limit_days} days</span>
                              </div>
                            )}
                            <div className="flex items-center space-x-1">
                              <Users className="w-4 h-4" />
                              <span>0 enrolled</span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <>
                {/* Registry Import Section */}
                <div className="bg-gray-800 rounded-lg p-6 mb-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Import from Registry</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {['nfpa', 'nremt', 'proboard'].map((registry) => (
                      <button
                        key={registry}
                        onClick={() => handleImportRegistry(registry)}
                        disabled={importingRegistry !== null}
                        className="flex items-center justify-center space-x-2 px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50"
                      >
                        <Download className="w-5 h-5" />
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
                    <div className="text-center py-12 bg-gray-800 rounded-lg">
                      <ListChecks className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-400">
                        {searchTerm ? 'No requirements found' : 'No requirements yet'}
                      </p>
                      <p className="text-gray-500 mt-2 text-sm">
                        Import from a registry or create custom requirements
                      </p>
                    </div>
                  ) : (
                    filteredRequirements.map((req) => (
                      <div
                        key={req.id}
                        className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <h3 className="text-lg font-semibold text-white">{req.name}</h3>
                              <span className={`px-2 py-1 text-xs rounded ${
                                req.source === 'national' ? 'bg-blue-500/20 text-blue-400' :
                                req.source === 'state' ? 'bg-green-500/20 text-green-400' :
                                'bg-gray-500/20 text-gray-400'
                              }`}>
                                {req.source}
                              </span>
                              {req.registry_name && (
                                <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded">
                                  {req.registry_name}
                                </span>
                              )}
                              <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded">
                                {req.requirement_type}
                              </span>
                            </div>
                            {req.description && (
                              <p className="text-gray-400 text-sm mb-2">{req.description}</p>
                            )}
                            <div className="flex items-center space-x-4 text-sm text-gray-400">
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
                            <div title="Registry requirement (read-only)">
                              <AlertCircle className="w-5 h-5 text-yellow-500" />
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>

      <CreateProgramModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={loadData}
      />
    </AppLayout>
  );
};

export default TrainingProgramsPage;
