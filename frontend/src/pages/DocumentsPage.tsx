import React from 'react';
import { FileText, Upload, FolderOpen, Search, Shield } from 'lucide-react';

const DocumentsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-amber-600 rounded-lg p-2">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Documents & Files</h1>
              <p className="text-slate-400 text-sm">
                Centralized document storage for SOPs, policies, forms, and department files
              </p>
            </div>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Upload className="w-8 h-8 text-amber-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Upload & Organize</h3>
            <p className="text-slate-300 text-sm">
              Upload documents, create folders, and keep everything organized by category.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Search className="w-8 h-8 text-blue-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Search & Browse</h3>
            <p className="text-slate-300 text-sm">
              Quickly find any document with full-text search and category browsing.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <Shield className="w-8 h-8 text-green-400 mb-4" />
            <h3 className="text-white font-semibold text-lg mb-2">Access Control</h3>
            <p className="text-slate-300 text-sm">
              Control who can view, download, and manage documents with role-based permissions.
            </p>
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <FolderOpen className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">No Documents Yet</h3>
          <p className="text-slate-300 mb-6">
            Start building your document library by uploading SOPs, policies, and department files.
          </p>
          <button
            className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
            disabled
          >
            Upload Document (Coming Soon)
          </button>
        </div>
      </main>
    </div>
  );
};

export default DocumentsPage;
