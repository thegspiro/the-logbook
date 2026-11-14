import React, { useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import RegistryImportModal from '../../pages/RegistryImportModal';
import { isSafeExternalUrl } from '@/utils/safeUrl';
import type { RegistryInfo } from '../../types/training';

interface RegistryImportPanelProps {
  /** The registries the backend lists; empty while loading or if the listing failed. */
  registries: RegistryInfo[];
  onImported: () => void;
}

/**
 * The "Import from Registry" panel and the import dialog it opens.
 *
 * Shared by the Training Administration hub's Requirements tab and the
 * standalone programs page's Requirements view, so the two cannot drift.
 * Listing and importing a registry are both training.manage-gated: render this
 * only for a caller who holds that permission.
 */
export const RegistryImportPanel: React.FC<RegistryImportPanelProps> = ({ registries, onImported }) => {
  const [registryModal, setRegistryModal] = useState<{ key: string; name: string } | null>(null);

  return (
    <>
      <div className="bg-theme-surface-secondary mt-6 rounded-lg p-6">
        <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Import from Registry</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(registries.length > 0
            ? registries
            : [
                { key: 'nfpa', name: 'NFPA', description: '', requirement_count: 0 },
                { key: 'proboard', name: 'Pro Board', description: '', requirement_count: 0 },
                { key: 'emr', name: 'NREMT — EMR', description: '', requirement_count: 0 },
                { key: 'emt', name: 'NREMT — EMT', description: '', requirement_count: 0 },
                { key: 'aemt', name: 'NREMT — Advanced EMT (AEMT)', description: '', requirement_count: 0 },
                { key: 'paramedic', name: 'NREMT — Paramedic', description: '', requirement_count: 0 },
              ]
          ).map((registry) => (
            // The source link sits beside the import button, not inside it: a
            // link within a button is two controls in one (axe
            // nested-interactive), and its tap target was a line of small
            // text (forms review F-11).
            <div
              key={registry.key}
              className="bg-theme-surface text-theme-text-primary flex flex-col items-center rounded-lg px-4 py-3"
            >
              <button
                type="button"
                onClick={() => setRegistryModal({ key: registry.key, name: registry.name })}
                className="hover:bg-theme-surface-hover touch:min-h-11 flex w-full flex-col items-center justify-center rounded-md py-1"
              >
                <span className="flex items-center space-x-2">
                  <Download className="h-5 w-5" aria-hidden="true" />
                  <span>Import {registry.name}</span>
                </span>
                {registry.last_updated && (
                  <span className="text-theme-text-muted mt-1 text-xs">Updated {registry.last_updated}</span>
                )}
                {registry.requirement_count > 0 && (
                  <span className="text-theme-text-muted text-xs">{registry.requirement_count} requirements</span>
                )}
              </button>
              {registry.source_url && isSafeExternalUrl(registry.source_url) && (
                <a
                  href={registry.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex min-h-6 items-center space-x-1 px-2 text-xs text-blue-800 hover:underline dark:text-blue-300"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  <span>Source</span>
                </a>
              )}
            </div>
          ))}
        </div>
      </div>

      {registryModal && (
        <RegistryImportModal
          registryKey={registryModal.key}
          registryName={registryModal.name}
          onClose={() => setRegistryModal(null)}
          onImported={onImported}
        />
      )}
    </>
  );
};
