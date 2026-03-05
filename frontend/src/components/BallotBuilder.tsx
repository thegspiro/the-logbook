/**
 * Ballot Builder Component
 *
 * Secretary interface for creating and configuring ballot items.
 * Supports pre-built templates for common items (membership approvals,
 * officer elections, general resolutions) and custom ballot items.
 * Each item can have per-item voter eligibility, attendance requirements,
 * and victory condition overrides.
 *
 * Uses @dnd-kit for drag-and-drop reordering with keyboard accessibility.
 */

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  ChevronDown,
  Plus,
  Trash2,
  Users,
  Vote,
  FileText,
  LayoutTemplate,
  PenLine,
  Loader2,
  X,
} from 'lucide-react';
import { electionService } from '../services/api';
import type { Election, BallotItem, BallotTemplate, VictoryCondition } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { ElectionStatus, VoteType, BallotItemType } from '../constants/enums';

// ─── Type color/icon/label maps ─────────────────────────────────

const BALLOT_TYPE_COLORS: Record<string, string> = {
  membership_approval:
    'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30',
  officer_election:
    'text-purple-700 dark:text-purple-400 bg-purple-500/10 border border-purple-500/30',
  general_vote:
    'text-blue-700 dark:text-blue-400 bg-blue-500/10 border border-blue-500/30',
};

const BALLOT_TYPE_ICONS: Record<string, React.ElementType> = {
  membership_approval: Users,
  officer_election: Vote,
  general_vote: FileText,
};

const BALLOT_TYPE_LABELS: Record<string, string> = {
  membership_approval: 'Membership Approval',
  officer_election: 'Officer Election',
  general_vote: 'General Vote',
};

// ─── Shared constants ───────────────────────────────────────────

const VOTER_TYPE_OPTIONS = [
  { value: 'all', label: 'All Members' },
  { value: 'regular', label: 'Regular Members' },
  { value: 'life', label: 'Life Members' },
  { value: 'regular,life', label: 'Regular + Life Members' },
  { value: 'probationary', label: 'Probationary Members' },
  { value: 'operational', label: 'Operational Members' },
  { value: 'administrative', label: 'Administrative Members' },
];

const VICTORY_CONDITION_OPTIONS: { value: VictoryCondition; label: string }[] = [
  { value: 'most_votes', label: 'Most Votes (Plurality)' },
  { value: 'majority', label: 'Majority (>50%)' },
  { value: 'supermajority', label: 'Supermajority' },
  { value: 'threshold', label: 'Threshold' },
];

const inputClass =
  'block w-full rounded-md border border-theme-surface-border bg-theme-surface-secondary px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:border-red-500 focus:outline-hidden focus:ring-1 focus:ring-red-500';
const selectClass = inputClass;
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

const generateId = () =>
  `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Helpers ────────────────────────────────────────────────────

const getVoterTypeLabel = (types: string[]) => {
  if (types.includes('all')) return 'All Members';
  return types
    .map((t) => {
      const opt = VOTER_TYPE_OPTIONS.find((o) => o.value === t);
      return opt ? opt.label : t;
    })
    .join(', ');
};

const getVictoryLabel = (item: BallotItem) => {
  if (!item.victory_condition) return null;
  switch (item.victory_condition) {
    case 'supermajority':
      return `Supermajority (${item.victory_percentage ?? 67}%)`;
    case 'majority':
      return 'Majority (>50%)';
    case 'threshold':
      return `Threshold (${item.victory_percentage ?? ''}%)`;
    default:
      return 'Most Votes';
  }
};

// ─── SortableBallotCard ─────────────────────────────────────────

interface SortableBallotCardProps {
  item: BallotItem;
  index: number;
  isExpanded: boolean;
  isDeleteConfirm: boolean;
  isClosed: boolean;
  saving: boolean;
  election: Election;
  onToggleExpand: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  onUpdateItem: (id: string, updates: Partial<BallotItem>) => void;
}

const SortableBallotCard: React.FC<SortableBallotCardProps> = ({
  item,
  index,
  isExpanded,
  isDeleteConfirm,
  isClosed,
  saving,
  election,
  onToggleExpand,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onUpdateItem,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(0);

  useEffect(() => {
    if (!contentRef.current) return undefined;

    if (isExpanded) {
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      const timer = setTimeout(() => setHeight(undefined), 200);
      return () => clearTimeout(timer);
    } else {
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0));
      });
      return undefined;
    }
  }, [isExpanded]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const TypeIcon = BALLOT_TYPE_ICONS[item.type] ?? FileText;
  const typeColor = BALLOT_TYPE_COLORS[item.type] ?? BALLOT_TYPE_COLORS.general_vote;
  const typeLabel = BALLOT_TYPE_LABELS[item.type] ?? item.type;
  const victoryLabel = getVictoryLabel(item);

  const hasOverride = !!item.victory_condition;

  return (
    <div ref={setNodeRef} style={style} className="group">
      <div className="card-secondary overflow-hidden transition-all">
        {/* ── Collapsed header row ── */}
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Drag handle */}
          {!isClosed && (
            <button
              type="button"
              className="text-theme-text-muted shrink-0 cursor-grab active:cursor-grabbing touch-none"
              aria-label="Drag to reorder"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-5 w-5" />
            </button>
          )}

          {/* Number circle */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-theme-surface-hover text-sm font-bold text-theme-text-secondary">
            {index + 1}
          </span>

          {/* Type badge */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${typeColor}`}
          >
            <TypeIcon className="h-3.5 w-3.5" />
            {typeLabel}
          </span>

          {/* Title */}
          <span className="min-w-0 flex-1 truncate font-medium text-theme-text-primary">
            {item.title}
          </span>

          {/* Action buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Expand / collapse */}
            <button
              type="button"
              onClick={() => onToggleExpand(item.id)}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text-secondary transition-colors"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Delete */}
            {!isClosed && (
              <>
                {isDeleteConfirm ? (
                  <span className="flex items-center gap-1" aria-live="polite">
                    <button
                      type="button"
                      onClick={() => onConfirmDelete(item.id)}
                      disabled={saving}
                      className="px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-colors"
                    >
                      Confirm?
                    </button>
                    <button
                      type="button"
                      onClick={onCancelDelete}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-theme-text-muted hover:bg-theme-surface-hover transition-colors"
                      aria-label="Cancel delete"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRequestDelete(item.id)}
                    disabled={saving}
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-theme-text-muted sm:opacity-0 sm:group-hover:opacity-100 hover:text-red-600 dark:hover:text-red-400 transition-all"
                    aria-label="Delete item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Summary pills (collapsed only) ── */}
        {!isExpanded && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-3 pl-[4.25rem]">
            <span className="px-2 py-0.5 text-[11px] bg-theme-surface-secondary text-theme-text-muted rounded-md">
              {item.vote_type === VoteType.APPROVAL ? 'Yes/No Vote' : 'Candidate Selection'}
            </span>
            <span className="px-2 py-0.5 text-[11px] bg-theme-surface-secondary text-theme-text-muted rounded-md">
              {getVoterTypeLabel(item.eligible_voter_types)}
            </span>
            {item.require_attendance && (
              <span className="px-2 py-0.5 text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-md">
                Attendance Req.
              </span>
            )}
            {victoryLabel ? (
              <span className="px-2 py-0.5 text-[11px] bg-green-500/10 text-green-700 dark:text-green-400 rounded-md">
                {victoryLabel}
              </span>
            ) : (
              <span className="px-2 py-0.5 text-[11px] bg-theme-surface-secondary text-theme-text-muted rounded-md">
                Election default
              </span>
            )}
          </div>
        )}

        {/* ── Expanded config panel ── */}
        <div
          ref={contentRef}
          style={{ height: height !== undefined ? `${height}px` : 'auto' }}
          className="transition-[height] duration-200 ease-in-out overflow-hidden"
        >
          <div className="border-t border-theme-surface-border bg-theme-surface-secondary/50 px-4 py-4 ml-12">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Title */}
              <div className="sm:col-span-2">
                <label className={labelClass}>Title</label>
                <input
                  type="text"
                  className={inputClass}
                  value={item.title}
                  onChange={(e) => onUpdateItem(item.id, { title: e.target.value })}
                  disabled={isClosed}
                />
              </div>

              {/* Description */}
              <div className="sm:col-span-2">
                <label className={labelClass}>Description</label>
                <textarea
                  className={inputClass}
                  rows={2}
                  value={item.description ?? ''}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      description: e.target.value || undefined,
                    })
                  }
                  disabled={isClosed}
                  placeholder="Optional description..."
                />
              </div>

              {/* Item Type */}
              <div>
                <label className={labelClass}>Item Type</label>
                <select
                  className={selectClass}
                  value={item.type}
                  onChange={(e) => onUpdateItem(item.id, { type: e.target.value })}
                  disabled={isClosed}
                >
                  <option value={BallotItemType.GENERAL_VOTE}>General Vote</option>
                  <option value={BallotItemType.MEMBERSHIP_APPROVAL}>
                    Membership Approval
                  </option>
                  <option value={BallotItemType.OFFICER_ELECTION}>
                    Officer Election
                  </option>
                </select>
              </div>

              {/* Vote Type */}
              <div>
                <label className={labelClass}>Vote Type</label>
                <select
                  className={selectClass}
                  value={item.vote_type}
                  onChange={(e) => onUpdateItem(item.id, { vote_type: e.target.value })}
                  disabled={isClosed}
                >
                  <option value={VoteType.APPROVAL}>Approval (Yes/No)</option>
                  <option value={VoteType.CANDIDATE_SELECTION}>
                    Candidate Selection
                  </option>
                </select>
              </div>

              {/* Who Can Vote */}
              <div>
                <label className={labelClass}>Who Can Vote</label>
                <select
                  className={selectClass}
                  value={item.eligible_voter_types.join(',')}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      eligible_voter_types: e.target.value.split(','),
                    })
                  }
                  disabled={isClosed}
                >
                  {VOTER_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Attendance */}
              <div className="flex items-center gap-3 self-end pb-2">
                <input
                  type="checkbox"
                  id={`attendance_${item.id}`}
                  checked={item.require_attendance ?? true}
                  onChange={(e) =>
                    onUpdateItem(item.id, { require_attendance: e.target.checked })
                  }
                  disabled={isClosed}
                  className="h-4 w-4 text-red-600 rounded border-gray-300"
                />
                <label
                  htmlFor={`attendance_${item.id}`}
                  className="text-sm text-theme-text-secondary"
                >
                  Require meeting attendance
                </label>
              </div>
            </div>

            {/* ── Approval Rules ── */}
            <div className="mt-4 pt-4 border-t border-theme-surface-border">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">
                Approval Rules
              </h4>
              <div className="flex items-center gap-3 mb-3">
                <input
                  type="checkbox"
                  id={`override_${item.id}`}
                  checked={hasOverride}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onUpdateItem(item.id, {
                        victory_condition: election.victory_condition ?? 'most_votes',
                        victory_percentage: election.victory_percentage,
                      });
                    } else {
                      onUpdateItem(item.id, {
                        victory_condition: undefined,
                        victory_percentage: undefined,
                      });
                    }
                  }}
                  disabled={isClosed}
                  className="h-4 w-4 text-red-600 rounded border-gray-300"
                />
                <label
                  htmlFor={`override_${item.id}`}
                  className="text-sm text-theme-text-secondary"
                >
                  Override election default
                </label>
              </div>

              {hasOverride ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Victory Condition</label>
                    <select
                      className={selectClass}
                      value={item.victory_condition ?? 'most_votes'}
                      onChange={(e) =>
                        onUpdateItem(item.id, {
                          victory_condition: e.target.value as VictoryCondition,
                        })
                      }
                      disabled={isClosed}
                    >
                      {VICTORY_CONDITION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(item.victory_condition === 'supermajority' ||
                    item.victory_condition === 'threshold') && (
                    <div>
                      <label className={labelClass}>Percentage</label>
                      <input
                        type="number"
                        className={inputClass}
                        min={1}
                        max={100}
                        value={item.victory_percentage ?? 67}
                        onChange={(e) =>
                          onUpdateItem(item.id, {
                            victory_percentage:
                              parseInt(e.target.value, 10) || undefined,
                          })
                        }
                        disabled={isClosed}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-theme-text-muted">
                  Using election default:{' '}
                  <span className="font-medium text-theme-text-secondary">
                    {VICTORY_CONDITION_OPTIONS.find(
                      (o) => o.value === election.victory_condition,
                    )?.label ?? election.victory_condition}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main BallotBuilder ─────────────────────────────────────────

interface BallotBuilderProps {
  electionId: string;
  election: Election;
  onUpdate: (updatedElection: Election) => void;
}

export const BallotBuilder: React.FC<BallotBuilderProps> = ({
  electionId,
  election,
  onUpdate,
}) => {
  const [templates, setTemplates] = useState<BallotTemplate[]>([]);
  const [ballotItems, setBallotItems] = useState<BallotItem[]>(
    election.ballot_items || [],
  );
  const [saving, setSaving] = useState(false);

  // Template popover
  const [showTemplatePopover, setShowTemplatePopover] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<BallotTemplate | null>(null);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const templateRef = useRef<HTMLDivElement>(null);

  // Custom item form
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState<Partial<BallotItem>>({
    type: 'general_vote',
    vote_type: 'approval',
    eligible_voter_types: ['all'],
    require_attendance: true,
  });

  // Card interaction state
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [_dragActiveId, setDragActiveId] = useState<string | null>(null);

  const isClosed =
    election.status === ElectionStatus.CLOSED ||
    election.status === ElectionStatus.CANCELLED;

  // Positions already used by existing ballot items (one ballot item per position)
  const usedPositions = useMemo(
    () => new Set(ballotItems.map((item) => item.position).filter(Boolean)),
    [ballotItems],
  );

  // Available positions that haven't been added to the ballot yet
  const availablePositions = useMemo(
    () => (election.positions || []).filter((pos) => !usedPositions.has(pos)),
    [election.positions, usedPositions],
  );

  // ── Sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // ── Load templates ──
  useEffect(() => {
    void loadTemplates();
  }, []);

  // Close template popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        templateRef.current &&
        !templateRef.current.contains(e.target as Node)
      ) {
        setShowTemplatePopover(false);
        setSelectedTemplate(null);
      }
    };
    if (showTemplatePopover) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [showTemplatePopover]);

  const loadTemplates = async () => {
    try {
      const data = await electionService.getBallotTemplates();
      setTemplates(data);
    } catch (_err) {
      // Templates list will be empty
    }
  };

  const saveItems = useCallback(
    async (items: BallotItem[]) => {
      try {
        setSaving(true);
        const updated = await electionService.updateElection(electionId, {
          ballot_items: items,
        });
        setBallotItems(items);
        onUpdate(updated);
        toast.success('Ballot items saved');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to save ballot items'));
      } finally {
        setSaving(false);
      }
    },
    [electionId, onUpdate],
  );

  // ── Drag handlers ──
  const handleDragStart = (event: DragStartEvent) => {
    setDragActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = ballotItems.findIndex((i) => i.id === active.id);
    const newIndex = ballotItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(ballotItems, oldIndex, newIndex);
    setBallotItems(reordered);
    void saveItems(reordered);
  };

  // ── Item CRUD ──
  const handleToggleExpand = (id: string) => {
    setExpandedItemId((prev) => (prev === id ? null : id));
  };

  const handleRequestDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const handleConfirmDelete = (id: string) => {
    const updated = ballotItems.filter((item) => item.id !== id);
    setDeleteConfirmId(null);
    if (expandedItemId === id) setExpandedItemId(null);
    setBallotItems(updated);
    void saveItems(updated);
  };

  const handleCancelDelete = () => {
    setDeleteConfirmId(null);
  };

  const handleUpdateItem = (id: string, updates: Partial<BallotItem>) => {
    const updated = ballotItems.map((item) =>
      item.id === id ? { ...item, ...updates } : item,
    );
    setBallotItems(updated);
    void saveItems(updated);
  };

  // ── Template handlers ──
  const handleSelectTemplate = (template: BallotTemplate) => {
    setSelectedTemplate(template);
    setTemplateNameInput('');
  };

  const handleApplyTemplate = async () => {
    if (!selectedTemplate || !templateNameInput.trim()) return;

    const name = templateNameInput.trim();

    // Prevent duplicate ballot items for the same position
    if (selectedTemplate.vote_type === 'candidate_selection' && usedPositions.has(name)) {
      toast.error(`A ballot item for "${name}" already exists.`);
      return;
    }

    const newItem: BallotItem = {
      id: generateId(),
      type: selectedTemplate.type,
      title: selectedTemplate.title_template.replace('{name}', name),
      description: selectedTemplate.description_template?.replace('{name}', name),
      ...(selectedTemplate.vote_type === 'candidate_selection' ? { position: name } : {}),
      eligible_voter_types: [...selectedTemplate.eligible_voter_types],
      vote_type: selectedTemplate.vote_type,
      require_attendance: selectedTemplate.require_attendance,
    };

    const updated = [...ballotItems, newItem];
    await saveItems(updated);
    setSelectedTemplate(null);
    setTemplateNameInput('');
    setShowTemplatePopover(false);
  };

  // ── Custom item handlers ──
  const handleAddCustom = async () => {
    if (!customForm.title?.trim()) {
      toast.error('Title is required');
      return;
    }

    // Prevent duplicate ballot items for the same position
    if (customForm.position && usedPositions.has(customForm.position)) {
      toast.error(`A ballot item for "${customForm.position}" already exists.`);
      return;
    }

    const newItem: BallotItem = {
      id: generateId(),
      type: customForm.type || 'general_vote',
      title: customForm.title.trim(),
      ...(customForm.description ? { description: customForm.description } : {}),
      ...(customForm.position ? { position: customForm.position } : {}),
      eligible_voter_types: customForm.eligible_voter_types || ['all'],
      vote_type: customForm.vote_type || 'approval',
      require_attendance: customForm.require_attendance ?? true,
    };

    const updated = [...ballotItems, newItem];
    await saveItems(updated);
    setShowCustomForm(false);
    setCustomForm({
      type: 'general_vote',
      vote_type: 'approval',
      eligible_voter_types: ['all'],
      require_attendance: true,
    });
  };

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="bg-theme-surface backdrop-blur-xs rounded-lg p-6">
      {/* ── Header ── */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-theme-text-primary">
          Ballot Items ({ballotItems.length})
        </h3>
        {!isClosed && (
          <div className="flex gap-2 relative" ref={templateRef}>
            {/* Template button + popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowTemplatePopover(!showTemplatePopover);
                  setSelectedTemplate(null);
                  setShowCustomForm(false);
                }}
                className="btn-primary rounded-md text-sm inline-flex items-center gap-1.5"
              >
                <LayoutTemplate className="h-4 w-4" />
                Use Template
              </button>

              {/* Template popover dropdown */}
              {showTemplatePopover && (
                <div className="absolute right-0 top-full mt-2 z-30 w-[28rem] max-w-[calc(100vw-2rem)] bg-theme-surface rounded-lg border border-theme-surface-border p-4 shadow-lg">
                  {!selectedTemplate ? (
                    <>
                      <h4 className="text-sm font-semibold text-theme-text-primary mb-3">
                        Select a Template
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {templates.map((template) => {
                          const TIcon =
                            BALLOT_TYPE_ICONS[template.type] ?? FileText;
                          const tColor =
                            BALLOT_TYPE_COLORS[template.type] ??
                            BALLOT_TYPE_COLORS.general_vote;
                          return (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => handleSelectTemplate(template)}
                              className="text-left p-3 bg-theme-surface-secondary rounded-lg border border-theme-surface-border hover:border-theme-text-muted hover:bg-theme-surface-hover transition-all"
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${tColor}`}
                                >
                                  <TIcon className="h-3 w-3" />
                                </span>
                                <span className="font-medium text-theme-text-primary text-sm">
                                  {template.name}
                                </span>
                              </div>
                              <p className="text-xs text-theme-text-muted mt-1">
                                {template.description}
                              </p>
                              <div className="flex gap-2 mt-2 flex-wrap">
                                <span className="px-2 py-0.5 text-[11px] bg-theme-surface text-theme-text-muted rounded-sm">
                                  {template.vote_type === VoteType.APPROVAL
                                    ? 'Yes/No'
                                    : 'Candidates'}
                                </span>
                                <span className="px-2 py-0.5 text-[11px] bg-theme-surface text-theme-text-muted rounded-sm">
                                  {getVoterTypeLabel(
                                    template.eligible_voter_types,
                                  )}
                                </span>
                                {template.require_attendance && (
                                  <span className="px-2 py-0.5 text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-sm">
                                    Attendance
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                        {templates.length === 0 && (
                          <p className="sm:col-span-2 text-sm text-theme-text-muted text-center py-4">
                            No templates available.
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 className="text-sm font-semibold text-theme-text-primary mb-1">
                        {selectedTemplate.name}
                      </h4>
                      <p className="text-xs text-theme-text-muted mb-3">
                        {selectedTemplate.description}
                      </p>
                      <div className="space-y-3">
                        <div>
                          <label className={labelClass}>
                            {selectedTemplate.type ===
                            BallotItemType.MEMBERSHIP_APPROVAL
                              ? 'Member Name'
                              : selectedTemplate.type ===
                                  BallotItemType.OFFICER_ELECTION
                                ? 'Position Name'
                                : 'Title / Topic'}
                          </label>
                          {selectedTemplate.type === BallotItemType.OFFICER_ELECTION &&
                          election.positions &&
                          election.positions.length > 0 ? (
                            <>
                              <select
                                value={templateNameInput}
                                onChange={(e) =>
                                  setTemplateNameInput(e.target.value)
                                }
                                className={selectClass}
                                autoFocus
                              >
                                <option value="">Select position...</option>
                                {availablePositions.map((pos) => (
                                  <option key={pos} value={pos}>
                                    {pos}
                                  </option>
                                ))}
                              </select>
                              {availablePositions.length === 0 && (
                                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                                  All positions already have ballot items.
                                </p>
                              )}
                            </>
                          ) : (
                            <input
                              type="text"
                              value={templateNameInput}
                              onChange={(e) =>
                                setTemplateNameInput(e.target.value)
                              }
                              className={inputClass}
                              placeholder={
                                selectedTemplate.type ===
                                BallotItemType.MEMBERSHIP_APPROVAL
                                  ? 'e.g., John Smith'
                                  : selectedTemplate.type ===
                                      BallotItemType.OFFICER_ELECTION
                                    ? 'e.g., Chief'
                                    : 'e.g., Approve new equipment purchase'
                              }
                              autoFocus
                            />
                          )}
                        </div>
                        <div className="text-xs text-theme-text-muted">
                          Preview:{' '}
                          <span className="font-medium">
                            {selectedTemplate.title_template.replace(
                              '{name}',
                              templateNameInput || '...',
                            )}
                          </span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedTemplate(null)}
                            className="px-3 py-2 text-sm border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleApplyTemplate();
                            }}
                            disabled={saving || !templateNameInput.trim()}
                            className="btn-primary rounded-md text-sm"
                          >
                            {saving ? 'Adding...' : 'Add to Ballot'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setShowCustomForm(!showCustomForm);
                setShowTemplatePopover(false);
                setSelectedTemplate(null);
              }}
              className="btn-info rounded-md text-sm inline-flex items-center gap-1.5"
            >
              <PenLine className="h-4 w-4" />
              {showCustomForm ? 'Cancel' : 'Custom Item'}
            </button>
          </div>
        )}
      </div>

      {/* ── Empty state ── */}
      {ballotItems.length === 0 && !showCustomForm ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Vote className="h-12 w-12 text-theme-text-muted/50 mb-3" />
          <h4 className="text-lg font-medium text-theme-text-secondary">
            No ballot items yet
          </h4>
          <p className="text-sm text-theme-text-muted mt-1 max-w-md">
            Add items from a template or create custom ones to build your ballot.
          </p>
          {!isClosed && (
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowTemplatePopover(true);
                  setShowCustomForm(false);
                }}
                className="btn-primary rounded-md text-sm inline-flex items-center gap-1.5"
              >
                <LayoutTemplate className="h-4 w-4" />
                Use Template
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCustomForm(true);
                  setShowTemplatePopover(false);
                }}
                className="btn-info rounded-md text-sm inline-flex items-center gap-1.5"
              >
                <PenLine className="h-4 w-4" />
                Custom Item
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── Sortable card list ── */}
          {ballotItems.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={ballotItems.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {ballotItems.map((item, index) => (
                    <SortableBallotCard
                      key={item.id}
                      item={item}
                      index={index}
                      isExpanded={expandedItemId === item.id}
                      isDeleteConfirm={deleteConfirmId === item.id}
                      isClosed={isClosed}
                      saving={saving}
                      election={election}
                      onToggleExpand={handleToggleExpand}
                      onRequestDelete={handleRequestDelete}
                      onConfirmDelete={handleConfirmDelete}
                      onCancelDelete={handleCancelDelete}
                      onUpdateItem={handleUpdateItem}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* ── Custom item form (dashed add card) ── */}
          {!isClosed && !showCustomForm && ballotItems.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowCustomForm(true);
                setShowTemplatePopover(false);
              }}
              className="mt-3 w-full border-2 border-dashed border-theme-surface-border rounded-lg p-4 hover:border-red-500/50 transition-colors cursor-pointer flex items-center justify-center gap-2 text-sm text-theme-text-muted hover:text-theme-text-secondary"
            >
              <Plus className="h-4 w-4" />
              Add Item
            </button>
          )}

          {showCustomForm && (
            <div className="card-secondary mt-3 p-4">
              <h4 className="text-sm font-semibold text-theme-text-primary mb-3 flex items-center gap-2">
                <PenLine className="h-4 w-4" />
                Add Custom Ballot Item
              </h4>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Title *</label>
                  <input
                    type="text"
                    value={customForm.title || ''}
                    onChange={(e) =>
                      setCustomForm((prev) => ({ ...prev, title: e.target.value }))
                    }
                    className={inputClass}
                    placeholder="Ballot item title"
                    autoFocus
                  />
                </div>

                <div>
                  <label className={labelClass}>Description</label>
                  <textarea
                    value={customForm.description || ''}
                    onChange={(e) =>
                      setCustomForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    rows={2}
                    className={inputClass}
                    placeholder="Optional description..."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Item Type</label>
                    <select
                      value={customForm.type}
                      onChange={(e) =>
                        setCustomForm((prev) => ({
                          ...prev,
                          type: e.target.value,
                        }))
                      }
                      className={selectClass}
                    >
                      <option value="general_vote">General Vote</option>
                      <option value="membership_approval">
                        Membership Approval
                      </option>
                      <option value="officer_election">Officer Election</option>
                    </select>
                  </div>

                  <div>
                    <label className={labelClass}>Vote Type</label>
                    <select
                      value={customForm.vote_type}
                      onChange={(e) =>
                        setCustomForm((prev) => ({
                          ...prev,
                          vote_type: e.target.value,
                        }))
                      }
                      className={selectClass}
                    >
                      <option value="approval">Approval (Yes/No)</option>
                      <option value="candidate_selection">
                        Candidate Selection
                      </option>
                    </select>
                  </div>
                </div>

                {customForm.vote_type === 'candidate_selection' && (
                  <div>
                    <label className={labelClass}>Position</label>
                    {election.positions && election.positions.length > 0 ? (
                      <>
                        <select
                          value={customForm.position || ''}
                          onChange={(e) =>
                            setCustomForm((prev) => ({
                              ...prev,
                              position: e.target.value || undefined,
                            }))
                          }
                          className={selectClass}
                        >
                          <option value="">Select position...</option>
                          {availablePositions.map((pos) => (
                            <option key={pos} value={pos}>
                              {pos}
                            </option>
                          ))}
                        </select>
                        {availablePositions.length === 0 && (
                          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                            All positions already have ballot items.
                          </p>
                        )}
                      </>
                    ) : (
                      <input
                        type="text"
                        value={customForm.position || ''}
                        onChange={(e) =>
                          setCustomForm((prev) => ({
                            ...prev,
                            position: e.target.value || undefined,
                          }))
                        }
                        className={inputClass}
                        placeholder="e.g., Chief"
                      />
                    )}
                    <p className="mt-1 text-xs text-theme-text-muted">
                      Links this ballot item to candidates running for this position.
                    </p>
                  </div>
                )}

                <div>
                  <label className={labelClass}>Who Can Vote</label>
                  <select
                    value={customForm.eligible_voter_types?.join(',') || 'all'}
                    onChange={(e) =>
                      setCustomForm((prev) => ({
                        ...prev,
                        eligible_voter_types: e.target.value.split(','),
                      }))
                    }
                    className={selectClass}
                  >
                    {VOTER_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="custom_require_attendance"
                    checked={customForm.require_attendance ?? true}
                    onChange={(e) =>
                      setCustomForm((prev) => ({
                        ...prev,
                        require_attendance: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 text-red-600 rounded border-gray-300"
                  />
                  <label
                    htmlFor="custom_require_attendance"
                    className="text-sm text-theme-text-secondary"
                  >
                    Require meeting attendance to vote
                  </label>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCustomForm(false)}
                    className="px-3 py-2 text-sm border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleAddCustom();
                    }}
                    disabled={saving || !customForm.title?.trim()}
                    className="btn-primary rounded-md text-sm inline-flex items-center gap-2"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Add to Ballot
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Saving indicator */}
      {saving && (
        <div className="flex items-center gap-2 mt-3 text-xs text-theme-text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
};

export default BallotBuilder;
