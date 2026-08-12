/**
 * Facilities Dashboard — Landing page for the facilities module.
 *
 * Shows summary cards (total facilities, operational, overdue maintenance,
 * upcoming inspections), an action-items list, and a quick-access facility grid.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2,
  Plus,
  Printer,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Wrench,
  ArrowRight,
  Loader2,
  MapPin,
  Activity,
  Calendar,
  Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFacilitiesStore } from '../store/facilitiesStore';
import type { Facility } from '../types';
import CreateFacilityModal from '../components/CreateFacilityModal';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { facilitiesService } from '../../../services/api';
import { useFacilitiesAccess } from '../hooks/useFacilitiesAccess';

const PREVIEW_ITEM_COUNT = 5;

export default function FacilitiesDashboard() {
  const navigate = useNavigate();
  const tz = useTimezone();
  const { canCreate } = useFacilitiesAccess();
  const {
    facilities,
    facilityTypes,
    facilityStatuses,
    dashboardStats,
    isLoadingDashboard,
    error,
    loadDashboardStats,
    loadLookupData,
  } = useFacilitiesStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Facility[] | null>(null);

  const facilityMap = useMemo(() => new Map(facilities.map((f) => [f.id, f.name])), [facilities]);
  const getFacilityName = (id: string) => facilityMap.get(id) || 'Unknown';

  useEffect(() => {
    void loadDashboardStats();
    void loadLookupData();
  }, [loadDashboardStats, loadLookupData]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      void facilitiesService
        .getFacilities({ is_archived: false, search: query, limit: 100 })
        .then((results) => active && setSearchResults(results))
        .catch(() => active && toast.error('Failed to search facilities'));
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [searchQuery]);

  const handleFacilityClick = (facility: Facility) => {
    void navigate(`/facilities/${facility.id}`);
  };

  const stats = dashboardStats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-theme-text-primary text-3xl font-bold">Facilities</h1>
          <p className="text-theme-text-secondary mt-1">Manage stations, buildings, maintenance, and inspections</p>
        </div>
        <div className="flex items-center gap-2">
          {facilities.length > 0 && (
            <button
              onClick={() => void navigate(`/facilities/print-labels?ids=${facilities.map((f) => f.id).join(',')}`)}
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-secondary flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors"
            >
              <Printer className="h-4 w-4" />
              Print Labels
            </button>
          )}
          {canCreate && (
            <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-2 py-2.5">
              <Plus className="h-4 w-4" />
              Add Facility
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoadingDashboard && !stats ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={Building2}
              label="Total Facilities"
              value={stats?.totalFacilities ?? 0}
              subtext={`${stats?.operationalCount ?? 0} operational`}
              color="blue"
            />
            <SummaryCard
              icon={CheckCircle2}
              label="Operational"
              value={stats?.operationalCount ?? 0}
              subtext={
                stats?.totalFacilities
                  ? `${Math.round((stats.operationalCount / stats.totalFacilities) * 100)}% of total`
                  : 'No facilities'
              }
              color="emerald"
            />
            <SummaryCard
              icon={AlertTriangle}
              label="Overdue Maintenance"
              value={stats?.overdueMaintenanceCount ?? 0}
              subtext={stats?.overdueMaintenanceCount ? 'Action required' : 'All caught up'}
              color={stats?.overdueMaintenanceCount ? 'red' : 'emerald'}
              onClick={() => void navigate('/facilities/maintenance?status=overdue')}
            />
            <SummaryCard
              icon={ClipboardCheck}
              label="Upcoming Inspections"
              value={stats?.upcomingInspectionCount ?? 0}
              subtext="Next 30 days"
              color="amber"
              onClick={() => void navigate('/facilities/inspections')}
            />
          </div>

          {/* Action Items & Recent Activity */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Overdue Maintenance */}
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
              <div className="border-theme-surface-border flex items-center justify-between border-b p-5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <h2 className="text-theme-text-primary text-sm font-semibold">Overdue Maintenance</h2>
                </div>
                <button
                  onClick={() => void navigate('/facilities/maintenance?status=overdue')}
                  className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 text-xs transition-colors max-md:min-h-[44px]"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </button>
              </div>
              <div className="p-5">
                {!stats?.overdueMaintenanceRecords.length ? (
                  <div className="py-6 text-center">
                    <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
                    <p className="text-theme-text-muted text-sm">No overdue maintenance items</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.overdueMaintenanceRecords.slice(0, PREVIEW_ITEM_COUNT).map((record) => {
                      const facilityName = getFacilityName(record.facilityId);
                      return (
                        <div
                          key={record.id}
                          className="flex items-start gap-3 rounded-lg border border-red-500/10 bg-red-500/5 p-3"
                        >
                          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                          <div className="min-w-0 flex-1">
                            <p className="text-theme-text-primary truncate text-sm font-medium">
                              {record.description || 'Untitled maintenance'}
                            </p>
                            <div className="text-theme-text-muted mt-0.5 flex items-center gap-2 text-xs">
                              <span>{facilityName}</span>
                              {record.dueDate && (
                                <span className="font-medium text-red-500">Due: {formatDate(record.dueDate, tz)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming Inspections */}
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
              <div className="border-theme-surface-border flex items-center justify-between border-b p-5">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-amber-500" />
                  <h2 className="text-theme-text-primary text-sm font-semibold">Upcoming Inspections</h2>
                </div>
                <button
                  onClick={() => void navigate('/facilities/inspections')}
                  className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 text-xs transition-colors max-md:min-h-[44px]"
                >
                  View all <ArrowRight className="h-3 w-3" />
                </button>
              </div>
              <div className="p-5">
                {!stats?.upcomingInspections.length ? (
                  <div className="py-6 text-center">
                    <ClipboardCheck className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
                    <p className="text-theme-text-muted text-sm">No inspections in the next 30 days</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.upcomingInspections.slice(0, PREVIEW_ITEM_COUNT).map((insp) => {
                      const facilityName = getFacilityName(insp.facilityId);
                      return (
                        <div
                          key={insp.id}
                          className="flex items-start gap-3 rounded-lg border border-amber-500/10 bg-amber-500/5 p-3"
                        >
                          <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          <div className="min-w-0 flex-1">
                            <p className="text-theme-text-primary truncate text-sm font-medium">{insp.title}</p>
                            <div className="text-theme-text-muted mt-0.5 flex items-center gap-2 text-xs">
                              <span>{facilityName}</span>
                              {insp.nextInspectionDate && (
                                <span className="font-medium">{formatDate(insp.nextInspectionDate, tz)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          {stats?.recentActivity && stats.recentActivity.length > 0 && (
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
              <div className="border-theme-surface-border flex items-center gap-2 border-b p-5">
                <Activity className="text-theme-text-muted h-4 w-4" />
                <h2 className="text-theme-text-primary text-sm font-semibold">Recent Activity</h2>
              </div>
              <div className="divide-theme-surface-border divide-y">
                {stats.recentActivity.map((record) => {
                  const facilityName = getFacilityName(record.facilityId);
                  return (
                    <div key={record.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-theme-text-primary truncate text-sm">
                          {record.description || 'Maintenance completed'}
                        </p>
                        <p className="text-theme-text-muted text-xs">{facilityName}</p>
                      </div>
                      <span className="text-theme-text-muted shrink-0 text-xs">
                        {record.completedDate ? formatDate(record.completedDate, tz) : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Facility Grid */}
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-theme-text-primary text-lg font-semibold">All Facilities</h2>
              <div className="relative w-full sm:w-80">
                <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search name, number, or city"
                  aria-label="Search facilities"
                  className="form-input py-2 pr-3 pl-9"
                />
              </div>
            </div>

            {(searchResults ?? facilities).length === 0 ? (
              <div className="bg-theme-surface border-theme-surface-border rounded-xl border py-16 text-center">
                <Building2 className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
                <p className="text-theme-text-muted mb-4">
                  {searchQuery
                    ? 'No facilities match your search.'
                    : 'No facilities yet. Add your first facility to get started.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {(searchResults ?? facilities).map((facility) => (
                  <FacilityCard key={facility.id} facility={facility} onClick={handleFacilityClick} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Create Modal */}
      {canCreate && showCreateModal && (
        <CreateFacilityModal
          facilityTypes={facilityTypes}
          facilityStatuses={facilityStatuses}
          onClose={() => setShowCreateModal(false)}
          onCreated={(facility) => {
            setShowCreateModal(false);
            void navigate(`/facilities/${facility.id}`);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

interface SummaryCardProps {
  icon: React.ElementType;
  label: string;
  value: number;
  subtext: string;
  color: 'blue' | 'emerald' | 'red' | 'amber';
  onClick?: () => void;
}

const COLOR_MAP: Record<string, { bg: string; icon: string }> = {
  blue: { bg: 'bg-blue-500/10', icon: 'text-blue-500' },
  emerald: { bg: 'bg-emerald-500/10', icon: 'text-emerald-500' },
  red: { bg: 'bg-red-500/10', icon: 'text-red-500' },
  amber: { bg: 'bg-amber-500/10', icon: 'text-amber-500' },
};

function SummaryCard({ icon: Icon, label, value, subtext, color, onClick }: SummaryCardProps) {
  const colors = COLOR_MAP[color] ?? { bg: 'bg-blue-500/10', icon: 'text-blue-500' };
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`bg-theme-surface border-theme-surface-border rounded-xl border p-5 text-left transition-all ${
        onClick ? 'hover:border-theme-surface-border cursor-pointer hover:shadow-md' : ''
      }`}
    >
      <div className="mb-3 flex items-center gap-3">
        <div className={`h-9 w-9 rounded-lg ${colors.bg} flex items-center justify-center`}>
          <Icon className={`h-4.5 w-4.5 ${colors.icon}`} />
        </div>
        <span className="text-theme-text-muted text-xs font-medium tracking-wide uppercase">{label}</span>
      </div>
      <p className="text-theme-text-primary text-2xl font-bold">{value}</p>
      <p className="text-theme-text-muted mt-1 text-xs">{subtext}</p>
    </Wrapper>
  );
}

interface FacilityCardProps {
  facility: Facility;
  onClick: (facility: Facility) => void;
}

function FacilityCard({ facility, onClick }: FacilityCardProps) {
  const address = [facility.addressLine1, facility.city, facility.state].filter(Boolean).join(', ');

  return (
    <button
      onClick={() => onClick(facility)}
      className={`bg-theme-surface hover:border-theme-surface-border rounded-xl border p-5 text-left transition-all hover:shadow-md ${
        facility.isArchived ? 'border-amber-500/20 opacity-60' : 'border-theme-surface-border'
      }`}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
            <Building2 className="h-4.5 w-4.5 text-red-500" />
          </div>
          <div>
            <h3 className="text-theme-text-primary font-semibold">{facility.name}</h3>
            {facility.facilityNumber && <p className="text-theme-text-muted text-xs">{facility.facilityNumber}</p>}
          </div>
        </div>
        {facility.isArchived && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
            Archived
          </span>
        )}
      </div>

      {address && (
        <div className="text-theme-text-secondary mb-3 flex items-center gap-1.5 text-sm">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{address}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
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
      </div>
    </button>
  );
}
