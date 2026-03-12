/**
 * ItemDetailPage
 *
 * Full detail view for a single inventory item. Renders type-specific sections
 * based on the item's category item_type (electronics, uniform, PPE, etc.) and
 * tabbed panels for history, NFPA compliance, inspections, and exposures.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Printer, Pencil, User, MapPin, Calendar, Package,
  Clock, Wrench, Shield, AlertTriangle, ChevronRight, Loader2,
  Radio, Shirt, HardHat, Cog,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { locationsService } from '../../../services/facilitiesServices';
import type {
  InventoryItem, InventoryCategory, ItemHistoryEvent,
  MaintenanceRecord, NFPACompliance, NFPAExposureRecord,
  StorageAreaResponse, Location,
} from '../types';
import { getStatusStyle, getConditionColor } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { Modal } from '../../../components/Modal';
import { ItemFormModal } from '../components/ItemFormModal';
import { useTimezone } from '../../../hooks/useTimezone';
import toast from 'react-hot-toast';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type Tab = 'history' | 'nfpa' | 'inspections' | 'exposures';

const HISTORY_ICONS: Record<string, React.ReactNode> = {
  assignment: <User className="w-4 h-4 text-blue-500" />,
  return: <Package className="w-4 h-4 text-green-500" />,
  checkout: <ArrowLeft className="w-4 h-4 text-yellow-500" />,
  checkin: <Package className="w-4 h-4 text-green-500" />,
  issuance: <Shirt className="w-4 h-4 text-purple-500" />,
  issuance_return: <Package className="w-4 h-4 text-teal-500" />,
  maintenance: <Wrench className="w-4 h-4 text-orange-500" />,
};

function typeIcon(itemType: string) {
  switch (itemType) {
    case 'electronics': return <Radio className="w-5 h-5" />;
    case 'uniform': return <Shirt className="w-5 h-5" />;
    case 'ppe': return <HardHat className="w-5 h-5" />;
    default: return <Cog className="w-5 h-5" />;
  }
}

function fmtDate(iso: string | undefined | null, tz: string): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: tz,
  });
}

function fmtCurrency(val: number | undefined | null): string {
  if (val == null) return '--';
  return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function labelFor(condition: string): string {
  return ITEM_CONDITION_OPTIONS.find(o => o.value === condition)?.label ?? condition;
}

/* ------------------------------------------------------------------ */
/*  Card / Field components                                            */
/* ------------------------------------------------------------------ */

interface FieldProps { label: string; value: React.ReactNode }
const Field: React.FC<FieldProps> = ({ label, value }) => (
  <div>
    <dt className="text-xs text-theme-text-muted">{label}</dt>
    <dd className="mt-0.5 text-sm text-theme-text-primary">{value ?? '--'}</dd>
  </div>
);

interface CardProps { title: string; icon?: React.ReactNode; children: React.ReactNode }
const Card: React.FC<CardProps> = ({ title, icon, children }) => (
  <div className="card-secondary p-4">
    <h3 className="text-sm font-semibold text-theme-text-primary flex items-center gap-2 mb-3">
      {icon}{title}
    </h3>
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">{children}</dl>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

const ItemDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const tz = useTimezone();

  // Core state
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [category, setCategory] = useState<InventoryCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('history');
  const [history, setHistory] = useState<ItemHistoryEvent[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([]);
  const [nfpa, setNfpa] = useState<NFPACompliance | null>(null);
  const [exposures, setExposures] = useState<NFPAExposureRecord[]>([]);
  const [tabLoading, setTabLoading] = useState(false);

  // Location name resolution
  const [locationName, setLocationName] = useState<string | null>(null);

  // Edit modal data
  const [showEditModal, setShowEditModal] = useState(false);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [storageAreas, setStorageAreas] = useState<StorageAreaResponse[]>([]);

  // Assign modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const [assigning, setAssigning] = useState(false);

  const itemType = category?.item_type ?? 'equipment';
  const isNfpa = category?.nfpa_tracking_enabled === true;
  const hasMaintenance = category?.requires_maintenance === true;

  /* ---------- load item + category -------------------------------- */
  const loadItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [fetched, cats, locs, areas] = await Promise.all([
        inventoryService.getItem(id),
        inventoryService.getCategories(),
        locationsService.getLocations(),
        inventoryService.getStorageAreas({ flat: true }),
      ]);
      setItem(fetched);
      setCategories(cats);
      setLocations(locs);
      setStorageAreas(areas);
      const cat = cats.find(c => c.id === fetched.category_id) ?? null;
      setCategory(cat);
      // Resolve location name
      if (fetched.location_id) {
        const loc = locs.find((l: { id: string }) => l.id === fetched.location_id);
        setLocationName(loc?.name ?? null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load item'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadItem(); }, [loadItem]);

  /* ---------- load tab data --------------------------------------- */
  const loadTabData = useCallback(async (tab: Tab) => {
    if (!id) return;
    setTabLoading(true);
    try {
      if (tab === 'history') {
        const res = await inventoryService.getItemHistory(id);
        setHistory(res.events);
      } else if (tab === 'inspections') {
        const records = await inventoryService.getItemMaintenanceHistory(id);
        setMaintenance(records);
      } else if (tab === 'nfpa') {
        const data = await inventoryService.getNFPACompliance(id);
        setNfpa(data);
      } else if (tab === 'exposures') {
        const data = await inventoryService.getExposureRecords(id);
        setExposures(data);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, `Failed to load ${tab} data`));
    } finally {
      setTabLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadTabData(activeTab); }, [activeTab, loadTabData]);

  /* ---------- assign / unassign ----------------------------------- */
  const handleAssign = async () => {
    if (!id || !assignUserId.trim()) return;
    setAssigning(true);
    try {
      await inventoryService.assignItem(id, assignUserId.trim());
      toast.success('Item assigned');
      setShowAssignModal(false);
      setAssignUserId('');
      void loadItem();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to assign item'));
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async () => {
    if (!id) return;
    try {
      await inventoryService.unassignItem(id);
      toast.success('Item unassigned');
      void loadItem();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to unassign item'));
    }
  };

  /* ---------- loading / error ------------------------------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertTriangle className="w-10 h-10 mx-auto text-red-500 mb-3" />
        <p className="text-theme-text-primary font-medium">{error ?? 'Item not found'}</p>
        <Link to="/inventory/items" className="btn-info mt-4 inline-block text-sm">
          Back to Items
        </Link>
      </div>
    );
  }

  /* ---------- available tabs -------------------------------------- */
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'history', label: 'History', show: true },
    { key: 'nfpa', label: 'NFPA Compliance', show: isNfpa },
    { key: 'inspections', label: 'Inspections', show: hasMaintenance },
    { key: 'exposures', label: 'Exposures', show: isNfpa },
  ];
  const visibleTabs = tabs.filter(t => t.show);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center text-sm text-theme-text-muted gap-1">
        <Link to="/inventory" className="hover:text-theme-text-primary">Inventory</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <Link to="/inventory/items" className="hover:text-theme-text-primary">Items</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-theme-text-primary font-medium truncate max-w-[200px]">{item.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-theme-text-muted">{typeIcon(itemType)}</span>
          <h1 className="text-2xl font-bold text-theme-text-primary">{item.name}</h1>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${getStatusStyle(item.status)}`}>
            {item.status.replace('_', ' ')}
          </span>
          <span className={`text-xs font-medium ${getConditionColor(item.condition)}`}>
            {labelFor(item.condition)}
          </span>
          <span className="text-xs bg-theme-surface border border-theme-surface-border rounded px-1.5 py-0.5 text-theme-text-muted">
            {item.tracking_type === 'individual' ? 'Individual' : 'Pool'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/inventory/items"
            className="btn-secondary btn-sm inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <Link
            to={`/inventory/print-labels?ids=${id ?? ''}`}
            className="btn-secondary btn-sm inline-flex items-center gap-1"
          >
            <Printer className="w-4 h-4" /> Print Barcode
          </Link>
          <button
            onClick={() => setShowEditModal(true)}
            className="btn-info btn-sm inline-flex items-center gap-1"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
        </div>
      </div>

      {/* Detail cards grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Basic Info — always shown */}
        <Card title="Basic Info" icon={<Package className="w-4 h-4" />}>
          <Field label="Name" value={item.name} />
          <Field label="Category" value={category?.name ?? '--'} />
          <Field label="Tracking" value={item.tracking_type === 'individual' ? 'Individual' : 'Pool'} />
          <Field label="Status" value={item.status.replace('_', ' ')} />
          <Field label="Condition" value={labelFor(item.condition)} />
          <Field label="Description" value={item.description || '--'} />
          {item.notes && <Field label="Notes" value={item.notes} />}
        </Card>

        {/* Location — always shown */}
        <Card title="Location" icon={<MapPin className="w-4 h-4" />}>
          <Field label="Station" value={item.station || '--'} />
          <Field label="Location" value={locationName || item.location_id || '--'} />
          <Field label="Storage Area" value={item.storage_location || '--'} />
        </Card>

        {/* Identity — electronics, ppe, equipment, tool, vehicle */}
        {['electronics', 'ppe', 'equipment', 'tool', 'vehicle'].includes(itemType) && (
          <Card title="Identity" icon={<Shield className="w-4 h-4" />}>
            <Field label="Serial Number" value={item.serial_number || '--'} />
            <Field label="Model Number" value={item.model_number || '--'} />
            <Field label="Manufacturer" value={item.manufacturer || '--'} />
            {itemType !== 'ppe' && (
              <>
                <Field label="Asset Tag" value={item.asset_tag || '--'} />
                <Field label="Barcode" value={item.barcode || '--'} />
              </>
            )}
          </Card>
        )}

        {/* Financial — shown when any cost data exists, or for typical asset types */}
        {(item.purchase_price != null || item.current_value != null || item.replacement_cost != null || ['electronics', 'equipment', 'tool', 'vehicle'].includes(itemType)) && (
          <Card title="Financial" icon={<Calendar className="w-4 h-4" />}>
            <Field label="Purchase Price" value={fmtCurrency(item.purchase_price)} />
            <Field label="Current Value" value={fmtCurrency(item.current_value)} />
            <Field label="Replacement Cost" value={fmtCurrency(item.replacement_cost)} />
            <Field label="Purchase Date" value={fmtDate(item.purchase_date, tz)} />
            <Field label="Vendor" value={item.vendor || '--'} />
            <Field label="Warranty Exp." value={fmtDate(item.warranty_expiration, tz)} />
          </Card>
        )}

        {/* Physical — uniform, ppe */}
        {['uniform', 'ppe'].includes(itemType) && (
          <Card title="Physical" icon={<Shirt className="w-4 h-4" />}>
            <Field label="Standard Size" value={item.standard_size ? item.standard_size.toUpperCase() : '--'} />
            <Field label="Style" value={item.style ? item.style.replace(/_/g, ' ') : '--'} />
            <Field label="Size (legacy)" value={item.size || '--'} />
            <Field label="Color" value={item.color || '--'} />
          </Card>
        )}

        {/* Stock — uniform pool items */}
        {itemType === 'uniform' && item.tracking_type === 'pool' && (
          <Card title="Stock" icon={<Package className="w-4 h-4" />}>
            <Field label="Qty On Hand" value={item.quantity} />
            <Field label="Qty Issued" value={item.quantity_issued} />
            <Field label="Unit" value={item.unit_of_measure || '--'} />
          </Card>
        )}

        {/* Inspection — ppe or items with requires_maintenance */}
        {(itemType === 'ppe' || hasMaintenance) && (
          <Card title="Inspection" icon={<Wrench className="w-4 h-4" />}>
            <Field label="Last Inspection" value={fmtDate(item.last_inspection_date, tz)} />
            <Field label="Next Due" value={fmtDate(item.next_inspection_due, tz)} />
            <Field label="Interval (days)" value={item.inspection_interval_days ?? '--'} />
          </Card>
        )}

        {/* Assignment — individual items */}
        {item.tracking_type === 'individual' && (
          <Card title="Assignment" icon={<User className="w-4 h-4" />}>
            {item.assigned_to_user_id ? (
              <>
                <Field
                  label="Assigned To"
                  value={
                    <Link
                      to={`/members/${item.assigned_to_user_id}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {item.assigned_to_user_id}
                    </Link>
                  }
                />
                <Field label="Assigned Date" value={fmtDate(item.assigned_date, tz)} />
                <div className="col-span-full mt-1">
                  <button
                    onClick={() => void handleUnassign()}
                    className="btn-secondary btn-sm"
                  >
                    Unassign
                  </button>
                </div>
              </>
            ) : (
              <div className="col-span-full">
                <p className="text-sm text-theme-text-muted mb-2">Not currently assigned</p>
                <button
                  onClick={() => setShowAssignModal(true)}
                  className="btn-info btn-sm"
                >
                  Assign Item
                </button>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* ============================================================ */}
      {/*  Tabs                                                         */}
      {/* ============================================================ */}
      <div>
        <div className="flex border-b border-theme-surface-border gap-4">
          {visibleTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-[120px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
            </div>
          ) : (
            <>
              {activeTab === 'history' && <HistoryTab events={history} tz={tz} />}
              {activeTab === 'nfpa' && isNfpa && <NFPATab data={nfpa} tz={tz} />}
              {activeTab === 'inspections' && hasMaintenance && (
                <InspectionsTab records={maintenance} tz={tz} itemId={id ?? ''} />
              )}
              {activeTab === 'exposures' && isNfpa && <ExposuresTab records={exposures} tz={tz} />}
            </>
          )}
        </div>
      </div>

      {/* Assign Modal */}
      {showAssignModal && (
        <Modal isOpen={showAssignModal} onClose={() => setShowAssignModal(false)} title="Assign Item">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-theme-text-primary mb-1">User ID</label>
              <input
                type="text"
                value={assignUserId}
                onChange={e => setAssignUserId(e.target.value)}
                className="form-input w-full"
                placeholder="Enter user ID"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAssignModal(false)} className="btn-secondary btn-md">Cancel</button>
              <button
                onClick={() => void handleAssign()}
                disabled={assigning || !assignUserId.trim()}
                className="btn-info btn-md inline-flex items-center gap-1"
              >
                {assigning && <Loader2 className="w-4 h-4 animate-spin" />}
                Assign
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Item Modal */}
      <ItemFormModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSaved={() => void loadItem()}
        categories={categories}
        locations={locations}
        storageAreas={storageAreas}
        editItem={item}
      />
    </div>
  );
};

/* ================================================================== */
/*  Tab panels                                                         */
/* ================================================================== */

/* ----- History Tab ------------------------------------------------ */

interface HistoryTabProps { events: ItemHistoryEvent[]; tz: string }
const HistoryTab: React.FC<HistoryTabProps> = ({ events, tz }) => {
  if (events.length === 0) {
    return <p className="text-sm text-theme-text-muted py-4">No history events recorded.</p>;
  }
  return (
    <ul className="space-y-3">
      {events.map(evt => (
        <li key={evt.id} className="flex items-start gap-3 bg-theme-surface border border-theme-surface-border rounded-lg p-3">
          <span className="mt-0.5">{HISTORY_ICONS[evt.type] ?? <Clock className="w-4 h-4 text-theme-text-muted" />}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-theme-text-primary">{evt.summary}</span>
              <span className="text-xs text-theme-text-muted whitespace-nowrap">{fmtDate(evt.date, tz)}</span>
            </div>
            {evt.details && Object.keys(evt.details).length > 0 && (
              <p className="text-xs text-theme-text-muted mt-1 truncate">
                {Object.entries(evt.details).map(([k, v]) => { const s = (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ? String(v) : (v != null ? JSON.stringify(v) : ''); return `${k}: ${s}`; }).join(' | ')}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
};

/* ----- NFPA Tab --------------------------------------------------- */

interface NFPATabProps { data: NFPACompliance | null; tz: string }
const NFPATab: React.FC<NFPATabProps> = ({ data, tz }) => {
  if (!data) {
    return <p className="text-sm text-theme-text-muted py-4">No NFPA compliance data available.</p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card title="Lifecycle" icon={<Calendar className="w-4 h-4" />}>
        <Field label="Manufacture Date" value={fmtDate(data.manufacture_date, tz)} />
        <Field label="First In Service" value={fmtDate(data.first_in_service_date, tz)} />
        <Field label="Expected Retirement" value={fmtDate(data.expected_retirement_date, tz)} />
        <Field label="Retired by Age" value={data.is_retired_by_age ? 'Yes' : 'No'} />
        {data.retirement_reason && <Field label="Retirement Reason" value={data.retirement_reason} />}
      </Card>
      <Card title="Ensemble / SCBA" icon={<Shield className="w-4 h-4" />}>
        <Field label="Ensemble ID" value={data.ensemble_id || '--'} />
        <Field label="Ensemble Role" value={data.ensemble_role || '--'} />
        <Field label="Cylinder Mfg Date" value={fmtDate(data.cylinder_manufacture_date, tz)} />
        <Field label="Cylinder Exp." value={fmtDate(data.cylinder_expiration_date, tz)} />
        <Field label="Hydrostatic Test" value={fmtDate(data.hydrostatic_test_date, tz)} />
        <Field label="Hydrostatic Due" value={fmtDate(data.hydrostatic_test_due, tz)} />
        <Field label="Flow Test" value={fmtDate(data.flow_test_date, tz)} />
        <Field label="Flow Test Due" value={fmtDate(data.flow_test_due, tz)} />
      </Card>
      {data.contamination_level && (
        <Card title="Contamination" icon={<AlertTriangle className="w-4 h-4" />}>
          <Field label="Level" value={data.contamination_level} />
        </Card>
      )}
    </div>
  );
};

/* ----- Inspections Tab -------------------------------------------- */

interface InspectionsTabProps {
  records: MaintenanceRecord[];
  tz: string;
  itemId: string;
}
const InspectionsTab: React.FC<InspectionsTabProps> = ({ records, tz, itemId }) => (
  <div>
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-theme-text-primary">Maintenance Records</h3>
      <Link to={`/inventory/maintenance?item=${itemId}`} className="btn-info btn-sm">
        + Add Record
      </Link>
    </div>
    {records.length === 0 ? (
      <p className="text-sm text-theme-text-muted py-4">No maintenance records found.</p>
    ) : (
      <div className="space-y-2">
        {records.map(rec => (
          <div key={rec.id} className="card-secondary p-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-theme-text-primary">
                {rec.maintenance_type.replace('_', ' ')}{' '}
                {rec.passed != null && (
                  <span className={rec.passed ? 'text-green-600' : 'text-red-600'}>
                    ({rec.passed ? 'Passed' : 'Failed'})
                  </span>
                )}
              </p>
              {rec.description && <p className="text-xs text-theme-text-muted mt-0.5">{rec.description}</p>}
              {rec.performed_by && <p className="text-xs text-theme-text-muted">By: {rec.performed_by}</p>}
            </div>
            <div className="text-right text-xs text-theme-text-muted whitespace-nowrap">
              <p>{rec.completed_date ? fmtDate(rec.completed_date, tz) : 'Pending'}</p>
              {rec.cost != null && <p>{fmtCurrency(rec.cost)}</p>}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

/* ----- Exposures Tab ---------------------------------------------- */

interface ExposuresTabProps { records: NFPAExposureRecord[]; tz: string }
const ExposuresTab: React.FC<ExposuresTabProps> = ({ records, tz }) => (
  <div>
    <h3 className="text-sm font-semibold text-theme-text-primary mb-3">Exposure Log</h3>
    {records.length === 0 ? (
      <p className="text-sm text-theme-text-muted py-4">No exposure records found.</p>
    ) : (
      <div className="space-y-2">
        {records.map(rec => (
          <div key={rec.id} className="card-secondary p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-theme-text-primary">
                {rec.exposure_type.replace('_', ' ')}
              </span>
              <span className="text-xs text-theme-text-muted">{fmtDate(rec.exposure_date, tz)}</span>
            </div>
            {rec.incident_number && (
              <p className="text-xs text-theme-text-muted mt-0.5">Incident: {rec.incident_number}</p>
            )}
            {rec.description && (
              <p className="text-xs text-theme-text-muted mt-0.5">{rec.description}</p>
            )}
            <div className="flex gap-3 mt-1 text-xs">
              <span className={rec.decon_required ? 'text-orange-600' : 'text-theme-text-muted'}>
                Decon: {rec.decon_required ? 'Required' : 'Not required'}
              </span>
              {rec.decon_required && (
                <span className={rec.decon_completed ? 'text-green-600' : 'text-red-600'}>
                  {rec.decon_completed ? `Completed ${fmtDate(rec.decon_completed_date, tz)}` : 'Pending'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default ItemDetailPage;
