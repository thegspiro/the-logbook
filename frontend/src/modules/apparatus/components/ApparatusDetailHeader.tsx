/**
 * Apparatus Detail Header Component
 *
 * The apparatus detail page's title, status badges and Edit / Archive actions,
 * drawn through the shared Operations header, plus the status reason and the
 * deficiency notice under it.
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Truck, Edit, Archive, AlertTriangle } from 'lucide-react';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';
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
    <div>
      <OperationsPageHeader
        icon={Truck}
        breadcrumbLabel={currentApparatus.unitNumber}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {currentApparatus.unitNumber}
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
          </span>
        }
        subtitle={
          <>
            {currentApparatus.name && `${currentApparatus.name} • `}
            {currentApparatus.year} {currentApparatus.make} {currentApparatus.model}
          </>
        }
        actions={
          (canEdit || (canManage && !isArchived)) && (
            <>
              {canEdit && (
                <button
                  onClick={() => void navigate(`/apparatus/${id}/edit`)}
                  className="btn-secondary flex items-center space-x-2"
                >
                  <Edit className="h-4 w-4" />
                  <span>Edit</span>
                </button>
              )}
              {canManage && !isArchived && (
                <button onClick={() => setArchiveOpen(true)} className="btn-secondary flex items-center space-x-2">
                  <Archive className="h-4 w-4" />
                  <span>Archive</span>
                </button>
              )}
            </>
          )
        }
      />
      {(currentApparatus.statusReason || currentApparatus.hasDeficiency) && (
        <div className="-mt-4 mb-6 space-y-3">
          {/* Statuses such as Out of Service carry a reason; without it on the
            page, nobody can tell why a rig is off the road. */}
          {currentApparatus.statusReason && (
            <p className="text-theme-text-secondary text-sm">
              <span className="font-medium">{status?.name ?? 'Status'}:</span> {currentApparatus.statusReason}
            </p>
          )}
          {/* has_deficiency is set by a failed equipment check and cleared only
            by the next passing one (EquipmentCheckService
            ._update_apparatus_deficiency), so logging the repair leaves it on.
            The failure itself is on Check reports, not on this page. */}
          {currentApparatus.hasDeficiency && (
            <p className="text-theme-text-secondary text-sm">
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
      )}
      <ArchiveApparatusModal
        isOpen={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onArchived={() => onArchived?.()}
        apparatusId={id}
        unitNumber={currentApparatus.unitNumber}
      />
    </div>
  );
};

export default ApparatusDetailHeader;
