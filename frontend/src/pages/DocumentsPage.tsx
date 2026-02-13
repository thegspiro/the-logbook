import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  FolderOpen,
  Search,
  Folder,
  Grid,
  List,
  X,
  AlertCircle,
  Loader2,
  Trash2,
  File,
  ArrowLeft,
} from 'lucide-react';
import {
  documentsService,
  type DocumentFolder as DocFolder,
  type DocumentRecord,
  type DocumentsSummary,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';

type ViewMode = 'grid' | 'list';

const DocumentsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('documents.manage');

  // Data state
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [summary, setSummary] = useState<DocumentsSummary | null>(null);

  // Loading / error state
  const [loading, setLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [folderForm, setFolderForm] = useState({ name: '', description: '' });
  const [uploadForm, setUploadForm] = useState({
    name: '',
    description: '',
    folder: 'general',
    file: null as File | null,
  });

  // -------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------

  const fetchFolders = useCallback(async () => {
    try {
      const response = await documentsService.getFolders();
      setFolders(response.folders);
    } catch {
      setError('Unable to load folders. Please check your connection and try again.');
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await documentsService.getSummary();
      setSummary(data);
    } catch {
      // Summary is non-critical, silently ignore
    }
  }, []);

  const fetchDocuments = useCallback(async (folderId: string) => {
    setDocumentsLoading(true);
    try {
      const response = await documentsService.getDocuments({ folder_id: folderId });
      setDocuments(response.documents);
    } catch {
      setError('Unable to load documents. Please check your connection and try again.');
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchFolders(), fetchSummary()]);
      setLoading(false);
    };
    init();
  }, [fetchFolders, fetchSummary]);

  // Fetch documents when folder is selected
  useEffect(() => {
    if (selectedFolder) {
      fetchDocuments(selectedFolder);
    } else {
      setDocuments([]);
    }
  }, [selectedFolder, fetchDocuments]);

  // -------------------------------------------------------
  // Handlers
  // -------------------------------------------------------

  const handleCreateFolder = useCallback(async () => {
    if (!folderForm.name.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      await documentsService.createFolder({
        name: folderForm.name.trim(),
        description: folderForm.description.trim() || undefined,
      });
      setShowCreateFolder(false);
      setFolderForm({ name: '', description: '' });
      await fetchFolders();
      await fetchSummary();
    } catch {
      setError('Unable to create folder. Please check your connection and try again.');
    } finally {
      setActionLoading(false);
    }
  }, [folderForm, fetchFolders, fetchSummary]);

  const handleUploadDocument = useCallback(async () => {
    if (!uploadForm.file) return;
    setActionLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', uploadForm.file);
      if (uploadForm.name.trim()) {
        formData.append('name', uploadForm.name.trim());
      }
      if (uploadForm.description.trim()) {
        formData.append('description', uploadForm.description.trim());
      }
      formData.append('folder_id', uploadForm.folder);
      await documentsService.uploadDocument(formData);
      setShowUploadModal(false);
      setUploadForm({ name: '', description: '', folder: selectedFolder || 'general', file: null });
      await fetchFolders();
      await fetchSummary();
      if (selectedFolder) {
        await fetchDocuments(selectedFolder);
      }
    } catch {
      setError('Unable to upload document. Please check your connection and try again.');
    } finally {
      setActionLoading(false);
    }
  }, [uploadForm, selectedFolder, fetchFolders, fetchSummary, fetchDocuments]);

  const handleDeleteDocument = useCallback(async (documentId: string) => {
    setActionLoading(true);
    setError(null);
    try {
      await documentsService.deleteDocument(documentId);
      setDeleteConfirm(null);
      await fetchFolders();
      await fetchSummary();
      if (selectedFolder) {
        await fetchDocuments(selectedFolder);
      }
    } catch {
      setError('Unable to delete document. Please check your connection and try again.');
    } finally {
      setActionLoading(false);
    }
  }, [selectedFolder, fetchFolders, fetchSummary, fetchDocuments]);

  const handleFolderSelect = useCallback((folderId: string) => {
    setSelectedFolder(folderId);
    setError(null);
  }, []);

  const handleClearFolder = useCallback(() => {
    setSelectedFolder(null);
    setDocuments([]);
    setError(null);
  }, []);

  const handleOpenUploadModal = useCallback(() => {
    setUploadForm({
      name: '',
      description: '',
      folder: selectedFolder || (folders.length > 0 ? folders[0].id : 'general'),
      file: null,
    });
    setShowUploadModal(true);
  }, [selectedFolder, folders]);

  // -------------------------------------------------------
  // Derived state
  // -------------------------------------------------------

  const filteredDocuments = searchQuery.trim()
    ? documents.filter(
        d =>
          d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (d.description && d.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (d.file_type && d.file_type.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : documents;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />
          <p className="text-slate-300 text-sm">Loading documents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-amber-600 rounded-lg p-2">
              <FileText className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Documents & Files</h1>
              <p className="text-slate-300 text-sm">
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
                <Folder className="w-4 h-4" aria-hidden="true" />
                <span>New Folder</span>
              </button>
              <button
                onClick={handleOpenUploadModal}
                className="flex items-center space-x-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Document</span>
              </button>
            </div>
          )}
        </div>

        {/* Error Toast */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">Total Documents</p>
              <p className="text-white text-2xl font-bold mt-1">{summary.total_documents}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">Folders</p>
              <p className="text-amber-400 text-2xl font-bold mt-1">{summary.total_folders}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">Total Size</p>
              <p className="text-blue-400 text-2xl font-bold mt-1">{formatFileSize(summary.total_size_bytes)}</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-slate-400 text-xs font-medium uppercase">This Month</p>
              <p className="text-green-400 text-2xl font-bold mt-1">{summary.documents_this_month}</p>
            </div>
          </div>
        )}

        {/* Search & View Toggle */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6" role="search" aria-label="Search documents">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full md:max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden="true" />
              <label htmlFor="doc-search" className="sr-only">Search documents</label>
              <input
                id="doc-search"
                type="text"
                placeholder={selectedFolder ? 'Search documents in this folder...' : 'Select a folder to browse documents...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="flex items-center space-x-2">
              {selectedFolder && (
                <button
                  onClick={handleClearFolder}
                  className="flex items-center space-x-1 px-3 py-2 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg text-sm"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  <span>All Folders</span>
                </button>
              )}
              <div className="flex bg-slate-900/50 rounded-lg p-1" role="group" aria-label="View mode">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded ${viewMode === 'grid' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                >
                  <Grid className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded ${viewMode === 'list' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                >
                  <List className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Folder Browser */}
        {!selectedFolder && (
          <div className="mb-8">
            <h2 className="text-white text-lg font-semibold mb-4">Folders</h2>
            {folders.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => handleFolderSelect(folder.id)}
                    className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 text-left hover:bg-white/15 hover:border-amber-500/30 transition-all group"
                  >
                    <div className="flex items-start space-x-3">
                      <FolderOpen className={`w-8 h-8 ${folder.color || 'text-amber-400'} group-hover:scale-110 transition-transform`} />
                      <div className="flex-1 min-w-0">
                        <h3 className="text-white font-semibold truncate">{folder.name}</h3>
                        <p className="text-slate-400 text-sm mt-1">{folder.description || 'No description'}</p>
                        <p className="text-slate-500 text-xs mt-2">{folder.document_count} documents</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-8 border border-white/20 text-center">
                <FolderOpen className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-300">No folders yet. Create a folder to get started.</p>
              </div>
            )}
          </div>
        )}

        {/* Documents in Folder */}
        {selectedFolder && (
          <>
            {documentsLoading ? (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
                <Loader2 className="w-10 h-10 text-amber-400 animate-spin mx-auto mb-4" />
                <p className="text-slate-300 text-sm">Loading documents...</p>
              </div>
            ) : filteredDocuments.length > 0 ? (
              viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 hover:bg-white/15 transition-all group"
                    >
                      <div className="flex items-start space-x-3">
                        <File className="w-8 h-8 text-amber-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-semibold truncate">{doc.name}</h3>
                          {doc.description && (
                            <p className="text-slate-400 text-sm mt-1 line-clamp-2">{doc.description}</p>
                          )}
                          <div className="flex items-center space-x-3 mt-2">
                            <span className="text-slate-500 text-xs">{formatFileSize(doc.file_size)}</span>
                            {doc.file_type && (
                              <span className="text-slate-500 text-xs uppercase">{doc.file_type}</span>
                            )}
                          </div>
                          <p className="text-slate-500 text-xs mt-1">
                            {doc.uploader_name ? `Uploaded by ${doc.uploader_name}` : ''}{' '}
                            {new Date(doc.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        {canManage && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm(doc.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-400 transition-all p-1"
                            title="Delete document"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-slate-400 text-xs font-medium uppercase px-4 py-3">Name</th>
                        <th className="text-left text-slate-400 text-xs font-medium uppercase px-4 py-3">Size</th>
                        <th className="text-left text-slate-400 text-xs font-medium uppercase px-4 py-3">Type</th>
                        <th className="text-left text-slate-400 text-xs font-medium uppercase px-4 py-3">Uploaded</th>
                        {canManage && (
                          <th className="text-right text-slate-400 text-xs font-medium uppercase px-4 py-3">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocuments.map((doc) => (
                        <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center space-x-2">
                              <File className="w-4 h-4 text-amber-400 flex-shrink-0" />
                              <div>
                                <p className="text-white text-sm font-medium truncate max-w-xs">{doc.name}</p>
                                {doc.description && (
                                  <p className="text-slate-500 text-xs truncate max-w-xs">{doc.description}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-300 text-sm">{formatFileSize(doc.file_size)}</td>
                          <td className="px-4 py-3 text-slate-300 text-sm uppercase">{doc.file_type || '-'}</td>
                          <td className="px-4 py-3 text-slate-400 text-sm">
                            {new Date(doc.created_at).toLocaleDateString()}
                          </td>
                          {canManage && (
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => setDeleteConfirm(doc.id)}
                                className="text-slate-400 hover:text-red-400 transition-colors p-1"
                                title="Delete document"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
                <FolderOpen className="w-16 h-16 text-slate-500 mx-auto mb-4" />
                <h3 className="text-white text-xl font-bold mb-2">No Documents in This Folder</h3>
                <p className="text-slate-300 mb-6">
                  Upload documents to this folder to get started.
                </p>
                {canManage && (
                  <button
                    onClick={handleOpenUploadModal}
                    className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
                  >
                    <Upload className="w-5 h-5" />
                    <span>Upload First Document</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Empty State - No folder selected and no folders exist */}
        {!selectedFolder && folders.length === 0 && (
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
            <FolderOpen className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-white text-xl font-bold mb-2">No Documents Yet</h3>
            <p className="text-slate-300 mb-6">
              Start building your document library by uploading SOPs, policies, and department files.
            </p>
            {canManage && (
              <button
                onClick={handleOpenUploadModal}
                className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
              >
                <Upload className="w-5 h-5" />
                <span>Upload First Document</span>
              </button>
            )}
          </div>
        )}

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
                      <label htmlFor="upload-name" className="block text-sm font-medium text-slate-300 mb-1">Document Name</label>
                      <input
                        id="upload-name"
                        type="text"
                        value={uploadForm.name}
                        onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Optional - defaults to file name"
                      />
                    </div>

                    <div>
                      <label htmlFor="upload-description" className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea
                        id="upload-description"
                        rows={2}
                        value={uploadForm.description}
                        onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="Optional description"
                      />
                    </div>

                    <div>
                      <label htmlFor="upload-folder" className="block text-sm font-medium text-slate-300 mb-1">Folder</label>
                      <select
                        id="upload-folder"
                        value={uploadForm.folder}
                        onChange={(e) => setUploadForm({ ...uploadForm, folder: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
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
                    onClick={handleUploadDocument}
                    disabled={!uploadForm.file || actionLoading}
                    className={`px-4 py-2 rounded-lg text-white transition-colors inline-flex items-center space-x-2 ${
                      !uploadForm.file || actionLoading
                        ? 'bg-amber-600/50 text-white/50 cursor-not-allowed'
                        : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                  >
                    {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Upload</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create Folder Modal */}
        {showCreateFolder && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-folder-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateFolder(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateFolder(false)} aria-hidden="true" />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="create-folder-title" className="text-lg font-medium text-white">Create Folder</h3>
                    <button onClick={() => setShowCreateFolder(false)} className="text-slate-400 hover:text-white" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="folder-name" className="block text-sm font-medium text-slate-300 mb-1">Folder Name <span aria-hidden="true">*</span></label>
                      <input
                        id="folder-name"
                        type="text"
                        required
                        value={folderForm.name}
                        onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                        placeholder="e.g., Safety Bulletins"
                      />
                    </div>
                    <div>
                      <label htmlFor="folder-description" className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea
                        id="folder-description"
                        rows={2}
                        value={folderForm.description}
                        onChange={(e) => setFolderForm({ ...folderForm, description: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
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
                    onClick={handleCreateFolder}
                    disabled={!folderForm.name.trim() || actionLoading}
                    className={`px-4 py-2 rounded-lg text-white transition-colors inline-flex items-center space-x-2 ${
                      !folderForm.name.trim() || actionLoading
                        ? 'bg-amber-600/50 text-white/50 cursor-not-allowed'
                        : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                  >
                    {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Create Folder</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setDeleteConfirm(null)} />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-sm w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex items-start space-x-3">
                    <div className="bg-red-500/10 rounded-full p-2">
                      <AlertCircle className="w-6 h-6 text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white">Delete Document</h3>
                      <p className="text-slate-400 text-sm mt-1">
                        Are you sure you want to delete this document? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteDocument(deleteConfirm)}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
                  >
                    {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Delete</span>
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
