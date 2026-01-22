import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  Edit,
  Trash2,
  Copy,
  ChevronDown,
  ChevronUp,
  Users,
  Calendar,
  Award,
  AlertCircle,
  CheckCircle,
  Search,
  Filter,
} from 'lucide-react';
import { AppLayout } from '../components/layout';
import toast from 'react-hot-toast';

interface TrainingRequirement {
  id: string;
  name: string;
  description: string;
  requirementType: 'hours' | 'courses' | 'certification';
  timeframe: 'calendar-year' | 'rolling-year' | 'certification-period' | 'custom';
  required_hours?: number;
  required_courses?: string[];
  frequency: 'annual' | 'biannual' | 'quarterly' | 'monthly' | 'one_time';
  applies_to_all: boolean;
  required_roles?: string[];
  required_teams?: string[];
  individual_assignments?: string[];
  start_date?: string;
  due_date?: string;
  active: boolean;
  source?: 'department' | 'state' | 'national';
  state?: string;
  registry?: string;
}

/**
 * Training Requirements Management Page
 *
 * Allows training officers to create, manage, and track training requirements.
 * Supports department, state, and national registry requirements.
 */
const TrainingRequirementsPage: React.FC = () => {
  const [requirements, setRequirements] = useState<TrainingRequirement[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [selectedRequirement, setSelectedRequirement] = useState<TrainingRequirement | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSource, setFilterSource] = useState<'all' | 'department' | 'state' | 'national'>('all');

  // Mock data - would come from API
  useEffect(() => {
    // Load requirements from API
    const mockRequirements: TrainingRequirement[] = [
      {
        id: '1',
        name: 'Annual Training Hours',
        description: 'Minimum training hours required per calendar year for all active members',
        requirementType: 'hours',
        timeframe: 'calendar-year',
        required_hours: 36,
        frequency: 'annual',
        applies_to_all: true,
        active: true,
        source: 'department',
        due_date: '2026-12-31',
      },
      {
        id: '2',
        name: 'State Firefighter Certification',
        description: 'State-mandated firefighter certification renewal',
        requirementType: 'certification',
        timeframe: 'certification-period',
        frequency: 'biannual',
        applies_to_all: false,
        required_roles: ['firefighter', 'officer'],
        active: true,
        source: 'state',
        state: 'California',
        registry: 'State Fire Marshal',
      },
      {
        id: '3',
        name: 'EMT Continuing Education',
        description: 'National Registry EMT continuing education requirements',
        requirementType: 'hours',
        timeframe: 'certification-period',
        required_hours: 24,
        frequency: 'biannual',
        applies_to_all: false,
        required_roles: ['emt-basic', 'emt-advanced', 'paramedic'],
        active: true,
        source: 'national',
        registry: 'NREMT',
      },
    ];
    setRequirements(mockRequirements);
  }, []);

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this requirement?')) {
      setRequirements(requirements.filter(r => r.id !== id));
      toast.success('Requirement deleted');
    }
  };

  const handleDuplicate = (requirement: TrainingRequirement) => {
    const duplicate = {
      ...requirement,
      id: `${Date.now()}`,
      name: `${requirement.name} (Copy)`,
    };
    setRequirements([...requirements, duplicate]);
    toast.success('Requirement duplicated');
  };

  const toggleActive = (id: string) => {
    setRequirements(requirements.map(r =>
      r.id === id ? { ...r, active: !r.active } : r
    ));
  };

  const filteredRequirements = requirements.filter(req => {
    const matchesSearch = req.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      req.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSource = filterSource === 'all' || req.source === filterSource;
    return matchesSearch && matchesSource;
  });

  return (
    <AppLayout>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center space-x-3">
              <FileText className="w-8 h-8 text-red-500" />
              <span>Training Requirements</span>
            </h1>
            <p className="text-slate-400 mt-1">
              Manage department, state, and national training requirements
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowTemplateModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <Copy className="w-5 h-5" />
              <span>Use Template</span>
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>Create Requirement</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search requirements..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Source Filter */}
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-slate-400" />
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as any)}
                className="px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              >
                <option value="all">All Sources</option>
                <option value="department">Department</option>
                <option value="state">State</option>
                <option value="national">National</option>
              </select>
            </div>
          </div>
        </div>

        {/* Requirements List */}
        <div className="space-y-4">
          {filteredRequirements.length === 0 ? (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
              <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-white text-xl font-semibold mb-2">No Requirements Found</h3>
              <p className="text-slate-400 mb-6">
                {searchTerm ? 'Try adjusting your search or filters' : 'Get started by creating your first training requirement'}
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
              >
                Create First Requirement
              </button>
            </div>
          ) : (
            filteredRequirements.map((requirement) => (
              <RequirementCard
                key={requirement.id}
                requirement={requirement}
                isExpanded={expandedId === requirement.id}
                onToggleExpand={() => setExpandedId(expandedId === requirement.id ? null : requirement.id)}
                onEdit={() => {
                  setSelectedRequirement(requirement);
                  setShowCreateModal(true);
                }}
                onDelete={() => handleDelete(requirement.id)}
                onDuplicate={() => handleDuplicate(requirement)}
                onToggleActive={() => toggleActive(requirement.id)}
              />
            ))
          )}
        </div>

        {/* Create/Edit Modal would go here */}
        {showCreateModal && (
          <RequirementModal
            requirement={selectedRequirement}
            onClose={() => {
              setShowCreateModal(false);
              setSelectedRequirement(null);
            }}
            onSave={(req) => {
              if (selectedRequirement) {
                setRequirements(requirements.map(r => r.id === req.id ? req : r));
                toast.success('Requirement updated');
              } else {
                setRequirements([...requirements, { ...req, id: `${Date.now()}` }]);
                toast.success('Requirement created');
              }
              setShowCreateModal(false);
              setSelectedRequirement(null);
            }}
          />
        )}

        {/* Template Modal */}
        {showTemplateModal && (
          <TemplateModal
            onClose={() => setShowTemplateModal(false)}
            onSelect={(template) => {
              setRequirements([...requirements, { ...template, id: `${Date.now()}` }]);
              toast.success(`Template "${template.name}" added`);
              setShowTemplateModal(false);
            }}
          />
        )}
      </main>
    </AppLayout>
  );
};

// Requirement Card Component
interface RequirementCardProps {
  requirement: TrainingRequirement;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleActive: () => void;
}

const RequirementCard: React.FC<RequirementCardProps> = ({
  requirement,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleActive,
}) => {
  const sourceColors = {
    department: 'bg-blue-600',
    state: 'bg-purple-600',
    national: 'bg-green-600',
  };

  const sourceColor = requirement.source ? sourceColors[requirement.source] : 'bg-gray-600';

  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h3 className="text-white text-lg font-bold">{requirement.name}</h3>
              <span className={`text-xs font-semibold px-2 py-1 rounded ${sourceColor} text-white uppercase`}>
                {requirement.source || 'Custom'}
              </span>
              {!requirement.active && (
                <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-600 text-white">
                  Inactive
                </span>
              )}
            </div>
            <p className="text-slate-400 text-sm mb-3">{requirement.description}</p>

            {/* Quick Info */}
            <div className="flex flex-wrap gap-3 text-sm">
              {requirement.requirementType === 'hours' && (
                <div className="flex items-center space-x-2 text-slate-300">
                  <Calendar className="w-4 h-4" />
                  <span>{requirement.required_hours} hours</span>
                </div>
              )}
              <div className="flex items-center space-x-2 text-slate-300">
                <Award className="w-4 h-4" />
                <span className="capitalize">{requirement.frequency}</span>
              </div>
              {requirement.applies_to_all ? (
                <div className="flex items-center space-x-2 text-slate-300">
                  <Users className="w-4 h-4" />
                  <span>All Members</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2 text-slate-300">
                  <Users className="w-4 h-4" />
                  <span>Specific Roles/Members</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-2 ml-4">
            <button
              onClick={onToggleActive}
              className={`p-2 rounded-lg transition-colors ${
                requirement.active
                  ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                  : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30'
              }`}
              title={requirement.active ? 'Active' : 'Inactive'}
            >
              {requirement.active ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            </button>
            <button
              onClick={onEdit}
              className="p-2 bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 rounded-lg transition-colors"
              title="Edit"
            >
              <Edit className="w-5 h-5" />
            </button>
            <button
              onClick={onDuplicate}
              className="p-2 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 rounded-lg transition-colors"
              title="Duplicate"
            >
              <Copy className="w-5 h-5" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg transition-colors"
              title="Delete"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <button
              onClick={onToggleExpand}
              className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="mt-6 pt-6 border-t border-white/10 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DetailSection title="Requirement Details">
                <DetailRow label="Type" value={requirement.requirementType} />
                <DetailRow label="Timeframe" value={requirement.timeframe} />
                <DetailRow label="Frequency" value={requirement.frequency} />
                {requirement.required_hours && (
                  <DetailRow label="Required Hours" value={`${requirement.required_hours} hours`} />
                )}
                {requirement.due_date && (
                  <DetailRow label="Due Date" value={requirement.due_date} />
                )}
              </DetailSection>

              <DetailSection title="Assignment">
                <DetailRow
                  label="Applies To"
                  value={requirement.applies_to_all ? 'All Members' : 'Specific Groups'}
                />
                {requirement.required_roles && requirement.required_roles.length > 0 && (
                  <DetailRow label="Roles" value={requirement.required_roles.join(', ')} />
                )}
                {requirement.required_teams && requirement.required_teams.length > 0 && (
                  <DetailRow label="Teams" value={requirement.required_teams.join(', ')} />
                )}
                {requirement.state && (
                  <DetailRow label="State" value={requirement.state} />
                )}
                {requirement.registry && (
                  <DetailRow label="Registry" value={requirement.registry} />
                )}
              </DetailSection>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const DetailSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="text-white font-semibold mb-3">{title}</h4>
    <div className="space-y-2">{children}</div>
  </div>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between">
    <span className="text-slate-400 text-sm">{label}:</span>
    <span className="text-white text-sm font-medium capitalize">{value}</span>
  </div>
);

// Placeholder modals
const RequirementModal: React.FC<{
  requirement: TrainingRequirement | null;
  onClose: () => void;
  onSave: (req: TrainingRequirement) => void;
}> = ({ requirement, onClose, onSave }) => {
  // This would be a full form - simplified for now
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg max-w-2xl w-full p-6">
        <h3 className="text-white text-xl font-bold mb-4">
          {requirement ? 'Edit Requirement' : 'Create Requirement'}
        </h3>
        <p className="text-slate-400 mb-6">
          Full requirement form would go here with all fields
        </p>
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(requirement || {} as TrainingRequirement)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

const TemplateModal: React.FC<{
  onClose: () => void;
  onSelect: (template: TrainingRequirement) => void;
}> = ({ onClose, onSelect }) => {
  const templates: TrainingRequirement[] = [
    {
      id: 'template-1',
      name: 'NFPA 1001 Annual Training',
      description: 'NFPA 1001 requires annual training for firefighters',
      requirementType: 'hours',
      timeframe: 'calendar-year',
      required_hours: 36,
      frequency: 'annual',
      applies_to_all: false,
      required_roles: ['firefighter'],
      active: true,
      source: 'national',
      registry: 'NFPA',
    },
    {
      id: 'template-2',
      name: 'NREMT EMT Recertification',
      description: 'National Registry EMT continuing education requirements',
      requirementType: 'hours',
      timeframe: 'certification-period',
      required_hours: 24,
      frequency: 'biannual',
      applies_to_all: false,
      required_roles: ['emt-basic'],
      active: true,
      source: 'national',
      registry: 'NREMT',
    },
    // More templates would be added
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg max-w-4xl w-full p-6 max-h-[80vh] overflow-y-auto">
        <h3 className="text-white text-xl font-bold mb-4">Select a Template</h3>
        <p className="text-slate-400 mb-6">
          Start with a pre-configured requirement template for common state and national standards
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 hover:bg-white/15 transition-colors text-left"
            >
              <h4 className="text-white font-semibold mb-2">{template.name}</h4>
              <p className="text-slate-400 text-sm mb-3">{template.description}</p>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold px-2 py-1 rounded bg-green-600 text-white uppercase">
                  {template.source}
                </span>
                <span className="text-slate-500 text-xs">{template.registry}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default TrainingRequirementsPage;
