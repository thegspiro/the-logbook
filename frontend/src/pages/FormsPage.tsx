import React from 'react';
import { FormInput, Plus, BarChart3, FileCheck } from 'lucide-react';

const FormsPage: React.FC = () => {
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
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Plus className="w-8 h-8 text-pink-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Form Builder</h3>
            <p className="text-slate-300 text-sm">
              Drag-and-drop form builder with text fields, dropdowns, checkboxes, and more.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <FileCheck className="w-8 h-8 text-green-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Submissions</h3>
            <p className="text-slate-300 text-sm">
              View and manage form submissions with approval workflows and status tracking.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <BarChart3 className="w-8 h-8 text-blue-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Analytics</h3>
            <p className="text-slate-300 text-sm">
              View response analytics and export data for reporting and compliance.
            </p>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <FormInput className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">No Forms Created</h3>
          <p className="text-slate-300 mb-6">
            Create custom forms for incident reports, inspections, surveys, and more.
          </p>
          <button
            className="px-6 py-3 bg-pink-600 hover:bg-pink-700 text-white rounded-lg transition-colors"
            disabled
          >
            Create Form (Coming Soon)
          </button>
        </div>
      </main>
    </div>
  );
};

export default FormsPage;
