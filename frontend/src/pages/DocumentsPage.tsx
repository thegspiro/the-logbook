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
  Upload,
} from 'lucide-react';
import {
  documentsService,
  type DocumentFolder as DocFolder,
  type DocumentRecord,
  type DocumentsSummary,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';
import { asArray } from '../utils/asArray';

type ViewMode = 'grid' | 'list';

const DocumentsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('documents.manage');
  const tz = useTimezone();

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
      // Envelope responses put the array a level down, where the service's
      // asArray guard does not reach — and `folders` is mapped and measured
      // without checking, so an envelope missing the key crashes the page.
      setFolders(asArray(response.folders));
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
      setDocuments(asArray(response.documents));
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
    void init();
  }, [fetchFolders, fetchSummary]);

  // Fetch documents when folder is selected
  useEffect(() => {
    if (selectedFolder) {
      void fetchDocuments(selectedFolder);
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
        ...(folderForm.description.trim() ? { description: folderForm.description.trim() } : {}),
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

  const handleDeleteDocument = useCallback(
    async (documentId: string) => {
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
    },
    [selectedFolder, fetchFolders, fetchSummary, fetchDocuments]
  );

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
      folder: selectedFolder || (folders.length > 0 && folders[0] ? folders[0].id : 'general'),
      file: null,
    });
    setShowUploadModal(true);
  }, [selectedFolder, folders]);

  // -------------------------------------------------------
  // Derived state
  // -------------------------------------------------------

  const filteredDocuments = searchQuery.trim()
    ? documents.filter(
        (d) =>
          (d.name && d.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
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
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center space-y-4" role="status" aria-live="polite">
          <Loader2 className="h-10 w-10 animate-spin text-amber-700 dark:text-amber-400" />
          <p className="text-theme-text-secondary text-sm">Loading documents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center space-x-3">
            <div className="shrink-0 rounded-lg bg-amber-600 p-2">
              <FileText className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Documents & Files</h1>
              <p className="text-theme-text-secondary text-sm">
                Centralized document storage for SOPs, policies, forms, and department files
              </p>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowCreateFolder(true)}
                className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors"
              >
                <Folder className="h-4 w-4" aria-hidden="true" />
                <span>New Folder</span>
              </button>
              <button
                onClick={handleOpenUploadModal}
                className="flex items-center space-x-2 rounded-lg bg-amber-600 px-4 py-2 text-white transition-colors hover:bg-amber-700"
              >
                <Upload className="h-4 w-4" />
                <span>Upload Document</span>
              </button>
            </div>
          )}
        </div>

        {/* Error Toast */}
        {error && (
          <div className="mb-6 flex items-start space-x-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
            <div className="flex-1">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Summary Stats */}
        {summary && (
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Total Documents</p>
              <p className="text-theme-text-primary mt-1 text-2xl font-bold">{summary.total_documents}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Folders</p>
              <p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-400">{summary.total_folders}</p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Total Size</p>
              <p className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-400">
                {formatFileSize(summary.total_size_bytes)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-theme-text-muted text-xs font-medium uppercase">This Month</p>
              <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">
                {summary.documents_this_month}
              </p>
            </div>
          </div>
        )}

        {/* Search & View Toggle */}
        <div className="card mb-6 p-4" role="search" aria-label="Search documents">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="relative w-full flex-1 md:max-w-md">
              <Search
                className="text-theme-text-muted absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 transform"
                aria-hidden="true"
              />
              <label htmlFor="doc-search" className="sr-only">
                Search documents
              </label>
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                id="doc-search"
                type="text"
                placeholder={
                  selectedFolder ? 'Search documents in this folder...' : 'Select a folder to browse documents...'
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input placeholder-theme-text-muted pr-4 pl-10 focus:ring-amber-500"
              />
            </div>
            <div className="flex items-center space-x-2">
              {selectedFolder && (
                <button
                  onClick={handleClearFolder}
                  className="flex items-center space-x-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  <span>All Folders</span>
                </button>
              )}
              <div className="bg-theme-surface-secondary flex rounded-lg p-1" role="group" aria-label="View mode">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`max-md:mobile-touch-target rounded-sm p-2.5 ${viewMode === 'grid' ? 'bg-amber-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                >
                  <Grid className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`max-md:mobile-touch-target rounded-sm p-2.5 ${viewMode === 'list' ? 'bg-amber-600 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                >
                  <List className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Folder Browser */}
        {!selectedFolder && (
          <div className="mb-8">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Folders</h2>
            {folders.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => handleFolderSelect(folder.id)}
                    className="stat-card group hover:bg-theme-surface-hover text-left transition-all hover:border-amber-500/30"
                  >
                    <div className="flex items-start space-x-3">
                      <FolderOpen
                        className={`h-8 w-8 ${folder.color || 'text-amber-700 dark:text-amber-400'} transition-transform group-hover:scale-110`}
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-theme-text-primary truncate font-semibold">{folder.name}</h3>
                        <p className="text-theme-text-muted mt-1 text-sm">{folder.description || 'No description'}</p>
                        <p className="text-theme-text-muted mt-2 text-xs">
                          {folder.document_count} {folder.document_count === 1 ? 'document' : 'documents'}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="card p-8 text-center">
                <FolderOpen className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
                <p className="text-theme-text-secondary">No folders yet. Create a folder to get started.</p>
              </div>
            )}
          </div>
        )}

        {/* Documents in Folder */}
        {selectedFolder && (
          <>
            {documentsLoading ? (
              <div className="card p-12 text-center" role="status" aria-live="polite">
                <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-amber-700 dark:text-amber-400" />
                <p className="text-theme-text-secondary text-sm">Loading documents...</p>
              </div>
            ) : filteredDocuments.length > 0 ? (
              viewMode === 'grid' ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredDocuments.map((doc) => (
                    <div key={doc.id} className="stat-card group hover:bg-theme-surface-hover transition-all">
                      <div className="flex items-start space-x-3">
                        <File className="h-8 w-8 shrink-0 text-amber-700 dark:text-amber-400" />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-theme-text-primary truncate font-semibold">{doc.name}</h3>
                          {doc.description && (
                            <p className="text-theme-text-muted mt-1 line-clamp-2 text-sm">{doc.description}</p>
                          )}
                          <div className="mt-2 flex items-center space-x-3">
                            <span className="text-theme-text-muted text-xs">{formatFileSize(doc.file_size)}</span>
                            {doc.file_type && (
                              <span className="text-theme-text-muted text-xs uppercase">{doc.file_type}</span>
                            )}
                          </div>
                          <p className="text-theme-text-muted mt-1 text-xs">
                            {doc.uploader_name ? `Uploaded by ${doc.uploader_name}` : ''}{' '}
                            {formatDate(doc.created_at, tz)}
                          </p>
                        </div>
                        {canManage && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm(doc.id);
                            }}
                            className="text-theme-text-muted p-1 transition-all hover:text-red-800 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:text-red-400"
                            title="Delete document"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card overflow-hidden overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-theme-surface-border border-b">
                        <th
                          scope="col"
                          className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                        >
                          Name
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                        >
                          Size
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                        >
                          Type
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-muted px-4 py-3 text-left text-xs font-medium uppercase"
                        >
                          Uploaded
                        </th>
                        {canManage && (
                          <th
                            scope="col"
                            className="text-theme-text-muted px-4 py-3 text-right text-xs font-medium uppercase"
                          >
                            Actions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocuments.map((doc) => (
                        <tr
                          key={doc.id}
                          className="border-theme-surface-border hover:bg-theme-surface-hover border-b transition-colors"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center space-x-2">
                              <File className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                              <div>
                                <p className="text-theme-text-primary max-w-xs truncate text-sm font-medium">
                                  {doc.name}
                                </p>
                                {doc.description && (
                                  <p className="text-theme-text-muted max-w-xs truncate text-xs">{doc.description}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="text-theme-text-secondary px-4 py-3 text-sm">
                            {formatFileSize(doc.file_size)}
                          </td>
                          <td className="text-theme-text-secondary px-4 py-3 text-sm uppercase">
                            {doc.file_type || '-'}
                          </td>
                          <td className="text-theme-text-muted px-4 py-3 text-sm">{formatDate(doc.created_at, tz)}</td>
                          {canManage && (
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => setDeleteConfirm(doc.id)}
                                className="text-theme-text-muted p-1 transition-colors hover:text-red-800 dark:hover:text-red-400"
                                title="Delete document"
                              >
                                <Trash2 className="h-4 w-4" />
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
              <div className="card p-12 text-center">
                <FolderOpen className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <h3 className="text-theme-text-primary mb-2 text-xl font-bold">No Documents in This Folder</h3>
                <p className="text-theme-text-secondary mb-6">Upload documents to this folder to get started.</p>
                {canManage && (
                  <button
                    onClick={handleOpenUploadModal}
                    className="inline-flex items-center space-x-2 rounded-lg bg-amber-600 px-6 py-3 text-white transition-colors hover:bg-amber-700"
                  >
                    <Upload className="h-5 w-5" />
                    <span>Upload First Document</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Empty State - No folder selected and no folders exist */}
        {!selectedFolder && folders.length === 0 && (
          <div className="card p-12 text-center">
            <FolderOpen className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
            <h3 className="text-theme-text-primary mb-2 text-xl font-bold">No Documents Yet</h3>
            <p className="text-theme-text-secondary mb-6">
              Start building your document library by uploading SOPs, policies, and department files.
            </p>
            {canManage && (
              <button
                onClick={handleOpenUploadModal}
                className="inline-flex items-center space-x-2 rounded-lg bg-amber-600 px-6 py-3 text-white transition-colors hover:bg-amber-700"
              >
                <Upload className="h-5 w-5" />
                <span>Upload First Document</span>
              </button>
            )}
          </div>
        )}

        {/* Upload Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowUploadModal(false)} aria-hidden="true" />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-lg rounded-lg border shadow-xl">
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-theme-text-primary text-lg font-medium">Upload Document</h3>
                    <button
                      onClick={() => setShowUploadModal(false)}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="border-theme-surface-border rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:border-amber-500/50">
                      <Upload className="text-theme-text-muted mx-auto mb-3 h-10 w-10" />
                      <p className="text-theme-text-primary mb-1 font-medium">Drag and drop your file here</p>
                      <p className="text-theme-text-muted mb-3 text-sm">or click to browse</p>
                      <input
                        type="file"
                        className="hidden"
                        id="file-upload"
                        onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files?.[0] || null })}
                      />
                      <label
                        htmlFor="file-upload"
                        className="inline-flex cursor-pointer items-center rounded-lg bg-amber-600 px-4 py-2 text-white transition-colors hover:bg-amber-700"
                      >
                        Choose File
                      </label>
                      {uploadForm.file && (
                        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{uploadForm.file.name}</p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="upload-name" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                        Document Name
                      </label>
                      <input
                        id="upload-name"
                        type="text"
                        value={uploadForm.name}
                        onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                        className="form-input focus:ring-amber-500"
                        placeholder="Optional - defaults to file name"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="upload-description"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Description
                      </label>
                      <textarea
                        id="upload-description"
                        rows={2}
                        value={uploadForm.description}
                        onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                        className="form-input focus:ring-amber-500"
                        placeholder="Optional description"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="upload-folder"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Folder
                      </label>
                      <select
                        id="upload-folder"
                        value={uploadForm.folder}
                        onChange={(e) => setUploadForm({ ...uploadForm, folder: e.target.value })}
                        className="form-input focus:ring-amber-500"
                      >
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-surface-secondary flex justify-end space-x-3 rounded-b-lg px-6 py-3">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleUploadDocument();
                    }}
                    disabled={!uploadForm.file || actionLoading}
                    className={`inline-flex items-center space-x-2 rounded-lg px-4 py-2 text-white transition-colors ${
                      !uploadForm.file || actionLoading
                        ? 'cursor-not-allowed bg-amber-600 opacity-50'
                        : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                  >
                    {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
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
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowCreateFolder(false);
            }}
          >
            <div className="flex min-h-screen items-center justify-center px-4">
              <div
                className="fixed inset-0 bg-black/60"
                onClick={() => setShowCreateFolder(false)}
                aria-hidden="true"
              />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-lg rounded-lg border shadow-xl">
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 id="create-folder-title" className="text-theme-text-primary text-lg font-medium">
                      Create Folder
                    </h3>
                    <button
                      onClick={() => setShowCreateFolder(false)}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                      aria-label="Close dialog"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="folder-name" className="text-theme-text-secondary mb-1 block text-sm font-medium">
                        Folder Name <span aria-hidden="true">*</span>
                      </label>
                      <input
                        id="folder-name"
                        type="text"
                        required
                        value={folderForm.name}
                        onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
                        className="form-input focus:ring-amber-500"
                        placeholder="e.g., Safety Bulletins"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="folder-description"
                        className="text-theme-text-secondary mb-1 block text-sm font-medium"
                      >
                        Description
                      </label>
                      <textarea
                        id="folder-description"
                        rows={2}
                        value={folderForm.description}
                        onChange={(e) => setFolderForm({ ...folderForm, description: e.target.value })}
                        className="form-input focus:ring-amber-500"
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-theme-surface-secondary flex justify-end space-x-3 rounded-b-lg px-6 py-3">
                  <button
                    onClick={() => setShowCreateFolder(false)}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleCreateFolder();
                    }}
                    disabled={!folderForm.name.trim() || actionLoading}
                    className={`inline-flex items-center space-x-2 rounded-lg px-4 py-2 text-white transition-colors ${
                      !folderForm.name.trim() || actionLoading
                        ? 'cursor-not-allowed bg-amber-600 opacity-50'
                        : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                  >
                    {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
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
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setDeleteConfirm(null)} aria-hidden="true" />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-sm rounded-lg border shadow-xl">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex items-start space-x-3">
                    <div className="rounded-full bg-red-500/10 p-2">
                      <AlertCircle className="h-6 w-6 text-red-700 dark:text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-theme-text-primary text-lg font-medium">Delete Document</h3>
                      <p className="text-theme-text-muted mt-1 text-sm">
                        Are you sure you want to delete this document? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-theme-surface-secondary flex justify-end space-x-3 rounded-b-lg px-6 py-3">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleDeleteDocument(deleteConfirm);
                    }}
                    disabled={actionLoading}
                    className="btn-primary inline-flex items-center space-x-2"
                  >
                    {actionLoading && <Loader2 className="h-4 w-4 animate-spin" />}
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
