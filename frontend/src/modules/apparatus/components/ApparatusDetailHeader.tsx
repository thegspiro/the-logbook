/**
 * Apparatus Detail Header Component
 *
 * Displays the back button, apparatus title, status badge, and action buttons
 * (Edit / Archive) for the apparatus detail page.
 */

import React from 'react';
import { useNavigate } from 'react-router';
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
    <header className="bg-theme-surface-secondary border-theme-surface-border border-b px-6 py-4 backdrop-blur-xs">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => void navigate('/apparatus')}
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-600 text-lg font-bold text-white">
              {currentApparatus.unitNumber.substring(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-theme-text-primary text-xl font-bold">{currentApparatus.unitNumber}</h1>
                {status && <StatusBadge status={status} />}
                {currentApparatus.hasDeficiency && (
                  <span className="inline-flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    Deficiency
                  </span>
                )}
                {isArchived && (
                  <span className="bg-theme-surface-hover text-theme-text-muted border-theme-surface-border rounded-sm border px-2 py-1 text-xs">
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
              onClick={() => void navigate(`/apparatus/${id}/edit`)}
              className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors"
            >
              <Edit className="h-4 w-4" />
              <span>Edit</span>
            </button>
            {!isArchived && (
              <button
                onClick={() => void navigate(`/apparatus/${id}/archive`)}
                className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors"
              >
                <Archive className="h-4 w-4" />
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
