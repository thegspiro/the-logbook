import React, { useState } from 'react';
import {
  FormInput,
  Plus,
  FileCheck,
  Search,
  Filter,
  Copy,
  Eye,
  FileText,
  AlertTriangle,
  Clipboard,
  X,
  AlertCircle,
  ClipboardCheck,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

interface FormTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  fields: number;
  icon: React.ReactNode;
  color: string;
}

const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'incident-report',
    name: 'Incident Report',
    description: 'Standard incident/accident report form with injury details and witnesses',
    category: 'Safety',
    fields: 15,
    icon: <AlertTriangle className="w-6 h-6" />,
    color: 'text-red-400',
  },
  {
    id: 'equipment-inspection',
    name: 'Equipment Inspection',
    description: 'Pre-use and periodic equipment inspection checklist',
    category: 'Operations',
    fields: 12,
    icon: <ClipboardCheck className="w-6 h-6" />,
    color: 'text-emerald-400',
  },
  {
    id: 'vehicle-check',
    name: 'Apparatus Check-off',
    description: 'Daily apparatus/vehicle check-off form',
    category: 'Operations',
    fields: 20,
    icon: <Clipboard className="w-6 h-6" />,
    color: 'text-blue-400',
  },
  {
    id: 'member-feedback',
    name: 'Member Feedback Survey',
    description: 'Anonymous feedback survey for department improvement',
    category: 'Administration',
    fields: 10,
    icon: <FileText className="w-6 h-6" />,
    color: 'text-purple-400',
  },
];

type FormCategory = 'all' | 'Safety' | 'Operations' | 'Administration' | 'Training';

const FormsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('forms.manage');

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FormCategory>('all');
  const [activeTab, setActiveTab] = useState<'templates' | 'submissions'>('templates');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'Operations',
  });

  const filteredTemplates = FORM_TEMPLATES.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-pink-600 rounded-lg p-2">
              <FormInput className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Custom Forms</h1>
              <p className="text-slate-400 text-sm">
                Create custom forms for incident reports, surveys, feedback, and more
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Form</span>
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-white/5 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('templates')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'templates' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Form Templates
          </button>
          <button
            onClick={() => setActiveTab('submissions')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'submissions' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Submissions
          </button>
        </div>

        {/* Search & Filters */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search forms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Filter className="w-5 h-5 text-slate-400" />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as FormCategory)}
                className="px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
              >
                <option value="all">All Categories</option>
                <option value="Safety">Safety</option>
                <option value="Operations">Operations</option>
                <option value="Administration">Administration</option>
                <option value="Training">Training</option>
              </select>
            </div>
          </div>
        </div>

        {activeTab === 'templates' && (
          <>
            {/* Starter Templates */}
            <div className="mb-8">
              <h2 className="text-white text-lg font-semibold mb-4">Starter Templates</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTemplates.map((template) => (
                  <div key={template.id} className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 hover:border-pink-500/30 transition-all">
                    <div className="flex items-start space-x-4">
                      <div className={`p-3 rounded-lg bg-white/5 ${template.color}`}>
                        {template.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <h3 className="text-white font-semibold">{template.name}</h3>
                          <span className="px-2 py-0.5 text-xs bg-pink-500/10 text-pink-400 rounded border border-pink-500/30">
                            {template.category}
                          </span>
                        </div>
                        <p className="text-slate-300 text-sm mt-1">{template.description}</p>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-slate-400 text-xs">{template.fields} fields</span>
                          <div className="flex space-x-2">
                            <button className="px-3 py-1 text-xs bg-white/5 text-slate-300 hover:bg-white/10 rounded transition-colors flex items-center space-x-1">
                              <Eye className="w-3 h-3" />
                              <span>Preview</span>
                            </button>
                            {canManage && (
                              <button className="px-3 py-1 text-xs bg-pink-600/20 text-pink-400 hover:bg-pink-600/30 rounded transition-colors flex items-center space-x-1">
                                <Copy className="w-3 h-3" />
                                <span>Use Template</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Forms - Empty State */}
            <div className="mb-4">
              <h2 className="text-white text-lg font-semibold mb-4">Your Custom Forms</h2>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
              <FormInput className="w-16 h-16 text-slate-500 mx-auto mb-4" />
              <h3 className="text-white text-xl font-bold mb-2">No Custom Forms</h3>
              <p className="text-slate-300 mb-6">
                Create a custom form from scratch or start from a template above.
              </p>
              {canManage && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-6 py-3 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Create Custom Form</span>
                </button>
              )}
            </div>
          </>
        )}

        {activeTab === 'submissions' && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
            <FileCheck className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-white text-xl font-bold mb-2">No Submissions</h3>
            <p className="text-slate-300 mb-6">
              Form submissions will appear here once members start filling out forms.
            </p>
          </div>
        )}

        {/* Create Form Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateModal(false)} />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-white">Create New Form</h3>
                    <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Form Name *</label>
                      <input
                        type="text" value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="e.g., Monthly Safety Report"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Category</label>
                      <select
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                      >
                        <option value="Safety">Safety</option>
                        <option value="Operations">Operations</option>
                        <option value="Administration">Administration</option>
                        <option value="Training">Training</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea
                        rows={3} value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-pink-500"
                        placeholder="Describe the purpose of this form..."
                      />
                    </div>
                    <div className="bg-pink-500/10 border border-pink-500/30 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-pink-400 mt-0.5 flex-shrink-0" />
                        <p className="text-pink-300 text-sm">
                          The form builder backend is being developed. The drag-and-drop form builder will be available soon.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled
                    className="px-4 py-2 bg-pink-600/50 text-white/50 rounded-lg cursor-not-allowed"
                  >
                    Create Form
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default FormsPage;
