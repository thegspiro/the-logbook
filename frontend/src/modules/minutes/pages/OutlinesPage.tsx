/**
 * Outlines: the department's standard order of business.
 *
 * Most departments run every meeting in the same order. An outline captures
 * that order, one per kind of meeting (or several, with one marked the
 * default). New minutes start from the default outline for their kind of
 * meeting, a draft can have another laid over it, and a section marked required
 * must have text before the minutes can be circulated.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, ListOrdered, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage } from '../../../utils/errorHandling';
import { OutlineEditorModal } from '../components/OutlineEditorModal';
import { MEETING_TYPE_OPTIONS } from '../utils/meetingTypes';
import { minutesService } from '../services/api';
import type { MinutesTemplate, TemplateListItem } from '../types/minutes';
import { GovernancePageHeader } from '../../../components/governance/GovernancePageHeader';

export const OutlinesPage: React.FC = () => {
  const { confirm } = useConfirm();
  const [outlines, setOutlines] = useState<TemplateListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MinutesTemplate | null>(null);
  const [copying, setCopying] = useState<MinutesTemplate | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const load = useCallback(async () => {
    try {
      setOutlines(await minutesService.getOutlines());
      setError(null);
    } catch (err: unknown) {
      setOutlines([]);
      setError(getErrorMessage(err, 'Failed to load the outlines'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (item: TemplateListItem, mode: 'edit' | 'copy') => {
    try {
      const full = await minutesService.getOutline(item.id);
      setEditing(mode === 'edit' ? full : null);
      setCopying(mode === 'copy' ? full : null);
      setShowEditor(true);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to open the outline'));
    }
  };

  const openNew = () => {
    setEditing(null);
    setCopying(null);
    setShowEditor(true);
  };

  const makeDefault = async (item: TemplateListItem) => {
    try {
      await minutesService.updateOutline(item.id, { is_default: true });
      toast.success(`${item.name} is now the default`);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to change the default'));
    }
  };

  const remove = async (item: TemplateListItem) => {
    const ok = await confirm({
      title: 'Delete this outline?',
      message: item.is_default
        ? `${item.name} is the default for its kind of meeting. Without one, new minutes start from the built-in order of business. Minutes already written are not changed.`
        : `${item.name} will be deleted. Minutes already written from it are not changed.`,
      confirmLabel: 'Delete outline',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await minutesService.deleteOutline(item.id);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete the outline'));
    }
  };

  const grouped = MEETING_TYPE_OPTIONS.map((t) => ({
    ...t,
    items: (outlines ?? []).filter((o) => o.meeting_type === t.value),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl">
        <GovernancePageHeader
          icon={ListOrdered}
          title="Meeting outlines"
          breadcrumbLabel="Outlines"
          subtitle="Your standard order of business. New minutes start from the default outline for their kind of meeting."
          actions={
            <button
              type="button"
              onClick={openNew}
              className="btn-primary touch:min-h-11 inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New outline
            </button>
          }
        />

        {error && (
          <p className="alert-danger mb-4 text-sm" role="alert">
            {error}
          </p>
        )}
        {outlines === null ? (
          <p className="text-theme-text-muted" role="status">
            Loading outlines…
          </p>
        ) : outlines.length === 0 && !error ? (
          <div className="card p-8 text-center">
            <p className="text-theme-text-secondary">No outlines yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <section key={group.value} aria-labelledby={`outlines-${group.value}`}>
                <h2 id={`outlines-${group.value}`} className="text-theme-text-primary mb-2 text-lg font-semibold">
                  {group.label}
                </h2>
                <ul className="space-y-2">
                  {group.items.map((item) => (
                    <li key={item.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="text-theme-text-primary font-medium">
                          {item.name}
                          {item.is_default && (
                            <span className="ml-2 rounded-sm bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-500/20 dark:text-green-400">
                              Default
                            </span>
                          )}
                        </p>
                        <p className="text-theme-text-muted text-xs">{item.section_count} sections</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!item.is_default && (
                          <button
                            type="button"
                            onClick={() => {
                              void makeDefault(item);
                            }}
                            className="btn-secondary touch:min-h-11 inline-flex items-center gap-1 text-sm"
                            aria-label={`Make ${item.name} the default`}
                          >
                            <Star className="h-4 w-4" aria-hidden="true" />
                            Make default
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            void open(item, 'edit');
                          }}
                          className="btn-secondary touch:min-h-11 inline-flex items-center gap-1 text-sm"
                          aria-label={`Edit ${item.name}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void open(item, 'copy');
                          }}
                          className="btn-secondary touch:min-h-11 inline-flex items-center gap-1 text-sm"
                          aria-label={`Duplicate ${item.name}`}
                        >
                          <Copy className="h-4 w-4" aria-hidden="true" />
                          Duplicate
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void remove(item);
                          }}
                          className="btn-icon text-red-600 hover:text-red-700"
                          aria-label={`Delete ${item.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <OutlineEditorModal
        isOpen={showEditor}
        outline={editing}
        copyFrom={copying}
        onClose={() => setShowEditor(false)}
        onSaved={load}
      />
    </div>
  );
};

export default OutlinesPage;
