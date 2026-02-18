/**
 * Apparatus Basic Page (Lightweight)
 *
 * Used when the full Apparatus module is NOT enabled.
 * Provides basic vehicle/unit definitions for use by shift scheduling,
 * training sessions, and other cross-module features.
 *
 * When the Apparatus module IS enabled, the full ApparatusPage handles
 * all vehicle management instead.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Truck, Plus, Search, Pencil, Trash2, Loader2, X, Save,
  Shield, Users, Wrench,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../services/api';

interface BasicApparatus {
  id: string;
  organization_id: string;
  unit_number: string;
  name: string;
  apparatus_type: string;
  station_id?: string;
  station_name?: string;
  min_staffing?: number;
  positions?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const APPARATUS_TYPES = [
  { value: 'engine', label: 'Engine', icon: '🚒' },
  { value: 'ladder', label: 'Ladder/Truck', icon: '🪜' },
  { value: 'ambulance', label: 'Ambulance/Medic', icon: '🚑' },
  { value: 'rescue', label: 'Rescue', icon: '🛟' },
  { value: 'tanker', label: 'Tanker', icon: '💧' },
  { value: 'brush', label: 'Brush/Wildland', icon: '🌲' },
  { value: 'quint', label: 'Quint', icon: '🚒' },
  { value: 'squad', label: 'Squad', icon: '🚐' },
  { value: 'hazmat', label: 'HazMat', icon: '☢️' },
  { value: 'command', label: 'Command', icon: '📡' },
  { value: 'utility', label: 'Utility', icon: '🔧' },
  { value: 'boat', label: 'Boat', icon: '🚤' },
  { value: 'other', label: 'Other', icon: '🚗' },
];

const POSITION_OPTIONS = [
  'officer', 'driver', 'firefighter', 'EMS', 'captain',
  'lieutenant', 'probationary', 'volunteer',
];

const DEFAULT_POSITIONS_BY_TYPE: Record<string, string[]> = {
  engine: ['officer', 'driver', 'firefighter', 'firefighter'],
  ladder: ['officer', 'driver', 'firefighter', 'firefighter'],
  ambulance: ['driver', 'EMS'],
  rescue: ['officer', 'driver', 'firefighter', 'firefighter'],
  tanker: ['driver', 'firefighter'],
  brush: ['driver', 'firefighter'],
  quint: ['officer', 'driver', 'firefighter', 'firefighter', 'firefighter'],
  squad: ['officer', 'driver', 'firefighter'],
  hazmat: ['officer', 'driver', 'firefighter', 'firefighter'],
  command: ['officer'],
  utility: ['driver'],
  boat: ['driver', 'firefighter'],
  other: ['driver'],
};

export default function ApparatusBasicPage() {
  const [apparatusList, setApparatusList] = useState<BasicApparatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BasicApparatus | null>(null);
  const [form, setForm] = useState({
    unit_number: '',
    name: '',
    apparatus_type: 'engine',
    min_staffing: 4,
    positions: ['officer', 'driver', 'firefighter', 'firefighter'] as string[],
  });
  const [isSaving, setIsSaving] = useState(false);

  const loadApparatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await schedulingService.getBasicApparatus();
      setApparatusList(data as unknown as BasicApparatus[]);
    } catch {
      toast.error('Failed to load apparatus');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadApparatus(); }, [loadApparatus]);

  const filtered = apparatusList.filter(a =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.unit_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.apparatus_type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openCreate = () => {
    setEditing(null);
    setForm({
      unit_number: '',
      name: '',
      apparatus_type: 'engine',
      min_staffing: 4,
      positions: [...DEFAULT_POSITIONS_BY_TYPE.engine],
    });
    setShowModal(true);
  };

  const openEdit = (apparatus: BasicApparatus) => {
    setEditing(apparatus);
    setForm({
      unit_number: apparatus.unit_number,
      name: apparatus.name,
      apparatus_type: apparatus.apparatus_type,
      min_staffing: apparatus.min_staffing || 1,
      positions: apparatus.positions || [],
    });
    setShowModal(true);
  };

  const handleTypeChange = (type: string) => {
    setForm(prev => ({
      ...prev,
      apparatus_type: type,
      positions: DEFAULT_POSITIONS_BY_TYPE[type] || ['driver'],
      min_staffing: (DEFAULT_POSITIONS_BY_TYPE[type] || ['driver']).length,
    }));
  };

  const addPosition = () => {
    setForm(prev => ({
      ...prev,
      positions: [...prev.positions, 'firefighter'],
    }));
  };

  const removePosition = (index: number) => {
    setForm(prev => ({
      ...prev,
      positions: prev.positions.filter((_, i) => i !== index),
    }));
  };

  const updatePosition = (index: number, value: string) => {
    setForm(prev => ({
      ...prev,
      positions: prev.positions.map((p, i) => i === index ? value : p),
    }));
  };

  const handleSave = async () => {
    if (!form.unit_number.trim()) { toast.error('Unit number is required'); return; }
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setIsSaving(true);
    try {
      const payload = {
        unit_number: form.unit_number.trim(),
        name: form.name.trim(),
        apparatus_type: form.apparatus_type,
        min_staffing: form.min_staffing,
        positions: form.positions,
      };
      if (editing) {
        await schedulingService.updateBasicApparatus(editing.id, payload);
        toast.success('Apparatus updated');
      } else {
        await schedulingService.createBasicApparatus(payload);
        toast.success('Apparatus added');
      }
      setShowModal(false);
      loadApparatus();
    } catch {
      toast.error('Failed to save apparatus');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (apparatus: BasicApparatus) => {
    if (!window.confirm(`Delete "${apparatus.name}" (${apparatus.unit_number})? This cannot be undone.`)) return;
    try {
      await schedulingService.deleteBasicApparatus(apparatus.id);
      toast.success('Apparatus deleted');
      loadApparatus();
    } catch {
      toast.error('Failed to delete apparatus');
    }
  };

  const getTypeInfo = (type: string) => APPARATUS_TYPES.find(t => t.value === type) || APPARATUS_TYPES[APPARATUS_TYPES.length - 1];
  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500';
  const labelCls = 'block text-sm font-medium text-theme-text-secondary mb-1';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-theme-text-primary">Apparatus & Vehicles</h1>
          <p className="text-theme-text-secondary mt-1">
            Define your department's vehicles and crew positions for shift scheduling
          </p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Apparatus
        </button>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
        <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-theme-text-secondary">
          <p>Apparatus defined here are available for shift scheduling. Each apparatus includes crew positions that determine how many members are needed to staff it per shift. Enable the full Apparatus module for maintenance tracking, equipment inventory, and more.</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search apparatus..."
          className="w-full pl-10 pr-4 py-2.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>

      {/* Apparatus List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" /></div>
      ) : filtered.length === 0 && !searchQuery ? (
        <div className="text-center py-20">
          <Truck className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-1">No apparatus defined</h3>
          <p className="text-theme-text-muted mb-4">
            Add your department's vehicles to start building shift assignments with crew positions.
          </p>
          <button onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add First Apparatus
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-theme-text-muted">No apparatus matching "{searchQuery}"</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(apparatus => {
            const typeInfo = getTypeInfo(apparatus.apparatus_type);
            return (
              <div key={apparatus.id} className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 group hover:border-theme-text-muted/30 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-lg flex-shrink-0">
                      {typeInfo.icon}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-theme-text-primary">{apparatus.name}</h3>
                      <p className="text-sm text-theme-text-secondary">{apparatus.unit_number}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(apparatus)} title="Edit"
                      className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(apparatus)} title="Delete"
                      className="p-2 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-theme-surface-hover rounded-lg text-theme-text-secondary">
                    <Wrench className="w-3 h-3" /> {typeInfo.label}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-theme-surface-hover rounded-lg text-theme-text-secondary">
                    <Users className="w-3 h-3" /> {apparatus.min_staffing || 0} crew
                  </span>
                </div>

                {apparatus.positions && apparatus.positions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {apparatus.positions.map((pos, i) => (
                      <span key={i} className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-700 dark:text-violet-400 rounded-full capitalize">
                        {pos}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true"
          onKeyDown={e => { if (e.key === 'Escape') setShowModal(false); }}
        >
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">
                {editing ? 'Edit Apparatus' : 'Add Apparatus'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Unit Number *</label>
                  <input type="text" value={form.unit_number} onChange={e => setForm(p => ({...p, unit_number: e.target.value}))}
                    placeholder="e.g., E-1, L-1, M-1" className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Name *</label>
                  <input type="text" value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))}
                    placeholder="e.g., Engine 1, Ladder 1" className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Apparatus Type</label>
                <select value={form.apparatus_type} onChange={e => handleTypeChange(e.target.value)}
                  className={inputCls}
                >
                  {APPARATUS_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelCls}>Minimum Staffing</label>
                <input type="number" min={1} max={20} value={form.min_staffing}
                  onChange={e => setForm(p => ({...p, min_staffing: Number(e.target.value)}))}
                  className={inputCls}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelCls}>Crew Positions</label>
                  <button type="button" onClick={addPosition}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Add Position
                  </button>
                </div>
                <div className="space-y-2">
                  {form.positions.map((pos, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-theme-text-muted w-6 text-right">{i + 1}.</span>
                      <select value={pos} onChange={e => updatePosition(i, e.target.value)}
                        className="flex-1 bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        {POSITION_OPTIONS.map(o => (
                          <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                        ))}
                      </select>
                      {form.positions.length > 1 && (
                        <button onClick={() => removePosition(i)} className="p-1.5 text-theme-text-muted hover:text-red-500 rounded transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={isSaving || !form.unit_number.trim() || !form.name.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editing ? 'Update' : 'Add Apparatus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
