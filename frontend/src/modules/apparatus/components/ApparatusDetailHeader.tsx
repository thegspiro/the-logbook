/**
 * Apparatus Detail Header Component
 *
 * Displays the back button, apparatus title, status badge, and action buttons
 * (Edit / Archive) for the apparatus detail page.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Archive, AlertTriangle } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { Apparatus, ApparatusStatus } from '../types';

interface ApparatusDetailHeaderProps {
  currentApparatus: Apparatus;
  status: ApparatusStatus | undefined;
  id: string;
  isArchived: boolean;
}

export const ApparatusDetailHeader: React.FC<ApparatusDetailHeaderProps> = ({
  currentApparatus,
  status,
  id,
  isArchived,
}) => {
  const navigate = useNavigate();

  return (
    <header className="bg-theme-surface-secondary backdrop-blur-xs border-b border-theme-surface-border px-6 py-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate('/apparatus')}
              className="p-2 text-theme-text-muted hover:text-theme-text-primary rounded-lg hover:bg-theme-surface-hover transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              {currentApparatus.unitNumber.substring(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-theme-text-primary text-xl font-bold">{currentApparatus.unitNumber}</h1>
                {status && <StatusBadge status={status} />}
                {currentApparatus.hasDeficiency && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20">
                    <AlertTriangle className="w-3 h-3" />
                    Deficiency
                  </span>
                )}
                {isArchived && (
                  <span className="px-2 py-1 bg-theme-surface-hover text-theme-text-muted text-xs rounded-sm border border-theme-surface-border">
                    ARCHIVED
                  </span>
                )}
              </div>
              <p className="text-theme-text-muted text-sm">
                {currentApparatus.name && `${currentApparatus.name} • `}
                {currentApparatus.year} {currentApparatus.make} {currentApparatus.model}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => navigate(`/apparatus/${id}/edit`)}
              className="flex items-center space-x-2 px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary rounded-lg transition-colors"
            >
              <Edit className="w-4 h-4" />
              <span>Edit</span>
            </button>
            {!isArchived && (
              <button
                onClick={() => navigate(`/apparatus/${id}/archive`)}
                className="flex items-center space-x-2 px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary rounded-lg transition-colors"
              >
                <Archive className="w-4 h-4" />
                <span>Archive</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default ApparatusDetailHeader;
