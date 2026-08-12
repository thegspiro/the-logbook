/**
 * FacilityDetailPage — Full-page detail view for a single facility.
 *
 * Navigated to via /facilities/:id. Shows a sidebar with section navigation
 * and a main content area that displays the active section.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Building2, ArrowLeft, Loader2, Archive, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFacilitiesStore } from '../store/facilitiesStore';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import OverviewSection from '../components/OverviewSection';
import RoomsSection from '../components/RoomsSection';
import SystemsSection from '../components/SystemsSection';
import MaintenanceSection from '../components/MaintenanceSection';
import InspectionsSection from '../components/InspectionsSection';
import ContactsSection from '../components/ContactsSection';
import ComplianceSection from '../components/ComplianceSection';
import { useFacilitiesAccess } from '../hooks/useFacilitiesAccess';
import {
  AccessKeysSection,
  CapitalProjectsSection,
  InsuranceSection,
  OccupantsSection,
  ShutoffsSection,
  UtilitiesSection,
} from '../components/ExtendedFacilitySections';
import { FACILITY_DETAIL_SECTIONS, type FacilitySectionId } from '../facilityDetailSections';

export default function FacilityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canManage } = useFacilitiesAccess();
  const {
    selectedFacility: facility,
    isLoadingDetail,
    facilityTypes,
    facilityStatuses,
    loadFacilityDetail,
    loadLookupData,
    archiveFacility,
    restoreFacility,
    clearSelectedFacility,
  } = useFacilitiesStore();

  const [activeSection, setActiveSection] = useState<FacilitySectionId>('overview');

  useEffect(() => {
    if (id) {
      void loadFacilityDetail(id);
      void loadLookupData();
    }
    return () => clearSelectedFacility();
  }, [id, loadFacilityDetail, loadLookupData, clearSelectedFacility]);

  const handleArchive = async () => {
    if (!facility) return;
    try {
      await archiveFacility(facility.id);
      toast.success(`${facility.name} archived`);
      void navigate('/facilities');
    } catch {
      toast.error('Failed to archive facility');
    }
  };

  const handleRestore = async () => {
    if (!facility) return;
    try {
      await restoreFacility(facility.id);
      toast.success(`${facility.name} restored`);
      if (id) void loadFacilityDetail(id);
    } catch {
      toast.error('Failed to restore facility');
    }
  };

  if (isLoadingDetail && !facility) {
    return (
      <div className="flex items-center justify-center py-32" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="py-32 text-center">
        <Building2 className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
        <p className="text-theme-text-muted mb-4">Facility not found</p>
        <button onClick={() => void navigate('/facilities')} className="btn-primary inline-flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" /> Back to Facilities
        </button>
      </div>
    );
  }

  const address = [facility.addressLine1, facility.city, facility.state, facility.zipCode].filter(Boolean).join(', ');

  return (
    <div className="space-y-0">
      <Breadcrumbs />
      {/* Top Bar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => void navigate('/facilities')}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
            aria-label="Back to facilities"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
              <Building2 className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">{facility.name}</h1>
              <div className="text-theme-text-muted flex items-center gap-2 text-sm">
                {facility.facilityNumber && <span>{facility.facilityNumber}</span>}
                {facility.facilityNumber && address && <span>·</span>}
                {address && <span>{address}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status & Type badges */}
          {facility.facilityType && (
            <span className="bg-theme-surface-hover text-theme-text-muted rounded-full px-2.5 py-1 text-xs">
              {facility.facilityType.name}
            </span>
          )}
          {facility.statusRecord && (
            <span
              className="rounded-full px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: facility.statusRecord.color ? `${facility.statusRecord.color}20` : undefined,
                color: facility.statusRecord.color || undefined,
              }}
            >
              {facility.statusRecord.name}
            </span>
          )}
          {facility.isArchived && (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-400">
              Archived
            </span>
          )}

          {/* Action buttons */}
          {canManage &&
            (facility.isArchived ? (
              <button
                onClick={() => {
                  void handleRestore();
                }}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-3 py-1.5 text-sm text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
            ) : (
              <button
                onClick={() => {
                  void handleArchive();
                }}
                className="text-theme-text-muted border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors"
              >
                <Archive className="h-3.5 w-3.5" /> Archive
              </button>
            ))}
        </div>
      </div>

      {/* Main Layout: Sidebar + Content */}
      <div className="flex flex-col gap-6 sm:flex-row">
        {/* Sidebar Navigation */}
        <nav className="w-full shrink-0 sm:w-56" aria-label="Facility sections">
          <div className="bg-theme-surface-modal border-theme-surface-border sticky top-6 rounded-xl border p-2">
            {FACILITY_DETAIL_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                      : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Content Area */}
        <div className="min-w-0 flex-1">
          {activeSection === 'overview' && (
            <OverviewSection
              facility={facility}
              facilityTypes={facilityTypes}
              facilityStatuses={facilityStatuses}
              canManage={canManage}
            />
          )}
          {activeSection === 'rooms' && <RoomsSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'systems' && <SystemsSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'maintenance' && <MaintenanceSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'inspections' && <InspectionsSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'utilities' && <UtilitiesSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'contacts' && <ContactsSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'access-keys' && <AccessKeysSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'shutoffs' && <ShutoffsSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'capital-projects' && (
            <CapitalProjectsSection facilityId={facility.id} canManage={canManage} />
          )}
          {activeSection === 'insurance' && <InsuranceSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'occupants' && <OccupantsSection facilityId={facility.id} canManage={canManage} />}
          {activeSection === 'compliance' && <ComplianceSection facilityId={facility.id} canManage={canManage} />}
        </div>
      </div>
    </div>
  );
}
