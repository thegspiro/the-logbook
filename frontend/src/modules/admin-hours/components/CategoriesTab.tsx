/**
 * CategoriesTab Component
 *
 * Category list with inline create/edit form. Displays all admin hours
 * categories with options to create, edit, deactivate, and view QR codes.
 */

import React, { useState, useCallback } from 'react';
import { Link } from 'react-router';
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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-theme-text-primary text-xl font-semibold">Hour Categories</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              void handleCloseStaleSessions();
            }}
            className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition"
            title="Auto-close any sessions that exceeded their max hours limit"
          >
            <AlertTriangle className="h-4 w-4" />
            Close Stale Sessions
          </button>
          <button
            onClick={() => {
              resetForm();
              setShowCreateForm(true);
            }}
            className="btn-info flex items-center gap-2 transition"
          >
            <Plus className="h-4 w-4" />
            Add Category
          </button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {showCreateForm && (
        <CategoryForm
          formData={formData}
          onChange={setFormData}
          onSubmit={
            editingCategory
              ? (e) => {
                  void handleUpdate(e);
                }
              : (e) => {
                  void handleCreate(e);
                }
          }
          isEditing={!!editingCategory}
          onCancel={resetForm}
        />
      )}

      {/* Categories List */}
      {categoriesLoading ? (
        <div className="text-theme-text-secondary py-8 text-center">Loading categories...</div>
      ) : categories.length === 0 ? (
        <div className="bg-theme-surface rounded-lg py-12 text-center">
          <Clock className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-secondary mb-4">No categories yet. Load defaults or create your own.</p>
          <button
            onClick={() => {
              void handleSeedDefaults();
            }}
            disabled={seeding}
            className="btn-primary mx-auto flex items-center gap-2 text-sm"
          >
            <Download className="h-4 w-4" />
            {seeding ? 'Loading...' : 'Load Default Categories'}
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {categories.map((cat) => (
            <div key={cat.id} className="bg-theme-surface flex items-center gap-4 rounded-lg p-4 shadow-md">
              <div className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: cat.color ?? '#6B7280' }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-theme-text-primary font-semibold">{cat.name}</h3>
                  {!cat.isActive && (
                    <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-700 dark:text-red-400">
                      Inactive
                    </span>
                  )}
                </div>
                {cat.description && (
                  <p className="text-theme-text-secondary mt-0.5 truncate text-sm">{cat.description}</p>
                )}
                <div className="text-theme-text-muted mt-1 flex gap-4 text-xs">
                  <span>Approval: {cat.requireApproval ? 'Required' : 'Auto-approve'}</span>
                  {cat.autoApproveUnderHours && <span>Auto-approve under {cat.autoApproveUnderHours}h</span>}
                  {cat.maxHoursPerSession && <span>Max {cat.maxHoursPerSession}h/session</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/admin-hours/categories/${cat.id}/qr-code`}
                  className="text-theme-text-secondary p-2 transition hover:text-blue-500"
                  title="View QR Code"
                >
                  <QrCode className="h-5 w-5" />
                </Link>
                <button
                  onClick={() => startEdit(cat)}
                  className="text-theme-text-secondary p-2 transition hover:text-blue-500"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {cat.isActive && (
                  <button
                    onClick={() => {
                      void handleDelete(cat.id);
                    }}
                    className="text-theme-text-secondary p-2 transition hover:text-red-500"
                    title="Deactivate"
                  >
                    <Trash2 className="h-4 w-4" />
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
