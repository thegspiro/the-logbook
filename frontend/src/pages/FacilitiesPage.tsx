/**
 * Facilities Management Page
 *
 * Manage fire stations, buildings, rooms, maintenance records, and inspections.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Plus,
  Search,
  Filter,
  Wrench,
  ClipboardCheck,
  DoorOpen,
  Archive,
  RotateCcw,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ChevronRight,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../services/api';

interface FacilityType {
  id: string;
  name: string;
  description?: string;
}

interface FacilityStatus {
  id: string;
  name: string;
  color?: string;
}

interface Facility {
  id: string;
  name: string;
  address?: string;
  facility_type_id?: string;
  facility_type?: FacilityType;
  status_id?: string;
  status?: FacilityStatus;
  is_archived: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

type TabId = 'facilities' | 'maintenance' | 'inspections';

const STATUS_ICONS: Record<string, React.ElementType> = {
  active: CheckCircle2,
  maintenance: Wrench,
  inactive: Clock,
};

export default function FacilitiesPage() {
  const [activeTab, setActiveTab] = useState<TabId>('facilities');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityTypes, setFacilityTypes] = useState<FacilityType[]>([]);
  const [facilityStatuses, setFacilityStatuses] = useState<FacilityStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newFacility, setNewFacility] = useState({ name: '', address: '', facility_type_id: '', notes: '' });

  const loadFacilities = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, types, statuses] = await Promise.all([
        facilitiesService.getFacilities({ is_archived: showArchived }),
        facilitiesService.getTypes(),
        facilitiesService.getStatuses(),
      ]);
      setFacilities(data as unknown as Facility[]);
      setFacilityTypes(types as unknown as FacilityType[]);
      setFacilityStatuses(statuses as unknown as FacilityStatus[]);
    } catch {
      toast.error('Failed to load facilities');
    } finally {
      setIsLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    loadFacilities();
  }, [loadFacilities]);

  const handleCreate = async () => {
    if (!newFacility.name.trim()) {
      toast.error('Facility name is required');
      return;
    }
    setIsCreating(true);
    try {
      await facilitiesService.createFacility({
        name: newFacility.name.trim(),
        address: newFacility.address.trim() || undefined,
        facility_type_id: newFacility.facility_type_id || undefined,
        notes: newFacility.notes.trim() || undefined,
      });
      toast.success('Facility created');
      setShowCreateModal(false);
      setNewFacility({ name: '', address: '', facility_type_id: '', notes: '' });
      loadFacilities();
    } catch {
      toast.error('Failed to create facility');
    } finally {
      setIsCreating(false);
    }
  };

  const handleArchive = async (facility: Facility) => {
    try {
      await facilitiesService.archiveFacility(facility.id);
      toast.success(`${facility.name} archived`);
      loadFacilities();
      if (selectedFacility?.id === facility.id) setSelectedFacility(null);
    } catch {
      toast.error('Failed to archive facility');
    }
  };

  const handleRestore = async (facility: Facility) => {
    try {
      await facilitiesService.restoreFacility(facility.id);
      toast.success(`${facility.name} restored`);
      loadFacilities();
    } catch {
      toast.error('Failed to restore facility');
    }
  };

  const filtered = facilities.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.address?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
    { id: 'facilities', label: 'Facilities', icon: Building2 },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    { id: 'inspections', label: 'Inspections', icon: ClipboardCheck },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-theme-text-primary">Facilities</h1>
          <p className="text-theme-text-secondary mt-1">
            Manage stations, buildings, rooms, and maintenance
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Facility
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-theme-surface-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-red-500 text-red-700 dark:text-red-400'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Facilities Tab */}
      {activeTab === 'facilities' && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search facilities..."
                className="w-full pl-10 pr-4 py-2.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors ${
                showArchived
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <Filter className="w-4 h-4" />
              {showArchived ? 'Showing Archived' : 'Show Archived'}
            </button>
          </div>

          {/* Facility Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <Building2 className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
              <p className="text-theme-text-muted">
                {searchQuery ? 'No facilities match your search.' : 'No facilities yet. Add your first facility to get started.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((facility) => {
                const StatusIcon = STATUS_ICONS[facility.status?.name?.toLowerCase() ?? ''] ?? Building2;
                return (
                  <button
                    key={facility.id}
                    onClick={() => setSelectedFacility(facility)}
                    className={`text-left p-5 rounded-xl border transition-all hover:shadow-md ${
                      selectedFacility?.id === facility.id
                        ? 'border-red-500 bg-red-500/5'
                        : 'border-theme-surface-border bg-theme-surface hover:border-theme-surface-border'
                    } ${facility.is_archived ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-theme-text-muted" />
                        <h3 className="font-semibold text-theme-text-primary">{facility.name}</h3>
                      </div>
                      {facility.is_archived && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                          Archived
                        </span>
                      )}
                    </div>
                    {facility.address && (
                      <div className="flex items-center gap-1.5 text-sm text-theme-text-secondary mb-2">
                        <MapPin className="w-3.5 h-3.5" />
                        {facility.address}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      {facility.facility_type && (
                        <span className="text-xs px-2 py-1 rounded-full bg-theme-surface-hover text-theme-text-muted">
                          {facility.facility_type.name}
                        </span>
                      )}
                      {facility.status && (
                        <div className="flex items-center gap-1 text-xs text-theme-text-muted">
                          <StatusIcon className="w-3 h-3" />
                          {facility.status.name}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Detail Panel */}
          {selectedFacility && (
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-theme-text-primary">{selectedFacility.name}</h2>
                <div className="flex items-center gap-2">
                  {selectedFacility.is_archived ? (
                    <button
                      onClick={() => handleRestore(selectedFacility)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/10 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restore
                    </button>
                  ) : (
                    <button
                      onClick={() => handleArchive(selectedFacility)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-theme-text-muted border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Archive
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedFacility(null)}
                    className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              {selectedFacility.address && (
                <p className="flex items-center gap-2 text-sm text-theme-text-secondary mb-3">
                  <MapPin className="w-4 h-4" /> {selectedFacility.address}
                </p>
              )}
              {selectedFacility.notes && (
                <p className="text-sm text-theme-text-secondary mb-4">{selectedFacility.notes}</p>
              )}
              <div className="flex gap-3 pt-4 border-t border-theme-surface-border">
                <button className="flex items-center gap-2 px-3 py-2 text-sm text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors">
                  <DoorOpen className="w-4 h-4" />
                  Rooms
                  <ChevronRight className="w-3 h-3" />
                </button>
                <button className="flex items-center gap-2 px-3 py-2 text-sm text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors">
                  <Wrench className="w-4 h-4" />
                  Maintenance
                  <ChevronRight className="w-3 h-3" />
                </button>
                <button className="flex items-center gap-2 px-3 py-2 text-sm text-theme-text-secondary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors">
                  <ClipboardCheck className="w-4 h-4" />
                  Inspections
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Maintenance Tab */}
      {activeTab === 'maintenance' && (
        <div className="text-center py-20">
          <Wrench className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">Maintenance Records</h3>
          <p className="text-theme-text-muted">
            Track maintenance work orders, schedules, and history for all facilities.
          </p>
          <p className="text-sm text-theme-text-muted mt-2">
            Select a facility from the Facilities tab to view its maintenance records.
          </p>
        </div>
      )}

      {/* Inspections Tab */}
      {activeTab === 'inspections' && (
        <div className="text-center py-20">
          <ClipboardCheck className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">Inspections</h3>
          <p className="text-theme-text-muted">
            Manage inspection schedules, checklists, and compliance tracking.
          </p>
          <p className="text-sm text-theme-text-muted mt-2">
            Select a facility from the Facilities tab to view its inspections.
          </p>
        </div>
      )}

      {/* Create Facility Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-facility-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
        >
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 id="create-facility-title" className="text-lg font-bold text-theme-text-primary">Add Facility</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Name *</label>
                <input
                  type="text"
                  value={newFacility.name}
                  onChange={(e) => setNewFacility(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Station 1"
                  className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Address</label>
                <input
                  type="text"
                  value={newFacility.address}
                  onChange={(e) => setNewFacility(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="123 Main St"
                  className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              {facilityTypes.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Type</label>
                  <select
                    value={newFacility.facility_type_id}
                    onChange={(e) => setNewFacility(prev => ({ ...prev, facility_type_id: e.target.value }))}
                    className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">Select type...</option>
                    {facilityTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Notes</label>
                <textarea
                  value={newFacility.notes}
                  onChange={(e) => setNewFacility(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  placeholder="Optional notes..."
                  className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating || !newFacility.name.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                Add Facility
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
