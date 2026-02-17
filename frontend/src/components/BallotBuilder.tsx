/**
 * Ballot Builder Component
 *
 * Secretary interface for creating and configuring ballot items.
 * Supports pre-built templates for common items (membership approvals,
 * officer elections, general resolutions) and custom ballot items.
 * Each item can have per-item voter eligibility and attendance requirements.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { Election, BallotItem, BallotTemplate } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';

interface BallotBuilderProps {
  electionId: string;
  election: Election;
  onUpdate: (updatedElection: Election) => void;
}

const VOTER_TYPE_OPTIONS = [
  { value: 'all', label: 'All Members' },
  { value: 'regular', label: 'Regular Members' },
  { value: 'life', label: 'Life Members' },
  { value: 'regular,life', label: 'Regular + Life Members' },
  { value: 'probationary', label: 'Probationary Members' },
  { value: 'operational', label: 'Operational Members' },
  { value: 'administrative', label: 'Administrative Members' },
];

const generateId = () => `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const BallotBuilder: React.FC<BallotBuilderProps> = ({
  electionId,
  election,
  onUpdate,
}) => {
  const [templates, setTemplates] = useState<BallotTemplate[]>([]);
  const [ballotItems, setBallotItems] = useState<BallotItem[]>(election.ballot_items || []);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<BallotTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [customForm, setCustomForm] = useState<Partial<BallotItem>>({
    type: 'general_vote',
    vote_type: 'approval',
    eligible_voter_types: ['all'],
    require_attendance: true,
  });

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const data = await electionService.getBallotTemplates();
      setTemplates(data);
    } catch (err) {
      // Error silently handled - templates list will be empty
    }
  };

  const saveItems = async (items: BallotItem[]) => {
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
  };

  const handleSelectTemplate = (template: BallotTemplate) => {
    setSelectedTemplate(template);
    setTemplateNameInput('');
    setShowTemplates(false);
  };

  const handleApplyTemplate = async () => {
    if (!selectedTemplate || !templateNameInput.trim()) return;

    const name = templateNameInput.trim();
    const newItem: BallotItem = {
      id: generateId(),
      type: selectedTemplate.type,
      title: selectedTemplate.title_template.replace('{name}', name),
      description: selectedTemplate.description_template?.replace('{name}', name),
      eligible_voter_types: [...selectedTemplate.eligible_voter_types],
      vote_type: selectedTemplate.vote_type,
      require_attendance: selectedTemplate.require_attendance,
    };

    const updated = [...ballotItems, newItem];
    await saveItems(updated);
    setSelectedTemplate(null);
    setTemplateNameInput('');
  };

  const handleAddCustom = async () => {
    if (!customForm.title?.trim()) {
      toast.error('Title is required');
      return;
    }

    const newItem: BallotItem = {
      id: generateId(),
      type: customForm.type || 'general_vote',
      title: customForm.title.trim(),
      description: customForm.description || undefined,
      position: customForm.position || undefined,
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

  const handleRemoveItem = async (itemId: string) => {
    const updated = ballotItems.filter((item) => item.id !== itemId);
    await saveItems(updated);
  };

  const handleMoveItem = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= ballotItems.length) return;

    const updated = [...ballotItems];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    await saveItems(updated);
  };

  const isClosed = election.status === 'closed' || election.status === 'cancelled';

  const getVoterTypeLabel = (types: string[]) => {
    if (types.includes('all')) return 'All Members';
    return types
      .map((t) => {
        const opt = VOTER_TYPE_OPTIONS.find((o) => o.value === t);
        return opt ? opt.label : t;
      })
      .join(', ');
  };

  return (
    <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-theme-text-primary">
          Ballot Items ({ballotItems.length})
        </h3>
        {!isClosed && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowTemplates(!showTemplates);
                setShowCustomForm(false);
                setSelectedTemplate(null);
              }}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
            >
              {showTemplates ? 'Cancel' : 'Use Template'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCustomForm(!showCustomForm);
                setShowTemplates(false);
                setSelectedTemplate(null);
              }}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
            >
              {showCustomForm ? 'Cancel' : '+ Custom Item'}
            </button>
          </div>
        )}
      </div>

      {/* Template Selection */}
      {showTemplates && !selectedTemplate && (
        <div className="mb-6 p-4 bg-indigo-500/10 rounded-lg border border-indigo-500/30">
          <h4 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-3">Select a Template</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => handleSelectTemplate(template)}
                className="text-left p-3 bg-theme-surface-secondary rounded-lg border border-indigo-500/30 hover:border-indigo-400 hover:bg-theme-surface-hover transition-all"
              >
                <div className="font-medium text-theme-text-primary text-sm">{template.name}</div>
                <p className="text-xs text-theme-text-muted mt-1">{template.description}</p>
                <div className="flex gap-2 mt-2">
                  <span className="px-2 py-0.5 text-xs bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 rounded">
                    {template.vote_type === 'approval' ? 'Yes/No' : 'Candidates'}
                  </span>
                  <span className="px-2 py-0.5 text-xs bg-theme-surface text-theme-text-secondary rounded">
                    {getVoterTypeLabel(template.eligible_voter_types)}
                  </span>
                  {template.require_attendance && (
                    <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded">
                      Attendance Required
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Template Name Input */}
      {selectedTemplate && (
        <div className="mb-6 p-4 bg-indigo-500/10 rounded-lg border border-indigo-500/30">
          <h4 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-2">
            {selectedTemplate.name}
          </h4>
          <p className="text-xs text-theme-text-muted mb-3">{selectedTemplate.description}</p>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">
                {selectedTemplate.type === 'membership_approval'
                  ? 'Member Name'
                  : selectedTemplate.type === 'officer_election'
                    ? 'Position Name'
                    : 'Title / Topic'}
              </label>
              <input
                type="text"
                value={templateNameInput}
                onChange={(e) => setTemplateNameInput(e.target.value)}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                placeholder={
                  selectedTemplate.type === 'membership_approval'
                    ? 'e.g., John Smith'
                    : selectedTemplate.type === 'officer_election'
                      ? 'e.g., Chief'
                      : 'e.g., Approve new equipment purchase'
                }
              />
            </div>
            <div className="text-xs text-theme-text-muted">
              Preview: <span className="font-medium">{selectedTemplate.title_template.replace('{name}', templateNameInput || '...')}</span>
            </div>
            <div className="flex gap-2 mt-2">
              <span className="px-2 py-0.5 text-xs bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 rounded">
                Voters: {getVoterTypeLabel(selectedTemplate.eligible_voter_types)}
              </span>
              {selectedTemplate.require_attendance && (
                <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded">
                  Attendance Required
                </span>
              )}
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
                onClick={handleApplyTemplate}
                disabled={saving || !templateNameInput.trim()}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add to Ballot'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Item Form */}
      {showCustomForm && (
        <div className="mb-6 p-4 bg-theme-surface-secondary rounded-lg border border-theme-surface-border">
          <h4 className="text-sm font-semibold text-theme-text-primary mb-3">Add Custom Ballot Item</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-theme-text-primary">Title *</label>
              <input
                type="text"
                value={customForm.title || ''}
                onChange={(e) => setCustomForm((prev) => ({ ...prev, title: e.target.value }))}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Ballot item title"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-primary">Description</label>
              <textarea
                value={customForm.description || ''}
                onChange={(e) => setCustomForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={2}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="Optional description..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-theme-text-primary">Item Type</label>
                <select
                  value={customForm.type}
                  onChange={(e) => setCustomForm((prev) => ({ ...prev, type: e.target.value }))}
                  className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="general_vote">General Vote</option>
                  <option value="membership_approval">Membership Approval</option>
                  <option value="officer_election">Officer Election</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-theme-text-primary">Vote Type</label>
                <select
                  value={customForm.vote_type}
                  onChange={(e) => setCustomForm((prev) => ({ ...prev, vote_type: e.target.value }))}
                  className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="approval">Approval (Yes/No)</option>
                  <option value="candidate_selection">Candidate Selection</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-text-primary">Who Can Vote</label>
              <select
                value={customForm.eligible_voter_types?.join(',') || 'all'}
                onChange={(e) =>
                  setCustomForm((prev) => ({
                    ...prev,
                    eligible_voter_types: e.target.value.split(','),
                  }))
                }
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-sm py-2 px-3 text-theme-text-primary focus:ring-blue-500 focus:border-blue-500 text-sm"
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
                id="require_attendance"
                checked={customForm.require_attendance ?? true}
                onChange={(e) =>
                  setCustomForm((prev) => ({ ...prev, require_attendance: e.target.checked }))
                }
                className="rounded border-theme-input-border text-blue-600"
              />
              <label htmlFor="require_attendance" className="text-sm text-theme-text-primary">
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
                onClick={handleAddCustom}
                disabled={saving || !customForm.title?.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ballot Items List */}
      {ballotItems.length === 0 ? (
        <div className="text-center py-8 text-theme-text-muted">
          <p>No ballot items yet.</p>
          {!isClosed && (
            <p className="text-sm mt-1">
              Use a template or add a custom item to build your ballot.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {ballotItems.map((item, index) => (
            <div
              key={item.id}
              className="p-4 rounded-lg border border-theme-surface-border bg-theme-surface-secondary hover:bg-theme-surface-hover transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-theme-text-muted w-6">
                      {index + 1}.
                    </span>
                    <span className="font-medium text-theme-text-primary">{item.title}</span>
                  </div>
                  {item.description && (
                    <p className="mt-1 ml-8 text-sm text-theme-text-muted">{item.description}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2 ml-8">
                    <span className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded">
                      {item.type.replace('_', ' ')}
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-purple-500/20 text-purple-700 dark:text-purple-300 rounded">
                      {item.vote_type === 'approval' ? 'Yes/No Vote' : 'Candidate Selection'}
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-theme-surface text-theme-text-secondary rounded">
                      {getVoterTypeLabel(item.eligible_voter_types)}
                    </span>
                    {item.require_attendance && (
                      <span className="px-2 py-0.5 text-xs bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded">
                        Attendance Required
                      </span>
                    )}
                  </div>
                </div>

                {!isClosed && (
                  <div className="flex items-center gap-1 ml-4">
                    <button
                      type="button"
                      onClick={() => handleMoveItem(index, 'up')}
                      disabled={index === 0 || saving}
                      className="p-1 text-theme-text-muted hover:text-theme-text-secondary disabled:opacity-30"
                      title="Move up"
                    >
                      &#9650;
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveItem(index, 'down')}
                      disabled={index === ballotItems.length - 1 || saving}
                      className="p-1 text-theme-text-muted hover:text-theme-text-secondary disabled:opacity-30"
                      title="Move down"
                    >
                      &#9660;
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={saving}
                      className="p-1 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-30 ml-1"
                      title="Remove item"
                    >
                      &#10005;
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BallotBuilder;
