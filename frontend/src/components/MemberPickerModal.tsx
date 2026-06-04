/**
 * Member Picker Modal
 *
 * A lightweight searchable list of members for quickly choosing who an
 * inventory operation should target. On selection it calls back with the
 * member's userId and display name so the caller can proceed (e.g. open the
 * InventoryScanModal to assign items).
 *
 * Members can be found by typing (with full keyboard navigation of the list)
 * or by scanning their digital ID badge via the camera scanner.
 *
 * Used by the Inventory Admin hub to let a quartermaster jump straight into
 * assigning items to an individual without navigating to the Members page.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Modal } from './Modal';
import { Search, User, Loader2, AlertTriangle, ScanLine } from 'lucide-react';
import { inventoryService, type MemberInventorySummary } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';
import { MemberIdScannerModal } from './MemberIdScannerModal';

interface SelectedMember {
  userId: string;
  memberName: string;
}

interface MemberPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (member: SelectedMember) => void;
  title?: string;
}

function memberDisplayName(m: MemberInventorySummary): string {
  return m.full_name || `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.username;
}

export const MemberPickerModal: React.FC<MemberPickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  title = 'Select a Member',
}) => {
  const [members, setMembers] = useState<MemberInventorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scannerOpen, setScannerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Load the member roster once each time the modal opens.
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setError(null);
      setScannerOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await inventoryService.getMembersSummary();
        if (!cancelled) setMembers(data.members);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load members.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Re-focus the search field after the Modal's own focus effect runs.
  useEffect(() => {
    if (!isOpen || scannerOpen) return undefined;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen, scannerOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...members].sort((a, b) =>
      memberDisplayName(a).localeCompare(memberDisplayName(b)),
    );
    if (!q) return sorted;
    return sorted.filter((m) => {
      const name = memberDisplayName(m).toLowerCase();
      return name.includes(q) || (m.membership_number ?? '').toLowerCase().includes(q)
        || m.username.toLowerCase().includes(q);
    });
  }, [members, search]);

  // Reset the keyboard highlight whenever the visible list changes.
  useEffect(() => { setActiveIndex(-1); }, [search]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (activeIndex < 0) return;
    // Optional call guards jsdom, which doesn't implement scrollIntoView.
    rowRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const handleSelect = useCallback((m: MemberInventorySummary) => {
    onSelect({ userId: m.user_id, memberName: memberDisplayName(m) });
  }, [onSelect]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // With nothing highlighted, a single match is the obvious choice.
      const target = activeIndex >= 0 ? filtered[activeIndex]
        : filtered.length === 1 ? filtered[0] : undefined;
      if (target) handleSelect(target);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen && !scannerOpen} onClose={onClose} title={title} size="md">
        <div className="space-y-3">
          {/* Search + scan */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search by name, username, or membership number..."
                className="form-input pl-9"
                aria-label="Search members"
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="btn-secondary btn-md flex items-center gap-2 shrink-0"
              title="Scan a member's digital ID card"
            >
              <ScanLine className="w-4 h-4" />
              <span className="hidden sm:inline">Scan ID</span>
            </button>
          </div>

          {/* Body */}
          {loading ? (
            <div className="flex items-center justify-center py-10" role="status" aria-live="polite">
              <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted mr-2" />
              <span className="text-sm text-theme-text-muted">Loading members...</span>
            </div>
          ) : error ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-theme-text-muted text-sm">
              {search ? 'No members match your search.' : 'No members found.'}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {filtered.map((m, i) => (
                <button
                  key={m.user_id}
                  ref={(el) => { rowRefs.current[i] = el; }}
                  type="button"
                  onClick={() => handleSelect(m)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    i === activeIndex
                      ? 'border-blue-500/40 bg-theme-surface-hover'
                      : 'border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover'
                  }`}
                >
                  <User className="w-5 h-5 text-theme-text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-theme-text-primary truncate">
                        {memberDisplayName(m)}
                      </span>
                      {m.membership_number && (
                        <span className="text-xs text-theme-text-muted">#{m.membership_number}</span>
                      )}
                    </div>
                    {m.total_items > 0 && (
                      <p className="text-xs text-theme-text-muted">
                        {m.total_items} item{m.total_items !== 1 ? 's' : ''} assigned
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Badge-scan path — resolves a scanned ID to the same selection callback */}
      <MemberIdScannerModal
        isOpen={isOpen && scannerOpen}
        onClose={() => setScannerOpen(false)}
        onMemberIdentified={(m) => { setScannerOpen(false); onSelect(m); }}
      />
    </>
  );
};

export default MemberPickerModal;
