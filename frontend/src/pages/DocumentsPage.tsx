import React, { useState } from 'react';
import {
  FileText,
  Upload,
  FolderOpen,
  Search,
  Folder,
  Grid,
  List,
  X,
  AlertCircle,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

interface DocumentFolder {
  id: string;
  name: string;
  description: string;
  documentCount: number;
  icon: string;
  color: string;
}

const DEFAULT_FOLDERS: DocumentFolder[] = [
  { id: 'sops', name: 'SOPs & Procedures', description: 'Standard Operating Procedures', documentCount: 0, icon: 'file-text', color: 'text-amber-400' },
  { id: 'policies', name: 'Policies', description: 'Department policies and guidelines', documentCount: 0, icon: 'shield', color: 'text-blue-400' },
  { id: 'forms', name: 'Forms & Templates', description: 'Blank forms and document templates', documentCount: 0, icon: 'file', color: 'text-green-400' },
  { id: 'reports', name: 'Reports', description: 'Monthly, quarterly, and annual reports', documentCount: 0, icon: 'file-spreadsheet', color: 'text-purple-400' },
  { id: 'training', name: 'Training Materials', description: 'Training manuals and reference materials', documentCount: 0, icon: 'file-text', color: 'text-red-400' },
  { id: 'general', name: 'General Documents', description: 'Miscellaneous department files', documentCount: 0, icon: 'folder', color: 'text-slate-400' },
];

type ViewMode = 'grid' | 'list';

const DocumentsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('documents.manage');

  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);

  // Upload form state
  const [uploadForm, setUploadForm] = useState({
    name: '',
    description: '',
    folder: 'general',
    file: null as File | null,
  });

  // Create folder form state
  const [folderForm, setFolderForm] = useState({
    name: '',
    description: '',
  });

  const folders = DEFAULT_FOLDERS;

  const currentFolder = selectedFolder
    ? folders.find(f => f.id === selectedFolder)
    : null;

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
          {canManage && (
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowCreateFolder(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors"
              >
                <Folder className="w-4 h-4" />
                <span>New Folder</span>
              </button>
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Document</span>
              </button>
            </div>
          )}
        </div>

        {/* Search & View Toggle */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                placeholder="Search documents by name, type, or tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="flex items-center space-x-2">
              {selectedFolder && (
                <button
                  onClick={() => setSelectedFolder(null)}
                  className="flex items-center space-x-1 px-3 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg text-sm"
                >
                  <span>{currentFolder?.name}</span>
                  <X className="w-4 h-4" />
                </button>
              )}
              <div className="flex bg-slate-900/50 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded ${viewMode === 'grid' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded ${viewMode === 'list' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Folder Browser */}
        {!selectedFolder && (
          <div className="mb-8">
            <h2 className="text-white text-lg font-semibold mb-4">Folders</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => setSelectedFolder(folder.id)}
                  className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 text-left hover:bg-white/15 hover:border-amber-500/30 transition-all group"
                >
                  <div className="flex items-start space-x-3">
                    <FolderOpen className={`w-8 h-8 ${folder.color} group-hover:scale-110 transition-transform`} />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-semibold truncate">{folder.name}</h3>
                      <p className="text-slate-400 text-sm mt-1">{folder.description}</p>
                      <p className="text-slate-500 text-xs mt-2">{folder.documentCount} documents</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty State - Documents in folder */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <FolderOpen className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">
            {selectedFolder ? 'No Documents in This Folder' : 'No Documents Yet'}
          </h3>
          <p className="text-slate-300 mb-6">
            {selectedFolder
              ? 'Upload documents to this folder to get started.'
              : 'Start building your document library by uploading SOPs, policies, and department files.'}
          </p>
          {canManage && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
            >
              <Upload className="w-5 h-5" />
              <span>Upload First Document</span>
            </button>
          )}
        </div>

        {/* Upload Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowUploadModal(false)} />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-white">Upload Document</h3>
                    <button onClick={() => setShowUploadModal(false)} className="text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:border-amber-500/50 transition-colors">
                      <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                      <p className="text-white font-medium mb-1">Drag and drop your file here</p>
                      <p className="text-slate-400 text-sm mb-3">or click to browse</p>
                      <input
                        type="file"
                        className="hidden"
                        id="file-upload"
                        onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files?.[0] || null })}
                      />
                      <label
                        htmlFor="file-upload"
                        className="inline-flex items-center px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors cursor-pointer"
                      >
                        Choose File
                      </label>
                      {uploadForm.file && (
                        <p className="mt-2 text-amber-400 text-sm">{uploadForm.file.name}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Document Name</label>
                      <input
                        type="text"
                        value={uploadForm.name}
                        onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Leave blank to use filename"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Folder</label>
                      <select
                        value={uploadForm.folder}
                        onChange={(e) => setUploadForm({ ...uploadForm, folder: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        {folders.map(f => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea
                        rows={2}
                        value={uploadForm.description}
                        onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                        <p className="text-amber-300 text-sm">
                          Document storage backend is being set up. File upload will be available once the storage service is configured.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled
                    className="px-4 py-2 bg-amber-600/50 text-white/50 rounded-lg cursor-not-allowed"
                  >
                    Upload
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create Folder Modal */}
        {showCreateFolder && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateFolder(false)} />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-white">Create Folder</h3>
                    <button onClick={() => setShowCreateFolder(false)} className="text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Folder Name *</label>
                      <input
                        type="text" required
                        value={folderForm.name}
                        onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="e.g., Safety Bulletins"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea
                        rows={2}
                        value={folderForm.description}
                        onChange={(e) => setFolderForm({ ...folderForm, description: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                        <p className="text-amber-300 text-sm">
                          Custom folders will be available once the documents backend is configured.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowCreateFolder(false)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled
                    className="px-4 py-2 bg-amber-600/50 text-white/50 rounded-lg cursor-not-allowed"
                  >
                    Create Folder
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

export default DocumentsPage;
