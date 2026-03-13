/**
 * Event Templates Page
 *
 * Lists all event templates with create, edit, delete, and toggle active actions.
 * Accessible to users with events.manage permission.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FileText,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ArrowLeft,
  Clock,
} from 'lucide-react';
import { eventService } from '../services/api';
import type { EventTemplate, EventTemplateCreate } from '../types/event';
import { getEventTypeLabel } from '../utils/eventHelpers';
import { Breadcrumbs, EmptyState, ConfirmDialog } from '../components/ux';
import { EventTemplateForm } from '../components/EventTemplateForm';

export const EventTemplatesPage: React.FC = () => {
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form modal state
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EventTemplate | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<EventTemplate | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getTemplates(true);
      setTemplates(data);
    } catch {
      setError('Failed to load templates. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = () => {
    setEditingTemplate(null);
    setShowForm(true);
  };

  const handleEdit = (template: EventTemplate) => {
    setEditingTemplate(template);
    setShowForm(true);
  };

  const handleFormSubmit = async (data: EventTemplateCreate) => {
    setIsSubmitting(true);
    try {
      if (editingTemplate) {
        await eventService.updateTemplate(editingTemplate.id, data);
        toast.success('Template updated successfully');
      } else {
        await eventService.createTemplate(data);
        toast.success('Template created successfully');
      }
      setShowForm(false);
      setEditingTemplate(null);
      void fetchTemplates();
    } catch {
      toast.error(editingTemplate ? 'Failed to update template' : 'Failed to create template');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingTemplate(null);
  };

  const handleToggleActive = async (template: EventTemplate) => {
    try {
      await eventService.updateTemplate(template.id, {
        name: template.name,
        is_active: !template.is_active,
      } as EventTemplateCreate & { is_active: boolean });
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === template.id ? { ...t, is_active: !t.is_active } : t,
        ),
      );
      toast.success(
        template.is_active ? 'Template deactivated' : 'Template activated',
      );
    } catch {
      toast.error('Failed to update template status');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await eventService.deleteTemplate(deleteTarget.id);
      toast.success('Template deleted');
      setDeleteTarget(null);
      void fetchTemplates();
    } catch {
      toast.error('Failed to delete template');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs />
        <div className="mb-6">
          <div className="h-8 w-48 bg-theme-surface-hover rounded-sm animate-pulse mb-2" />
          <div className="h-4 w-80 bg-theme-surface-hover rounded-sm animate-pulse" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-6">
              <div className="h-5 w-40 bg-theme-surface-hover rounded-sm animate-pulse mb-3" />
              <div className="h-4 w-64 bg-theme-surface-hover rounded-sm animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => { void fetchTemplates(); }}
            className="mt-2 text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs />

        {/* Header */}
        <div className="mb-6">
          <Link
            to="/events"
            className="flex items-center text-theme-text-muted hover:text-theme-text-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" aria-hidden="true" />
            Back to Events
          </Link>
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-theme-text-primary flex items-center gap-3">
                <FileText className="w-7 h-7 text-red-700" aria-hidden="true" />
                Event Templates
              </h1>
              <p className="mt-1 text-sm text-theme-text-secondary">
                Create and manage reusable event templates to streamline event creation.
              </p>
            </div>
            <button
              onClick={handleCreate}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              New Template
            </button>
          </div>
        </div>

        {/* Template List */}
        {templates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description="Create your first event template to pre-fill common settings when creating events."
            actions={[
              {
                label: 'Create Template',
                onClick: handleCreate,
                icon: Plus,
              },
            ]}
            className="bg-theme-surface-secondary rounded-lg"
          />
        ) : (
          <div className="space-y-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className={`card p-5 transition-all ${
                  !template.is_active ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  {/* Template Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-medium text-theme-text-primary truncate">
                        {template.name}
                      </h3>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          template.is_active
                            ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400'
                        }`}
                      >
                        {template.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {template.description && (
                      <p className="text-sm text-theme-text-secondary mb-2 line-clamp-2">
                        {template.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-sm text-theme-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                        {getEventTypeLabel(template.event_type)}
                      </span>
                      {template.default_duration_minutes && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          {template.default_duration_minutes} min
                        </span>
                      )}
                      {template.requires_rsvp && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                          RSVP Required
                        </span>
                      )}
                      {template.is_mandatory && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                          Mandatory
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => { void handleToggleActive(template); }}
                      className="p-2 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                      title={template.is_active ? 'Deactivate template' : 'Activate template'}
                      aria-label={
                        template.is_active
                          ? `Deactivate ${template.name}`
                          : `Activate ${template.name}`
                      }
                    >
                      {template.is_active ? (
                        <ToggleRight className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      onClick={() => handleEdit(template)}
                      className="p-2 rounded-md text-theme-text-muted hover:text-blue-600 dark:hover:text-blue-400 hover:bg-theme-surface-hover transition-colors"
                      title="Edit template"
                      aria-label={`Edit ${template.name}`}
                    >
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(template)}
                      className="p-2 rounded-md text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-theme-surface-hover transition-colors"
                      title="Delete template"
                      aria-label={`Delete ${template.name}`}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Template Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto pt-8 pb-8" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/50" onClick={handleFormCancel} />
          <div className="relative bg-theme-surface-modal rounded-lg shadow-xl w-full max-w-3xl mx-4">
            <div className="px-6 py-4 border-b border-theme-surface-border">
              <h2 className="text-lg font-semibold text-theme-text-primary">
                {editingTemplate ? 'Edit Template' : 'Create Template'}
              </h2>
            </div>
            <div className="p-6 max-h-[calc(100vh-12rem)] overflow-y-auto">
              <EventTemplateForm
                initialData={editingTemplate ?? undefined}
                onSubmit={handleFormSubmit}
                onCancel={handleFormCancel}
                isSubmitting={isSubmitting}
                submitLabel={editingTemplate ? 'Update Template' : 'Create Template'}
              />
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Template"
        message={`Are you sure you want to delete "${deleteTarget?.name ?? ''}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={isDeleting}
        onConfirm={() => { void handleDeleteConfirm(); }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default EventTemplatesPage;
