/**
 * Event Templates Page
 *
 * Lists all event templates with create, edit, delete, and toggle active actions.
 * Accessible to users with events.manage permission.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { FileText, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ArrowLeft, Clock } from 'lucide-react';
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
      setTemplates((prev) => prev.map((t) => (t.id === template.id ? { ...t, is_active: !t.is_active } : t)));
      toast.success(template.is_active ? 'Template deactivated' : 'Template activated');
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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />
        <div className="mb-6">
          <div className="bg-theme-surface-hover mb-2 h-8 w-48 animate-pulse rounded-sm" />
          <div className="bg-theme-surface-hover h-4 w-80 animate-pulse rounded-sm" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-6">
              <div className="bg-theme-surface-hover mb-3 h-5 w-40 animate-pulse rounded-sm" />
              <div className="bg-theme-surface-hover h-4 w-64 animate-pulse rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => {
              void fetchTemplates();
            }}
            className="mt-2 text-sm text-red-700 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />

        {/* Header */}
        <div className="mb-6">
          <Link
            to="/events"
            className="text-theme-text-muted hover:text-theme-text-primary mb-4 flex items-center transition-colors"
          >
            <ArrowLeft className="mr-2 h-5 w-5" aria-hidden="true" />
            Back to Events
          </Link>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-theme-text-primary flex items-center gap-3 text-2xl font-bold sm:text-3xl">
                <FileText className="h-7 w-7 text-red-700" aria-hidden="true" />
                Event Templates
              </h1>
              <p className="text-theme-text-secondary mt-1 text-sm">
                Create and manage reusable event templates to streamline event creation.
              </p>
            </div>
            <button onClick={handleCreate} className="btn-primary inline-flex items-center gap-2">
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
              <div key={template.id} className={`card p-5 transition-all ${!template.is_active ? 'opacity-60' : ''}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  {/* Template Info */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h3 className="text-theme-text-primary truncate text-lg font-medium">{template.name}</h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          template.is_active
                            ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400'
                        }`}
                      >
                        {template.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {template.description && (
                      <p className="text-theme-text-secondary mb-2 line-clamp-2 text-sm">{template.description}</p>
                    )}
                    <div className="text-theme-text-muted flex flex-wrap items-center gap-3 text-sm">
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
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                          RSVP Required
                        </span>
                      )}
                      {template.is_mandatory && (
                        <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                          Mandatory
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => {
                        void handleToggleActive(template);
                      }}
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-md p-2 transition-colors"
                      title={template.is_active ? 'Deactivate template' : 'Activate template'}
                      aria-label={template.is_active ? `Deactivate ${template.name}` : `Activate ${template.name}`}
                    >
                      {template.is_active ? (
                        <ToggleRight className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      onClick={() => handleEdit(template)}
                      className="text-theme-text-muted hover:bg-theme-surface-hover rounded-md p-2 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                      title="Edit template"
                      aria-label={`Edit ${template.name}`}
                    >
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(template)}
                      className="text-theme-text-muted hover:bg-theme-surface-hover rounded-md p-2 transition-colors hover:text-red-600 dark:hover:text-red-400"
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
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto pt-8 pb-8"
          role="dialog"
          aria-modal="true"
        >
          <div className="fixed inset-0 bg-black/50" onClick={handleFormCancel} aria-hidden="true" />
          <div className="bg-theme-surface-modal relative mx-4 w-full max-w-3xl rounded-lg shadow-xl">
            <div className="border-theme-surface-border border-b px-6 py-4">
              <h2 className="text-theme-text-primary text-lg font-semibold">
                {editingTemplate ? 'Edit Template' : 'Create Template'}
              </h2>
            </div>
            <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-6">
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
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default EventTemplatesPage;
