/**
 * Command Palette / Global Search Component (#18)
 *
 * Application-wide search and quick navigation.
 * Activated via Cmd+K (Mac) or Ctrl+K (Windows/Linux).
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Calendar,
  Users,
  GraduationCap,
  Package,
  Clock,
  Settings,
  FileText,
  Bell,
  BarChart3,
  Building2,
  Vote,
  ClipboardList,
  Home,
  X,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  path: string;
  icon: React.ElementType;
  section: string;
  keywords?: string[];
  permission?: string;
}

const COMMANDS: CommandItem[] = [
  // Navigation
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: Home, section: 'Navigation', keywords: ['home'] },
  { id: 'members', label: 'Members', path: '/members', icon: Users, section: 'Navigation', keywords: ['people', 'roster'] },
  { id: 'events', label: 'Events', path: '/events', icon: Calendar, section: 'Navigation', keywords: ['meetings', 'calendar'] },
  { id: 'training', label: 'My Training', path: '/training/my-training', icon: GraduationCap, section: 'Navigation', keywords: ['courses', 'certifications'] },
  { id: 'inventory', label: 'Inventory', path: '/inventory', icon: Package, section: 'Navigation', keywords: ['equipment', 'supplies'] },
  { id: 'scheduling', label: 'Scheduling', path: '/scheduling', icon: Clock, section: 'Navigation', keywords: ['shifts', 'calendar'] },
  { id: 'facilities', label: 'Facilities', path: '/facilities', icon: Building2, section: 'Navigation', keywords: ['buildings', 'stations'] },
  { id: 'documents', label: 'Documents', path: '/documents', icon: FileText, section: 'Navigation', keywords: ['files', 'uploads'] },
  { id: 'elections', label: 'Elections', path: '/elections', icon: Vote, section: 'Navigation', keywords: ['voting', 'ballot'] },
  { id: 'minutes', label: 'Meeting Minutes', path: '/minutes', icon: ClipboardList, section: 'Navigation', keywords: ['notes', 'motions'] },
  { id: 'notifications', label: 'Notifications', path: '/notifications', icon: Bell, section: 'Navigation', keywords: ['alerts'] },

  // Actions
  { id: 'create-event', label: 'Create Event', path: '/events/admin?tab=create', icon: Calendar, section: 'Actions', permission: 'events.manage' },
  { id: 'add-member', label: 'Add Member', path: '/members/add', icon: Users, section: 'Actions', permission: 'members.manage' },
  { id: 'submit-training', label: 'Submit Training', path: '/training/submit', icon: GraduationCap, section: 'Actions' },
  { id: 'my-equipment', label: 'My Equipment', path: '/inventory/my-equipment', icon: Package, section: 'Actions' },

  // Admin
  { id: 'settings', label: 'Organization Settings', path: '/settings', icon: Settings, section: 'Admin', permission: 'settings.manage' },
  { id: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, section: 'Admin' },
  { id: 'account', label: 'My Account', path: '/account', icon: Settings, section: 'Admin' },
];

export const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();

  // Filter commands by permissions and search query
  const filteredCommands = useMemo(() => {
    const accessible = COMMANDS.filter(
      (cmd) => !cmd.permission || checkPermission(cmd.permission)
    );

    if (!query.trim()) return accessible;

    const q = query.toLowerCase();
    return accessible.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q) ||
        cmd.keywords?.some((kw) => kw.includes(q)) ||
        cmd.section.toLowerCase().includes(q)
    );
  }, [query, checkPermission]);

  // Group by section
  const sections = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filteredCommands.forEach((cmd) => {
      const items = map.get(cmd.section) || [];
      items.push(cmd);
      map.set(cmd.section, items);
    });
    return map;
  }, [filteredCommands]);

  // Keyboard shortcut to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('[data-selected="true"]');
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = (item: CommandItem) => {
    navigate(item.path);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleSelect(filteredCommands[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  if (!isOpen) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />
      <div className="relative flex items-start justify-center min-h-screen pt-[15vh] px-4">
        <div
          className="w-full max-w-lg bg-theme-surface-modal rounded-xl shadow-2xl border border-theme-surface-border overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-theme-surface-border">
            <Search className="w-5 h-5 text-theme-text-muted flex-shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search pages, actions..."
              className="flex-1 py-3.5 bg-transparent text-theme-text-primary placeholder-theme-text-muted text-sm focus:outline-none"
              aria-label="Search commands"
              autoComplete="off"
            />
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-theme-text-muted hover:text-theme-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-72 overflow-y-auto py-2" role="listbox">
            {filteredCommands.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-theme-text-muted">
                No results found for &quot;{query}&quot;
              </div>
            ) : (
              Array.from(sections.entries()).map(([section, items]) => (
                <div key={section}>
                  <div className="px-4 py-1.5 text-xs font-medium text-theme-text-muted uppercase">
                    {section}
                  </div>
                  {items.map((item) => {
                    flatIndex++;
                    const isSelected = flatIndex === selectedIndex;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelect(item)}
                        data-selected={isSelected}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          isSelected
                            ? 'bg-red-600/10 text-red-700 dark:text-red-400'
                            : 'text-theme-text-primary hover:bg-theme-surface-hover'
                        }`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0 opacity-60" />
                        <span className="flex-1">{item.label}</span>
                        {isSelected && (
                          <span className="text-xs text-theme-text-muted">Enter</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-theme-surface-border flex items-center gap-4 text-xs text-theme-text-muted">
            <span>
              <kbd className="px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px] font-mono">
                &uarr;&darr;
              </kbd>{' '}
              Navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px] font-mono">
                Enter
              </kbd>{' '}
              Select
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px] font-mono">
                Esc
              </kbd>{' '}
              Close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
