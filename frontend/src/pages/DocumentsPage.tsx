import React, { useEffect, useState } from 'react';
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
  ArrowLeft,
  Trash2,
  Eye,
  File,
  ClipboardList,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { documentService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import type { DocumentFolder, DocumentListItem, DocumentItem } from '../types/document';

const ICON_MAP: Record<string, React.ReactNode> = {
  'clipboard-list': <ClipboardList className="w-8 h-8" />,
  'file-text': <FileText className="w-8 h-8" />,
  'shield': <File className="w-8 h-8" />,
  'file': <File className="w-8 h-8" />,
  'bar-chart': <FileText className="w-8 h-8" />,
  'book-open': <FileText className="w-8 h-8" />,
  'folder': <Folder className="w-8 h-8" />,
};

type ViewMode = 'grid' | 'list';

const DocumentsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('documents.manage');

  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedFolder, setSelectedFolder] = useState<DocumentFolder | null>(null);

  // Document viewer
  const [viewingDocument, setViewingDocument] = useState<DocumentItem | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);

  // Create folder
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderForm, setFolderForm] = useState({ name: '', description: '' });
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => {
    fetchFolders();
  }, []);

  useEffect(() => {
    if (selectedFolder) {
      fetchDocuments(selectedFolder.id);
    } else {
      setDocuments([]);
    }
  }, [selectedFolder]);

  const fetchFolders = async () => {
    try {
      setLoadingFolders(true);
      const data = await documentService.listFolders();
      setFolders(data);
    } catch (err) {
      console.error('Failed to load folders:', err);
      toast.error('Failed to load document folders');
    } finally {
      setLoadingFolders(false);
    }
  };

  const fetchDocuments = async (folderId: string) => {
    try {
      setLoadingDocuments(true);
      const data = await documentService.listDocuments({ folder_id: folderId });
      setDocuments(data);
    } catch (err) {
      console.error('Failed to load documents:', err);
      toast.error('Failed to load documents');
    } finally {
      setLoadingDocuments(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!folderForm.name.trim()) return;
    try {
      setCreatingFolder(true);
      const slug = folderForm.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      await documentService.createFolder({
        name: folderForm.name.trim(),
        slug,
        description: folderForm.description || undefined,
      });
      setShowCreateFolder(false);
      setFolderForm({ name: '', description: '' });
      await fetchFolders();
      toast.success('Folder created');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDeleteFolder = async (folder: DocumentFolder) => {
    if (folder.is_system) {
      toast.error('System folders cannot be deleted');
      return;
    }
    if (!confirm(`Delete folder "${folder.name}" and all its documents?`)) return;
    try {
      await documentService.deleteFolder(folder.id);
      if (selectedFolder?.id === folder.id) setSelectedFolder(null);
      await fetchFolders();
      toast.success('Folder deleted');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to delete folder');
    }
  };

  const handleViewDocument = async (doc: DocumentListItem) => {
    try {
      setLoadingDocument(true);
      const full = await documentService.getDocument(doc.id);
      setViewingDocument(full);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to load document');
    } finally {
      setLoadingDocument(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Delete this document?')) return;
    try {
      await documentService.deleteDocument(docId);
      if (selectedFolder) fetchDocuments(selectedFolder.id);
      fetchFolders(); // refresh counts
      if (viewingDocument?.id === docId) setViewingDocument(null);
      toast.success('Document deleted');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to delete document');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filteredDocuments = searchQuery.trim()
    ? documents.filter(d =>
        d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : documents;

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
                placeholder={selectedFolder ? 'Search documents in this folder...' : 'Select a folder to browse documents...'}
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
                  <ArrowLeft className="w-4 h-4" />
                  <span>All Folders</span>
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
            {loadingFolders ? (
              <p className="text-slate-400 text-sm">Loading folders...</p>
            ) : folders.length === 0 ? (
              <p className="text-slate-400 text-sm">No folders yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {folders
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => setSelectedFolder(folder)}
                      className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 text-left hover:bg-white/15 hover:border-amber-500/30 transition-all group relative"
                    >
                      <div className="flex items-start space-x-3">
                        <div className={`${folder.color || 'text-slate-400'} group-hover:scale-110 transition-transform`}>
                          {ICON_MAP[folder.icon || 'folder'] || <FolderOpen className="w-8 h-8" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-white font-semibold truncate">{folder.name}</h3>
                          <p className="text-slate-400 text-sm mt-1">{folder.description}</p>
                          <p className="text-slate-500 text-xs mt-2">{folder.document_count} documents</p>
                        </div>
                      </div>
                      {canManage && !folder.is_system && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder); }}
                          className="absolute top-3 right-3 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete folder"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Documents in Selected Folder */}
        {selectedFolder && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className={`${selectedFolder.color || 'text-slate-400'}`}>
                {ICON_MAP[selectedFolder.icon || 'folder'] || <FolderOpen className="w-6 h-6" />}
              </div>
              <div>
                <h2 className="text-white text-lg font-semibold">{selectedFolder.name}</h2>
                {selectedFolder.description && (
                  <p className="text-slate-400 text-xs">{selectedFolder.description}</p>
                )}
              </div>
            </div>

            {loadingDocuments ? (
              <p className="text-slate-400 text-sm py-8 text-center">Loading documents...</p>
            ) : filteredDocuments.length === 0 ? (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
                <FolderOpen className="w-16 h-16 text-slate-500 mx-auto mb-4" />
                <h3 className="text-white text-xl font-bold mb-2">No Documents in This Folder</h3>
                <p className="text-slate-300 mb-6">
                  {selectedFolder.slug === 'meeting-minutes'
                    ? 'Published meeting minutes will appear here. Approve and publish minutes from the Minutes module.'
                    : 'Documents will appear here once they are added to this folder.'}
                </p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredDocuments.map(doc => (
                  <div
                    key={doc.id}
                    className="bg-white/10 backdrop-blur-sm rounded-lg p-5 border border-white/20 hover:bg-white/15 transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-amber-400 mt-1">
                        {doc.document_type === 'generated' ? <ClipboardList className="w-6 h-6" /> : <File className="w-6 h-6" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-white font-medium truncate">{doc.title}</h4>
                        {doc.description && (
                          <p className="text-slate-400 text-xs mt-1 line-clamp-2">{doc.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            doc.document_type === 'generated' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {doc.document_type === 'generated' ? 'Published' : 'Uploaded'}
                          </span>
                          {doc.source_type === 'meeting_minutes' && (
                            <span className="text-xs text-slate-500">From Minutes</span>
                          )}
                        </div>
                        <p className="text-slate-500 text-xs mt-2">{formatDate(doc.created_at)}</p>
                        {doc.tags && doc.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {doc.tags.map((tag, i) => (
                              <span key={i} className="text-xs px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleViewDocument(doc)}
                        className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700"
                      >
                        <Eye className="w-3.5 h-3.5 inline mr-1" />
                        View
                      </button>
                      {canManage && (
                        <button
                          onClick={() => handleDeleteDocument(doc.id)}
                          className="text-xs px-3 py-1.5 bg-red-600/80 text-white rounded hover:bg-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline mr-1" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
                <table className="min-w-full divide-y divide-white/10">
                  <thead className="bg-white/5">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Title</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Type</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Size</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {filteredDocuments.map(doc => (
                      <tr key={doc.id} className="hover:bg-white/5">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="text-amber-400">
                              {doc.document_type === 'generated' ? <ClipboardList className="w-4 h-4" /> : <File className="w-4 h-4" />}
                            </div>
                            <div>
                              <div className="text-sm text-white font-medium">{doc.title}</div>
                              {doc.description && <div className="text-xs text-slate-400 truncate max-w-xs">{doc.description}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            doc.document_type === 'generated' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {doc.document_type === 'generated' ? 'Published' : 'Uploaded'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-400">{formatDate(doc.created_at)}</td>
                        <td className="px-6 py-4 text-sm text-slate-400">{formatFileSize(doc.file_size)}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleViewDocument(doc)}
                              className="text-xs text-amber-400 hover:text-amber-300"
                            >
                              View
                            </button>
                            {canManage && (
                              <button
                                onClick={() => handleDeleteDocument(doc.id)}
                                className="text-xs text-red-400 hover:text-red-300"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Document Viewer Modal */}
        {(viewingDocument || loadingDocument) && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4 py-8">
              <div className="fixed inset-0 bg-black/60" onClick={() => { if (!loadingDocument) setViewingDocument(null); }} />
              <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center shrink-0">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">
                      {loadingDocument ? 'Loading...' : viewingDocument?.title}
                    </h3>
                    {viewingDocument && (
                      <p className="text-xs text-gray-500 mt-1">
                        {formatDate(viewingDocument.created_at)}
                        {viewingDocument.source_type === 'meeting_minutes' && ' \u00b7 Published Meeting Minutes'}
                      </p>
                    )}
                  </div>
                  <button onClick={() => setViewingDocument(null)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6">
                  {loadingDocument ? (
                    <p className="text-gray-500 text-center py-12">Loading document...</p>
                  ) : viewingDocument?.content_html ? (
                    <div
                      className="prose max-w-none"
                      dangerouslySetInnerHTML={{ __html: viewingDocument.content_html }}
                    />
                  ) : viewingDocument?.file_name ? (
                    <div className="text-center py-12">
                      <File className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-700 font-medium">{viewingDocument.file_name}</p>
                      <p className="text-gray-500 text-sm mt-1">{formatFileSize(viewingDocument.file_size)}</p>
                      <p className="text-gray-400 text-xs mt-4">
                        File download not yet available. Contact your administrator.
                      </p>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-12">No content available for this document.</p>
                  )}
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
                        type="text"
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
                    disabled={creatingFolder || !folderForm.name.trim()}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {creatingFolder ? 'Creating...' : 'Create Folder'}
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
