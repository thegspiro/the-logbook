/**
 * Member Picker Modal
 *
 * A lightweight searchable list of members for quickly choosing who an
 * inventory operation should target. On selection it calls back with the
 * member's userId and display name so the caller can proceed (e.g. open the
 * InventoryScanModal to assign items).
 *
 * Used by the Inventory Admin hub to let a quartermaster jump straight into
 * assigning items to an individual without navigating to the Members page.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Modal } from './Modal';
import { Search, User, Loader2, AlertTriangle } from 'lucide-react';
import { inventoryService, type MemberInventorySummary } from '../services/api';
import { getErrorMessage } from '../utils/errorHandling';

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
  const searchRef = useRef<HTMLInputElement>(null);

  // Load the member roster once each time the modal opens.
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setError(null);
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
    if (!isOpen) return undefined;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

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

  const handleSelect = (m: MemberInventorySummary) => {
    onSelect({ userId: m.user_id, memberName: memberDisplayName(m) });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, username, or membership number..."
            className="form-input pl-9"
            aria-label="Search members"
            autoComplete="off"
          />
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
            {filtered.map((m) => (
              <button
                key={m.user_id}
                type="button"
                onClick={() => handleSelect(m)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-theme-surface-border bg-theme-surface text-left hover:bg-theme-surface-hover transition-colors"
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
  );
};

export default MemberPickerModal;
