/**
 * Elections Settings Page
 *
 * Centralised configuration for election defaults, voter eligibility,
 * test ballots, ballot preview, and security posture.
 * Requires `elections.manage` permission.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { electionService } from '../services/electionService';
import type { ElectionSettings, ElectionListItem } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';

const VOTING_METHOD_OPTIONS = [
  { value: 'simple_majority', label: 'Simple Majority' },
  { value: 'ranked_choice', label: 'Ranked Choice (IRV)' },
  { value: 'approval', label: 'Approval Voting' },
  { value: 'supermajority', label: 'Supermajority' },
] as const;

const VICTORY_CONDITION_OPTIONS = [
  { value: 'most_votes', label: 'Most Votes (Plurality)' },
  { value: 'majority', label: 'Majority (>50%)' },
  { value: 'supermajority', label: 'Supermajority' },
  { value: 'threshold', label: 'Threshold' },
] as const;

const QUORUM_TYPE_OPTIONS = [
  { value: 'none', label: 'No Quorum' },
  { value: 'percentage', label: 'Percentage of Eligible Voters' },
  { value: 'count', label: 'Minimum Voter Count' },
] as const;

const inputClass = 'form-input';
const selectClass = inputClass;
const labelClass = 'form-label';

export const ElectionsSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ElectionSettings>({});
  const [elections, setElections] = useState<ElectionListItem[]>([]);
  const [selectedTestElection, setSelectedTestElection] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [settingsData, electionsData] = await Promise.all([
        electionService.getSettings(),
        electionService.getElections('draft'),
      ]);
      setSettings(settingsData);
      setElections(electionsData);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const updated = await electionService.updateSettings(settings);
      setSettings(updated);
      toast.success('Election settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestBallot = async () => {
    if (!selectedTestElection) {
      toast.error('Select a draft election first');
      return;
    }
    try {
      setSendingTest(true);
      const result = await electionService.sendTestBallot(selectedTestElection);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to send test ballot'));
    } finally {
      setSendingTest(false);
    }
  };

  const updateField = <K extends keyof ElectionSettings>(key: K, value: ElectionSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/elections')}
            className="p-2 rounded-md hover:bg-theme-surface-secondary text-theme-text-muted"
            aria-label="Back to elections"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-2xl font-bold text-theme-text-primary">Election Settings</h1>
        </div>
        <button
          onClick={() => { void handleSave(); }}
          disabled={saving}
          className="btn-primary px-4 py-2 rounded-md text-sm flex items-center gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>
      </div>

      <div className="space-y-6">
        {/* Default Election Settings */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
            Default Election Settings
          </h2>
          <p className="text-sm text-theme-text-muted mb-4">
            These defaults pre-populate the creation form. They can be overridden per-election and per-ballot-item.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Default Voting Method</label>
              <select
                className={selectClass}
                value={settings.default_voting_method ?? 'simple_majority'}
                onChange={(e) => updateField('default_voting_method', e.target.value as ElectionSettings['default_voting_method'])}
              >
                {VOTING_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Default Victory Condition</label>
              <select
                className={selectClass}
                value={settings.default_victory_condition ?? 'most_votes'}
                onChange={(e) => updateField('default_victory_condition', e.target.value as ElectionSettings['default_victory_condition'])}
              >
                {VICTORY_CONDITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {(settings.default_victory_condition === 'supermajority' ||
              settings.default_victory_condition === 'threshold') && (
              <div>
                <label className={labelClass}>Default Victory Percentage</label>
                <input
                  type="number"
                  className={inputClass}
                  min={1}
                  max={100}
                  value={settings.default_victory_percentage ?? 67}
                  onChange={(e) => updateField('default_victory_percentage', parseInt(e.target.value, 10) || undefined)}
                />
              </div>
            )}

            <div>
              <label className={labelClass}>Default Quorum Type</label>
              <select
                className={selectClass}
                value={settings.default_quorum_type ?? 'none'}
                onChange={(e) => updateField('default_quorum_type', e.target.value)}
              >
                {QUORUM_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {settings.default_quorum_type && settings.default_quorum_type !== 'none' && (
              <div>
                <label className={labelClass}>
                  {settings.default_quorum_type === 'percentage' ? 'Quorum Percentage' : 'Minimum Voters'}
                </label>
                <input
                  type="number"
                  className={inputClass}
                  min={1}
                  max={settings.default_quorum_type === 'percentage' ? 100 : 9999}
                  value={settings.default_quorum_value ?? ''}
                  onChange={(e) => updateField('default_quorum_value', parseInt(e.target.value, 10) || undefined)}
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="default_anonymous"
                checked={settings.default_anonymous_voting ?? true}
                onChange={(e) => updateField('default_anonymous_voting', e.target.checked)}
                className="h-4 w-4 text-red-600 rounded border-theme-input-border"
              />
              <label htmlFor="default_anonymous" className="text-sm text-theme-text-secondary">
                Anonymous voting by default
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="default_write_ins"
                checked={settings.default_allow_write_ins ?? false}
                onChange={(e) => updateField('default_allow_write_ins', e.target.checked)}
                className="h-4 w-4 text-red-600 rounded border-theme-input-border"
              />
              <label htmlFor="default_write_ins" className="text-sm text-theme-text-secondary">
                Allow write-in candidates by default
              </label>
            </div>
          </div>
        </section>

        {/* Proxy Voting */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-2">
            Proxy Voting
          </h2>
          <p className="text-sm text-theme-text-muted mb-4">
            When enabled, a secretary can authorize one member to vote on behalf of another absent member.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="proxy_voting_enabled"
                checked={settings.proxy_voting_enabled ?? false}
                onChange={(e) => updateField('proxy_voting_enabled', e.target.checked)}
                className="h-4 w-4 text-red-600 rounded border-theme-input-border"
              />
              <label htmlFor="proxy_voting_enabled" className="text-sm text-theme-text-secondary">
                Allow proxy voting
              </label>
            </div>

            {settings.proxy_voting_enabled && (
              <div className="max-w-xs">
                <label className={labelClass}>Max Proxies Per Person</label>
                <input
                  type="number"
                  className={inputClass}
                  min={1}
                  max={10}
                  value={settings.max_proxies_per_person ?? 1}
                  onChange={(e) => updateField('max_proxies_per_person', parseInt(e.target.value, 10) || 1)}
                />
                <p className="text-xs text-theme-text-muted mt-1">
                  Maximum number of members one person can vote on behalf of.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Test Ballot */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-2">Test Ballot</h2>
          <p className="text-sm text-theme-text-muted mb-4">
            Send yourself a test ballot to preview the voting experience. Test votes are clearly
            marked and excluded from real results.
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <select
              className={selectClass + ' flex-1'}
              value={selectedTestElection}
              onChange={(e) => setSelectedTestElection(e.target.value)}
            >
              <option value="">Select a draft election...</option>
              {elections.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
            <button
              onClick={() => { void handleSendTestBallot(); }}
              disabled={sendingTest || !selectedTestElection}
              className="btn-info px-4 py-2 rounded-md text-sm flex items-center gap-2 whitespace-nowrap"
            >
              {sendingTest && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Test Ballot
            </button>
          </div>
        </section>

        {/* Security & Integrity */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
            Security & Integrity
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between py-2 border-b border-theme-surface-border">
              <span className="text-theme-text-secondary">Vote Signatures</span>
              <span className="font-medium text-green-600 dark:text-green-400">HMAC-SHA256</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-theme-surface-border">
              <span className="text-theme-text-secondary">Anonymity Salt Rotation</span>
              <span className="font-medium text-green-600 dark:text-green-400">Auto-destroyed on close</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-theme-surface-border">
              <span className="text-theme-text-secondary">Vote Chain Hashing</span>
              <span className="font-medium text-green-600 dark:text-green-400">Enabled</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-theme-surface-border">
              <span className="text-theme-text-secondary">Double-Vote Prevention</span>
              <span className="font-medium text-green-600 dark:text-green-400">DB-level unique constraint</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-theme-text-secondary">Voter Receipt Hashes</span>
              <span className="font-medium text-green-600 dark:text-green-400">Enabled</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ElectionsSettingsPage;
