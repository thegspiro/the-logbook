/**
 * CategoriesTab Component
 *
 * Category list with inline create/edit form. Displays all admin hours
 * categories with options to create, edit, deactivate, and view QR codes.
 */

import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, QrCode, Clock, AlertTriangle, Download } from 'lucide-react';
import { useAdminHoursStore } from '../store/adminHoursStore';
import { adminHoursEntryService, adminHoursSeedService } from '../services/api';
import type { AdminHoursCategory, AdminHoursCategoryCreate, AdminHoursCategoryUpdate } from '../types';
import CategoryForm from './CategoryForm';
import toast from 'react-hot-toast';

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

interface CategoriesTabProps {
  onDataReload: () => void;
}

const CategoriesTab: React.FC<CategoriesTabProps> = ({ onDataReload }) => {
  const categories = useAdminHoursStore((s) => s.categories);
  const categoriesLoading = useAdminHoursStore((s) => s.categoriesLoading);
  const createCategory = useAdminHoursStore((s) => s.createCategory);
  const updateCategory = useAdminHoursStore((s) => s.updateCategory);
  const deleteCategory = useAdminHoursStore((s) => s.deleteCategory);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminHoursCategory | null>(null);
  const [formData, setFormData] = useState<AdminHoursCategoryCreate>({
    name: '',
    description: '',
    color: DEFAULT_COLORS[0],
    require_approval: true,
    auto_approve_under_hours: null,
    max_hours_per_session: 12,
    sort_order: 0,
  });

  const resetForm = useCallback(() => {
    setFormData({
      name: '',
      description: '',
      color: DEFAULT_COLORS[categories.length % DEFAULT_COLORS.length],
      require_approval: true,
      auto_approve_under_hours: null,
      max_hours_per_session: 12,
      sort_order: categories.length,
    });
    setShowCreateForm(false);
    setEditingCategory(null);
  }, [categories.length]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createCategory(formData);
      toast.success('Category created');
      resetForm();
    } catch {
      // error handled by store
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;
    const updateData: AdminHoursCategoryUpdate = {
      name: formData.name,
      description: formData.description || null,
      color: formData.color || undefined,
      require_approval: formData.require_approval,
      auto_approve_under_hours: formData.auto_approve_under_hours,
      max_hours_per_session: formData.max_hours_per_session,
      sort_order: formData.sort_order,
    };
    try {
      await updateCategory(editingCategory.id, updateData);
      toast.success('Category updated');
      resetForm();
    } catch {
      // error handled by store
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to deactivate this category?')) return;
    try {
      await deleteCategory(id);
      toast.success('Category deactivated');
    } catch {
      // error handled by store
    }
  };

  const startEdit = (cat: AdminHoursCategory) => {
    setEditingCategory(cat);
    setFormData({
      name: cat.name,
      description: cat.description ?? '',
      color: cat.color ?? DEFAULT_COLORS[0],
      require_approval: cat.requireApproval,
      auto_approve_under_hours: cat.autoApproveUnderHours,
      max_hours_per_session: cat.maxHoursPerSession,
      sort_order: cat.sortOrder,
    });
    setShowCreateForm(true);
  };

  const [seeding, setSeeding] = useState(false);

  const handleSeedDefaults = async () => {
    try {
      setSeeding(true);
      const result = await adminHoursSeedService.seedDefaults();
      toast.success(`Created ${result.categories_count} categories and ${result.mappings_created} event mappings`);
      onDataReload();
    } catch {
      toast.error('Failed to load default categories');
    } finally {
      setSeeding(false);
    }
  };

  const handleCloseStaleSessions = async () => {
    try {
      const result = await adminHoursEntryService.closeStaleSessions();
      if (result.closedCount > 0) {
        toast.success(`${result.closedCount} stale sessions closed`);
        onDataReload();
      } else {
        toast.success('No stale sessions found');
      }
    } catch {
      toast.error('Failed to close stale sessions');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-theme-text-primary">Hour Categories</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { void handleCloseStaleSessions(); }}
            className="flex items-center gap-2 px-3 py-2 bg-theme-surface text-theme-text-secondary rounded-lg border border-theme-surface-border hover:bg-theme-surface-hover transition text-sm"
            title="Auto-close any sessions that exceeded their max hours limit"
          >
            <AlertTriangle className="w-4 h-4" />
            Close Stale Sessions
          </button>
          <button
            onClick={() => { resetForm(); setShowCreateForm(true); }}
            className="btn-info flex gap-2 items-center transition"
          >
            <Plus className="w-4 h-4" />
            Add Category
          </button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showCreateForm && (
        <CategoryForm
          formData={formData}
          onChange={setFormData}
          onSubmit={editingCategory ? (e) => { void handleUpdate(e); } : (e) => { void handleCreate(e); }}
          isEditing={!!editingCategory}
          onCancel={resetForm}
        />
      )}

      {/* Categories List */}
      {categoriesLoading ? (
        <div className="text-center py-8 text-theme-text-secondary">Loading categories...</div>
      ) : categories.length === 0 ? (
        <div className="text-center py-12 bg-theme-surface rounded-lg">
          <Clock className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-secondary mb-4">No categories yet. Load defaults or create your own.</p>
          <button
            onClick={() => { void handleSeedDefaults(); }}
            disabled={seeding}
            className="btn-primary flex items-center gap-2 mx-auto text-sm"
          >
            <Download className="w-4 h-4" />
            {seeding ? 'Loading...' : 'Load Default Categories'}
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {categories.map((cat) => (
            <div key={cat.id} className="bg-theme-surface rounded-lg shadow-md p-4 flex items-center gap-4">
              <div
                className="w-4 h-4 rounded-full shrink-0"
                style={{ backgroundColor: cat.color ?? '#6B7280' }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-theme-text-primary">{cat.name}</h3>
                  {!cat.isActive && (
                    <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full">Inactive</span>
                  )}
                </div>
                {cat.description && (
                  <p className="text-sm text-theme-text-secondary mt-0.5 truncate">{cat.description}</p>
                )}
                <div className="flex gap-4 text-xs text-theme-text-muted mt-1">
                  <span>Approval: {cat.requireApproval ? 'Required' : 'Auto-approve'}</span>
                  {cat.autoApproveUnderHours && (
                    <span>Auto-approve under {cat.autoApproveUnderHours}h</span>
                  )}
                  {cat.maxHoursPerSession && (
                    <span>Max {cat.maxHoursPerSession}h/session</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/admin-hours/categories/${cat.id}/qr-code`}
                  className="p-2 text-theme-text-secondary hover:text-blue-500 transition"
                  title="View QR Code"
                >
                  <QrCode className="w-5 h-5" />
                </Link>
                <button
                  onClick={() => startEdit(cat)}
                  className="p-2 text-theme-text-secondary hover:text-blue-500 transition"
                  title="Edit"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {cat.isActive && (
                  <button
                    onClick={() => { void handleDelete(cat.id); }}
                    className="p-2 text-theme-text-secondary hover:text-red-500 transition"
                    title="Deactivate"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CategoriesTab;
