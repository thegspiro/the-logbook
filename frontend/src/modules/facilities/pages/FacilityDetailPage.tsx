/**
 * FacilityDetailPage — Full-page detail view for a single facility.
 *
 * Navigated to via /facilities/:id. Shows a sidebar with section navigation
 * and a main content area that displays the active section.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Building2,
  ArrowLeft,
  Loader2,
  Info,
  DoorOpen,
  Settings,
  Wrench,
  ClipboardCheck,
  Users,
  ShieldCheck,
  Archive,
  RotateCcw,
} from 'lucide-react';
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

type SectionId =
  | 'overview'
  | 'rooms'
  | 'systems'
  | 'maintenance'
  | 'inspections'
  | 'contacts'
  | 'compliance';

const SECTIONS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'rooms', label: 'Rooms', icon: DoorOpen },
  { id: 'systems', label: 'Building Systems', icon: Settings },
  { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  { id: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  { id: 'contacts', label: 'Emergency Contacts', icon: Users },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
];

export default function FacilityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  const [activeSection, setActiveSection] = useState<SectionId>('overview');

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
      navigate('/facilities');
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
        <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (!facility) {
    return (
      <div className="text-center py-32">
        <Building2 className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
        <p className="text-theme-text-muted mb-4">Facility not found</p>
        <button
          onClick={() => navigate('/facilities')}
          className="btn-primary inline-flex gap-2 items-center"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Facilities
        </button>
      </div>
    );
  }

  const address = [facility.addressLine1, facility.city, facility.state, facility.zipCode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-0">
      <Breadcrumbs />
      {/* Top Bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/facilities')}
            className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
            aria-label="Back to facilities"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-theme-text-primary">{facility.name}</h1>
              <div className="flex items-center gap-2 text-sm text-theme-text-muted">
                {facility.facilityNumber && <span>{facility.facilityNumber}</span>}
                {facility.facilityNumber && address && <span>·</span>}
                {address && <span>{address}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status & Type badges */}
          {facility.facilityType && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-theme-surface-hover text-theme-text-muted">
              {facility.facilityType.name}
            </span>
          )}
          {facility.statusRecord && (
            <span
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{
                backgroundColor: facility.statusRecord.color
                  ? `${facility.statusRecord.color}20`
                  : undefined,
                color: facility.statusRecord.color || undefined,
              }}
            >
              {facility.statusRecord.name}
            </span>
          )}
          {facility.isArchived && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
              Archived
            </span>
          )}

          {/* Action buttons */}
          {facility.isArchived ? (
            <button
              onClick={() => {
                void handleRestore();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/10 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restore
            </button>
          ) : (
            <button
              onClick={() => {
                void handleArchive();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-theme-text-muted border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
            >
              <Archive className="w-3.5 h-3.5" /> Archive
            </button>
          )}
        </div>
      </div>

      {/* Main Layout: Sidebar + Content */}
      <div className="flex gap-6">
        {/* Sidebar Navigation */}
        <nav className="w-56 shrink-0" aria-label="Facility sections">
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl p-2 sticky top-6">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                      : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Content Area */}
        <div className="flex-1 min-w-0">
          {activeSection === 'overview' && (
            <OverviewSection
              facility={facility}
              facilityTypes={facilityTypes}
              facilityStatuses={facilityStatuses}
            />
          )}
          {activeSection === 'rooms' && <RoomsSection facilityId={facility.id} />}
          {activeSection === 'systems' && <SystemsSection facilityId={facility.id} />}
          {activeSection === 'maintenance' && <MaintenanceSection facilityId={facility.id} />}
          {activeSection === 'inspections' && <InspectionsSection facilityId={facility.id} />}
          {activeSection === 'contacts' && <ContactsSection facilityId={facility.id} />}
          {activeSection === 'compliance' && <ComplianceSection facilityId={facility.id} />}
        </div>
      </div>
    </div>
  );
}
