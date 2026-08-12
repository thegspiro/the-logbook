/**
 * Skill Sheet Library
 *
 * The starter sheets a department can copy into its own library, offered
 * because Skills Testing otherwise opens on an empty table and a New Template
 * button — and building an NREMT-style sheet from scratch is twenty minutes of
 * typing before the first candidate can be tested.
 *
 * A copy, not a subscription. What lands is the department's own template,
 * editable and publishable like any other; nothing here shifts under them when
 * the application updates. It lands as a **draft** deliberately: a published
 * template can be selected for a live evaluation, and a sheet nobody in the
 * department has read yet should not be.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, Download } from 'lucide-react';
import toast from 'react-hot-toast';

import { skillsTestingService } from '../../services/api';
import type { SkillSheetLibraryItem } from '../../types/skillsTesting';
import { getErrorMessage } from '../../utils/errorHandling';
import { Modal } from '../Modal';
import { Skeleton } from '../ux/Skeleton';

interface SkillSheetLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful import so the templates list picks up the new
   *  draft without a page reload. */
  onImported: () => void;
}

export const SkillSheetLibraryModal: React.FC<SkillSheetLibraryModalProps> = ({ isOpen, onClose, onImported }) => {
  const [sheets, setSheets] = useState<SkillSheetLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importingSlug, setImportingSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSheets(await skillsTestingService.getLibrarySheets());
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load the sheet library'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const handleImport = async (sheet: SkillSheetLibraryItem) => {
    setImportingSlug(sheet.slug);
    try {
      await skillsTestingService.importLibrarySheet(sheet.slug);
      toast.success(`${sheet.name} added as a draft`);
      // Reloaded rather than patched, so "already added" reflects what the
      // department now holds even if someone else imported in parallel.
      await load();
      onImported();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add the sheet'));
    } finally {
      setImportingSlug(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add from the sheet library" size="lg">
      <div className="modal-body space-y-3">
        <p className="text-theme-text-muted text-sm">
          Ready-made skill sheets you can copy into your department. Each arrives as a draft for you to review and
          adjust — publish it when it matches how you actually test.
        </p>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : (
          <ul className="space-y-2">
            {sheets.map((sheet) => (
              <li
                key={sheet.slug}
                className="border-theme-surface-border flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-theme-text-primary font-medium">{sheet.name}</p>
                  {sheet.description && <p className="text-theme-text-muted mt-0.5 text-sm">{sheet.description}</p>}
                  <div className="text-theme-text-muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {sheet.category && <span>{sheet.category}</span>}
                    <span>
                      {sheet.section_count} section{sheet.section_count === 1 ? '' : 's'}
                    </span>
                    <span>{sheet.criteria_count} steps</span>
                    {/* Statements are excluded from this count — they are read
                        aloud, not judged, and cannot fail anyone. */}
                    {sheet.critical_count > 0 && <span>{sheet.critical_count} critical</span>}
                    {sheet.passing_percentage != null && <span>{sheet.passing_percentage}% to pass</span>}
                  </div>
                </div>

                {sheet.already_imported ? (
                  <span className="text-theme-text-muted flex shrink-0 items-center gap-1.5 text-sm">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Already added
                  </span>
                ) : (
                  <button
                    onClick={() => void handleImport(sheet)}
                    disabled={importingSlug !== null}
                    className="mobile-touch-target flex shrink-0 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {importingSlug === sheet.slug ? (
                      'Adding…'
                    ) : (
                      <>
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Add
                      </>
                    )}
                  </button>
                )}
              </li>
            ))}
            {sheets.length === 0 && (
              <li className="text-theme-text-muted flex items-center gap-2 py-6 text-sm">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                No starter sheets are available.
              </li>
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default SkillSheetLibraryModal;
