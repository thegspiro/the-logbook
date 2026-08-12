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
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
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
  UserPlus,
  Vote,
  FileText,
  LayoutTemplate,
  Save,
  PenLine,
  Loader2,
  X,
} from 'lucide-react';
import { electionService } from '../services/api';
import type { Election, BallotItem, BallotTemplate, SavedBallotTemplate, VictoryCondition } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { ElectionStatus, VoteType, BallotItemType, VictoryCondition as VC } from '../constants/enums';

// ─── Type color/icon/label maps ─────────────────────────────────

const BALLOT_TYPE_COLORS: Record<string, string> = {
  membership_approval: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30',
  officer_election: 'text-purple-700 dark:text-purple-400 bg-purple-500/10 border border-purple-500/30',
  general_vote: 'text-blue-700 dark:text-blue-400 bg-blue-500/10 border border-blue-500/30',
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

// These categories correspond to the member's membership_type field,
// NOT their assigned role/position slugs.  See MembershipType enum and
// ElectionService._user_has_role_type() for the authoritative mapping.
const VOTER_TYPE_OPTIONS = [
  { value: 'all', label: 'All Members' },
  { value: 'regular', label: 'Regular Members (Active + Life)' },
  { value: 'life', label: 'Life Members' },
  { value: 'regular,life', label: 'Regular + Life Members' },
  { value: 'probationary', label: 'Probationary Members' },
  { value: 'operational', label: 'Operational Members (Active)' },
  { value: 'administrative', label: 'Administrative Members' },
];

const VICTORY_CONDITION_OPTIONS: { value: VictoryCondition; label: string }[] = [
  { value: VC.MOST_VOTES, label: 'Most Votes (Plurality)' },
  { value: VC.MAJORITY, label: 'Majority (>50%)' },
  { value: VC.SUPERMAJORITY, label: 'Supermajority' },
  { value: VC.THRESHOLD, label: 'Threshold' },
];

const inputClass = 'form-input';
const selectClass = inputClass;
const labelClass = 'form-label';

/** Generates a unique ID for new ballot items using timestamp + random suffix. */
const generateId = () => `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Converts an array of voter type codes (e.g. ['regular', 'life']) into
 * a human-readable label by looking up each code in VOTER_TYPE_OPTIONS.
 */
const getVoterTypeLabel = (types: string[]) => {
  if (types.includes('all')) return 'All Members';
  return types
    .map((t) => {
      const opt = VOTER_TYPE_OPTIONS.find((o) => o.value === t);
      return opt ? opt.label : t;
    })
    .join(', ');
};

/**
 * Returns a human-readable label for a ballot item's per-item victory condition
 * override, or null if the item uses the election default.
 */
const getVictoryLabel = (item: BallotItem) => {
  if (!item.victory_condition) return null;
  switch (item.victory_condition) {
    case VC.SUPERMAJORITY:
      return `Supermajority (${item.victory_percentage ?? 67}%)`;
    case VC.MAJORITY:
      return 'Majority (>50%)';
    case VC.THRESHOLD:
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

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
              className="text-theme-text-muted shrink-0 cursor-grab touch-none active:cursor-grabbing"
              aria-label="Drag to reorder"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-5 w-5" />
            </button>
          )}

          {/* Number circle */}
          <span className="bg-theme-surface-hover text-theme-text-secondary flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold">
            {index + 1}
          </span>

          {/* Type badge */}
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${typeColor}`}>
            <TypeIcon className="h-3.5 w-3.5" />
            {typeLabel}
          </span>

          {/* From application badge */}
          {item.prospect_package_id && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
              <UserPlus className="h-3 w-3" />
              Application
            </span>
          )}

          {/* Title */}
          <span className="text-theme-text-primary min-w-0 flex-1 truncate font-medium">{item.title}</span>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-1">
            {/* Expand / collapse */}
            <button
              type="button"
              onClick={() => onToggleExpand(item.id)}
              className="text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text-secondary flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md transition-colors"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
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
                      className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-400"
                    >
                      Confirm?
                    </button>
                    <button
                      type="button"
                      onClick={onCancelDelete}
                      className="text-theme-text-muted hover:bg-theme-surface-hover flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md transition-colors"
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
                    className="text-theme-text-muted flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md transition-all hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 dark:hover:text-red-400"
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
            <span className="bg-theme-surface-secondary text-theme-text-muted rounded-md px-2 py-0.5 text-[11px]">
              {item.vote_type === VoteType.APPROVAL ? 'Yes/No Vote' : 'Candidate Selection'}
            </span>
            <span className="bg-theme-surface-secondary text-theme-text-muted rounded-md px-2 py-0.5 text-[11px]">
              {getVoterTypeLabel(item.eligible_voter_types)}
            </span>
            {item.require_attendance && (
              <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                Attendance Req.
              </span>
            )}
            {victoryLabel ? (
              <span className="rounded-md bg-green-500/10 px-2 py-0.5 text-[11px] text-green-700 dark:text-green-400">
                {victoryLabel}
              </span>
            ) : (
              <span className="bg-theme-surface-secondary text-theme-text-muted rounded-md px-2 py-0.5 text-[11px]">
                Election default
              </span>
            )}
          </div>
        )}

        {/* ── Expanded config panel ── */}
        <div
          ref={contentRef}
          style={{ height: height !== undefined ? `${height}px` : 'auto' }}
          className="overflow-hidden transition-[height] duration-200 ease-in-out"
        >
          <div className="border-theme-surface-border bg-theme-surface-secondary/50 ml-12 border-t px-4 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <option value={BallotItemType.MEMBERSHIP_APPROVAL}>Membership Approval</option>
                  <option value={BallotItemType.OFFICER_ELECTION}>Officer Election</option>
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
                  <option value={VoteType.CANDIDATE_SELECTION}>Candidate Selection</option>
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
                  onChange={(e) => onUpdateItem(item.id, { require_attendance: e.target.checked })}
                  disabled={isClosed}
                  className="border-theme-input-border h-4 w-4 rounded text-red-600"
                />
                <label htmlFor={`attendance_${item.id}`} className="text-theme-text-secondary text-sm">
                  Require meeting attendance
                </label>
              </div>
            </div>

            {/* ── Approval Rules ── */}
            <div className="border-theme-surface-border mt-4 border-t pt-4">
              <h4 className="text-theme-text-muted mb-3 text-xs font-semibold tracking-wider uppercase">
                Approval Rules
              </h4>
              <div className="mb-3 flex items-center gap-3">
                <input
                  type="checkbox"
                  id={`override_${item.id}`}
                  checked={hasOverride}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onUpdateItem(item.id, {
                        victory_condition: election.victory_condition ?? VC.MOST_VOTES,
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
                  className="border-theme-input-border h-4 w-4 rounded text-red-600"
                />
                <label htmlFor={`override_${item.id}`} className="text-theme-text-secondary text-sm">
                  Override election default
                </label>
              </div>

              {hasOverride ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Victory Condition</label>
                    <select
                      className={selectClass}
                      value={item.victory_condition ?? VC.MOST_VOTES}
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
                  {(item.victory_condition === VC.SUPERMAJORITY || item.victory_condition === VC.THRESHOLD) && (
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
                            victory_percentage: parseInt(e.target.value, 10) || undefined,
                          })
                        }
                        disabled={isClosed}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-theme-text-muted text-sm">
                  Using election default:{' '}
                  <span className="text-theme-text-secondary font-medium">
                    {VICTORY_CONDITION_OPTIONS.find((o) => o.value === election.victory_condition)?.label ??
                      election.victory_condition}
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

export const BallotBuilder: React.FC<BallotBuilderProps> = ({ electionId, election, onUpdate }) => {
  const [templates, setTemplates] = useState<BallotTemplate[]>([]);
  const [savedTemplates, setSavedTemplates] = useState<SavedBallotTemplate[]>([]);
  const [ballotItems, setBallotItems] = useState<BallotItem[]>(election.ballot_items || []);
  const [saving, setSaving] = useState(false);

  // Template popover
  const [showTemplatePopover, setShowTemplatePopover] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<BallotTemplate | null>(null);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [savedTemplateName, setSavedTemplateName] = useState('');
  const [pendingSavedTemplateId, setPendingSavedTemplateId] = useState<string | null>(null);
  const [pendingDeleteTemplateId, setPendingDeleteTemplateId] = useState<string | null>(null);
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

  const isClosed = election.status === ElectionStatus.CLOSED || election.status === ElectionStatus.CANCELLED;

  // Positions already used by existing ballot items (one ballot item per position)
  const usedPositions = useMemo(() => new Set(ballotItems.map((item) => item.position).filter(Boolean)), [ballotItems]);

  // Available positions that haven't been added to the ballot yet
  const availablePositions = useMemo(
    () => (election.positions || []).filter((pos) => !usedPositions.has(pos)),
    [election.positions, usedPositions]
  );

  // ── Sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ── Load templates ──
  useEffect(() => {
    void loadTemplates();
  }, []);

  // Close template popover on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (templateRef.current && !templateRef.current.contains(e.target as Node)) {
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
      const [builtIn, saved] = await Promise.all([
        electionService.getBallotTemplates(),
        electionService.getSavedBallotTemplates(),
      ]);
      setTemplates(builtIn);
      setSavedTemplates(saved);
    } catch (_err) {
      // Templates list will be empty
    }
  };

  const handleSaveTemplate = async () => {
    if (!savedTemplateName.trim() || ballotItems.length === 0) return;
    try {
      setSaving(true);
      await electionService.saveBallotTemplate({
        name: savedTemplateName.trim(),
        ballot_items: ballotItems,
      });
      await loadTemplates();
      setSavedTemplateName('');
      setShowSaveTemplate(false);
      toast.success('Reusable ballot template saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save ballot template'));
    } finally {
      setSaving(false);
    }
  };

  const handleApplySavedTemplate = async (template: SavedBallotTemplate) => {
    // Generate fresh IDs so applying a snapshot never carries identifiers
    // that may already be referenced by this draft's local UI state.
    const items = template.ballot_items.map((item) => ({ ...item, id: generateId() }));
    if (await saveItems(items)) {
      setShowTemplatePopover(false);
      setPendingSavedTemplateId(null);
      toast.success(`Applied "${template.name}"`);
    }
  };

  const handleDeleteSavedTemplate = async (template: SavedBallotTemplate) => {
    try {
      await electionService.deleteSavedBallotTemplate(template.id);
      setSavedTemplates((current) => current.filter((item) => item.id !== template.id));
      setPendingDeleteTemplateId(null);
      toast.success('Saved template deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete ballot template'));
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
        return true;
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to save ballot items'));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [electionId, onUpdate]
  );

  // ── Drag handlers ──
  const handleDragStart = (_event: DragStartEvent) => {
    // DndContext requires onDragStart; no additional state needed
  };

  const handleDragEnd = (event: DragEndEvent) => {
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
    const updated = ballotItems.map((item) => (item.id === id ? { ...item, ...updates } : item));
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
    if (selectedTemplate.vote_type === VoteType.CANDIDATE_SELECTION && usedPositions.has(name)) {
      toast.error(`A ballot item for "${name}" already exists.`);
      return;
    }

    const newItem: BallotItem = {
      id: generateId(),
      type: selectedTemplate.type,
      title: selectedTemplate.title_template.replace('{name}', name),
      description: selectedTemplate.description_template?.replace('{name}', name),
      ...(selectedTemplate.vote_type === VoteType.CANDIDATE_SELECTION ? { position: name } : {}),
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
    <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
      {/* ── Header ── */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-theme-text-primary text-lg font-medium">Ballot Items ({ballotItems.length})</h3>
        {!isClosed && (
          <div className="relative flex gap-2" ref={templateRef}>
            {ballotItems.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSaveTemplate((value) => !value)}
                className="btn-info inline-flex items-center gap-1.5 rounded-md text-sm"
              >
                <Save className="h-4 w-4" />
                Save as Template
              </button>
            )}
            {/* Template button + popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowTemplatePopover(!showTemplatePopover);
                  setSelectedTemplate(null);
                  setShowCustomForm(false);
                }}
                className="btn-primary inline-flex items-center gap-1.5 rounded-md text-sm"
              >
                <LayoutTemplate className="h-4 w-4" />
                Use Template
              </button>

              {/* Template popover dropdown — opens upward so it doesn't clip */}
              {showTemplatePopover && (
                <div className="bg-theme-surface-modal border-theme-surface-border absolute right-0 bottom-full z-30 mb-2 max-h-[70dvh] w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border p-4 shadow-lg">
                  {!selectedTemplate ? (
                    <>
                      <h4 className="text-theme-text-primary mb-3 text-sm font-semibold">Select a Template</h4>
                      {savedTemplates.length > 0 && (
                        <div className="mb-4">
                          <p className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
                            Your saved ballots
                          </p>
                          <div className="space-y-2">
                            {savedTemplates.map((template) => (
                              <div
                                key={template.id}
                                className="bg-theme-surface-secondary border-theme-surface-border flex items-center gap-2 rounded-lg border p-3"
                              >
                                <button
                                  type="button"
                                  onClick={() => setPendingSavedTemplateId(template.id)}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <span className="text-theme-text-primary block truncate text-sm font-medium">
                                    {template.name}
                                  </span>
                                  <span className="text-theme-text-muted text-xs">
                                    {template.ballot_items.length} item{template.ballot_items.length === 1 ? '' : 's'} ·
                                    replaces current ballot
                                  </span>
                                </button>
                                {pendingSavedTemplateId === template.id && (
                                  <span className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => void handleApplySavedTemplate(template)}
                                      className="btn-primary rounded px-2 py-1 text-xs"
                                    >
                                      Replace
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setPendingSavedTemplateId(null)}
                                      className="text-theme-text-muted px-1 text-xs"
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                )}
                                {pendingDeleteTemplateId === template.id ? (
                                  <span className="flex shrink-0 items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteSavedTemplate(template)}
                                      className="rounded bg-red-600 px-2 py-1 text-xs text-white"
                                    >
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setPendingDeleteTemplateId(null)}
                                      className="text-theme-text-muted px-1 text-xs"
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setPendingDeleteTemplateId(template.id)}
                                    className="text-theme-text-muted hover:text-red-600 dark:hover:text-red-400"
                                    aria-label={`Delete saved template ${template.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="border-theme-surface-border mt-4 border-t" />
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {templates.map((template) => {
                          const TIcon = BALLOT_TYPE_ICONS[template.type] ?? FileText;
                          const tColor = BALLOT_TYPE_COLORS[template.type] ?? BALLOT_TYPE_COLORS.general_vote;
                          return (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => handleSelectTemplate(template)}
                              className="bg-theme-surface-secondary border-theme-surface-border hover:border-theme-text-muted hover:bg-theme-surface-hover rounded-lg border p-3 text-left transition-all"
                            >
                              <div className="mb-1 flex items-center gap-2">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${tColor}`}
                                >
                                  <TIcon className="h-3 w-3" />
                                </span>
                                <span className="text-theme-text-primary text-sm font-medium">{template.name}</span>
                              </div>
                              <p className="text-theme-text-muted mt-1 text-xs">{template.description}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className="bg-theme-surface text-theme-text-muted rounded-sm px-2 py-0.5 text-[11px]">
                                  {template.vote_type === VoteType.APPROVAL ? 'Yes/No' : 'Candidates'}
                                </span>
                                <span className="bg-theme-surface text-theme-text-muted rounded-sm px-2 py-0.5 text-[11px]">
                                  {getVoterTypeLabel(template.eligible_voter_types)}
                                </span>
                                {template.require_attendance && (
                                  <span className="rounded-sm bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                                    Attendance
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                        {templates.length === 0 && (
                          <p className="text-theme-text-muted py-4 text-center text-sm sm:col-span-2">
                            No templates available.
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 className="text-theme-text-primary mb-1 text-sm font-semibold">{selectedTemplate.name}</h4>
                      <p className="text-theme-text-muted mb-3 text-xs">{selectedTemplate.description}</p>
                      <div className="space-y-3">
                        <div>
                          <label className={labelClass}>
                            {selectedTemplate.type === BallotItemType.MEMBERSHIP_APPROVAL
                              ? 'Member Name'
                              : selectedTemplate.type === BallotItemType.OFFICER_ELECTION
                                ? 'Position Name'
                                : 'Title / Topic'}
                          </label>
                          {selectedTemplate.type === BallotItemType.OFFICER_ELECTION &&
                          election.positions &&
                          election.positions.length > 0 ? (
                            <>
                              <select
                                value={templateNameInput}
                                onChange={(e) => setTemplateNameInput(e.target.value)}
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
                              onChange={(e) => setTemplateNameInput(e.target.value)}
                              className={inputClass}
                              placeholder={
                                selectedTemplate.type === BallotItemType.MEMBERSHIP_APPROVAL
                                  ? 'e.g., John Smith'
                                  : selectedTemplate.type === BallotItemType.OFFICER_ELECTION
                                    ? 'e.g., Chief'
                                    : 'e.g., Approve new equipment purchase'
                              }
                              autoFocus
                            />
                          )}
                        </div>
                        <div className="text-theme-text-muted text-xs">
                          Preview:{' '}
                          <span className="font-medium">
                            {selectedTemplate.title_template.replace('{name}', templateNameInput || '...')}
                          </span>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedTemplate(null)}
                            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-md border px-3 py-2 text-sm"
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
              className="btn-info inline-flex items-center gap-1.5 rounded-md text-sm"
            >
              <PenLine className="h-4 w-4" />
              {showCustomForm ? 'Cancel' : 'Custom Item'}
            </button>
          </div>
        )}
      </div>

      {showSaveTemplate && !isClosed && (
        <div className="border-theme-surface-border bg-theme-surface-secondary mb-4 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className={labelClass} htmlFor="saved-ballot-template-name">
              Template name
            </label>
            <input
              id="saved-ballot-template-name"
              className={inputClass}
              value={savedTemplateName}
              onChange={(event) => setSavedTemplateName(event.target.value)}
              maxLength={200}
              placeholder="e.g., Annual officer election"
              autoFocus
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Saves ballot configuration only—never candidates, voters, votes, or attendance.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-info rounded-md text-sm" onClick={() => setShowSaveTemplate(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary rounded-md text-sm"
              disabled={saving || !savedTemplateName.trim()}
              onClick={() => void handleSaveTemplate()}
            >
              {saving ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {ballotItems.length === 0 && !showCustomForm ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Vote className="text-theme-text-muted/50 mb-3 h-12 w-12" />
          <h4 className="text-theme-text-secondary text-lg font-medium">No ballot items yet</h4>
          <p className="text-theme-text-muted mt-1 max-w-md text-sm">
            Add items from a template or create custom ones to build your ballot.
          </p>
          {!isClosed && (
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowTemplatePopover(true);
                  setShowCustomForm(false);
                }}
                className="btn-primary inline-flex items-center gap-1.5 rounded-md text-sm"
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
                className="btn-info inline-flex items-center gap-1.5 rounded-md text-sm"
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
              <SortableContext items={ballotItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
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
              className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-secondary mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-sm transition-colors hover:border-red-500/50"
            >
              <Plus className="h-4 w-4" />
              Add Item
            </button>
          )}

          {showCustomForm && (
            <div className="card-secondary mt-3 p-4">
              <h4 className="text-theme-text-primary mb-3 flex items-center gap-2 text-sm font-semibold">
                <PenLine className="h-4 w-4" />
                Add Custom Ballot Item
              </h4>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Title *</label>
                  <input
                    type="text"
                    value={customForm.title || ''}
                    onChange={(e) => setCustomForm((prev) => ({ ...prev, title: e.target.value }))}
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

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      <option value="membership_approval">Membership Approval</option>
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
                      <option value="candidate_selection">Candidate Selection</option>
                    </select>
                  </div>
                </div>

                {customForm.vote_type === VoteType.CANDIDATE_SELECTION && (
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
                    <p className="text-theme-text-muted mt-1 text-xs">
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
                    className="border-theme-input-border h-4 w-4 rounded text-red-600"
                  />
                  <label htmlFor="custom_require_attendance" className="text-theme-text-secondary text-sm">
                    Require meeting attendance to vote
                  </label>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCustomForm(false)}
                    className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary rounded-md border px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleAddCustom();
                    }}
                    disabled={saving || !customForm.title?.trim()}
                    className="btn-primary inline-flex items-center gap-2 rounded-md text-sm"
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
        <div className="text-theme-text-muted mt-3 flex items-center gap-2 text-xs" role="status" aria-live="polite">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving...
        </div>
      )}
    </div>
  );
};

export default BallotBuilder;
