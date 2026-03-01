/**
 * Documents Tab Component
 *
 * Placeholder tab for document and photo management on an apparatus.
 */

import React from 'react';
import { FileText, Camera } from 'lucide-react';

interface DocumentsTabProps {
  id: string;
}

export const DocumentsTab: React.FC<DocumentsTabProps> = ({ id: _id }) => {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-theme-text-primary font-bold flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Documents & Photos
        </h2>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary rounded-lg transition-colors text-sm flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Add Photo
          </button>
          <button className="btn-primary flex gap-2 items-center text-sm">
            <FileText className="w-4 h-4" />
            Add Document
          </button>
        </div>
      </div>
      <p className="text-theme-text-muted text-center py-8">
        Document management will be available in the full implementation.
      </p>
    </div>
  );
};

export default DocumentsTab;
