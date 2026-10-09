/**
 * Apparatus Detail Header Component
 *
 * Displays the back button, apparatus title, status badge, and action buttons
 * (Edit / Archive) for the apparatus detail page.
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Edit, Archive, AlertTriangle } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { ArchiveApparatusModal } from './ArchiveApparatusModal';
import type { Apparatus, ApparatusStatus } from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, toLocalDateString } from '../../../utils/dateFormatting';

interface ApparatusDetailHeaderProps {
  currentApparatus: Apparatus;
  status: ApparatusStatus | undefined;
  id: string;
  isArchived: boolean;
  /** Re-read the apparatus once it has been archived, so the badge updates. */
  onArchived?: () => void;
}

export const ApparatusDetailHeader: React.FC<ApparatusDetailHeaderProps> = ({
  currentApparatus,
  status,
  id,
  isArchived,
  onArchived,
}) => {
  const navigate = useNavigate();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canManage = checkPermission('apparatus.manage');
  const canEdit = canManage || checkPermission('apparatus.edit');
  // Matches the gate on /inventory/admin/checklists/reports.
  const canViewChecks = checkPermission('inventory.check_view');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const tz = useTimezone();

  return (
    <header className="bg-theme-surface-secondary border-theme-surface-border border-b px-6 py-4 backdrop-blur-xs">
      <div className="mx-auto max-w-7xl">
        {/* Wraps below 640px: unwrapped, Edit and Archive ran 85px past a
            390px screen and the page scrolled sideways. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => void navigate('/apparatus')}
              aria-label="Back to apparatus"
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-800 text-lg font-bold text-white">
              {currentApparatus.unitNumber.replace(/[^A-Za-z0-9]/g, '').substring(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-theme-text-primary text-xl font-bold">{currentApparatus.unitNumber}</h1>
                {status && <StatusBadge status={status} />}
                {currentApparatus.hasDeficiency && (
                  <span className="inline-flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-900 dark:text-red-300">
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
          {(canEdit || (canManage && !isArchived)) && (
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && (
                <button
                  onClick={() => void navigate(`/apparatus/${id}/edit`)}
                  className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors"
                >
                  <Edit className="h-4 w-4" />
                  <span>Edit</span>
                </button>
              )}
              {canManage && !isArchived && (
                <button
                  onClick={() => setArchiveOpen(true)}
                  className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-secondary flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors"
                >
                  <Archive className="h-4 w-4" />
                  <span>Archive</span>
                </button>
              )}
            </div>
          )}
        </div>
        {/* Statuses such as Out of Service carry a reason; without it on the
            page, nobody can tell why a rig is off the road. */}
        {currentApparatus.statusReason && (
          <p className="text-theme-text-secondary mt-3 text-sm">
            <span className="font-medium">{status?.name ?? 'Status'}:</span> {currentApparatus.statusReason}
          </p>
        )}
        {/* has_deficiency is set by a failed equipment check and cleared only
            by the next passing one (EquipmentCheckService
            ._update_apparatus_deficiency), so logging the repair leaves it on.
            The failure itself is on Check reports, not on this page. */}
        {currentApparatus.hasDeficiency && (
          <p className="text-theme-text-secondary mt-3 text-sm">
            An equipment check on this apparatus found a problem
            {currentApparatus.deficiencySince ? ` on ${formatDate(currentApparatus.deficiencySince, tz)}` : ''}. The
            Deficiency badge clears when the next check passes; logging a repair does not clear it.{' '}
            {canViewChecks && (
              <Link
                to={`/inventory/admin/checklists/reports?tab=failures${
                  currentApparatus.deficiencySince
                    ? `&from=${toLocalDateString(new Date(currentApparatus.deficiencySince), tz)}`
                    : ''
                }`}
                className="mobile-touch-target font-medium text-red-800 hover:underline dark:text-red-300"
              >
                See what was found →
              </Link>
            )}
          </p>
        )}
      </div>
      <ArchiveApparatusModal
        isOpen={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onArchived={() => onArchived?.()}
        apparatusId={id}
        unitNumber={currentApparatus.unitNumber}
      />
    </header>
  );
};

export default ApparatusDetailHeader;
