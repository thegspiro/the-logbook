/**
 * Elections Settings Page
 *
 * Centralised configuration for election defaults, voter eligibility,
 * test ballots, ballot preview, and security posture.
 * Requires `elections.manage` permission.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { ElectionSettings, ElectionListItem } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { VotingMethod as VM, VictoryCondition as VC } from '../constants/enums';

const VOTING_METHOD_OPTIONS = [
  { value: VM.SIMPLE_MAJORITY, label: 'Simple Majority' },
  { value: VM.RANKED_CHOICE, label: 'Ranked Choice (IRV)' },
  { value: VM.APPROVAL, label: 'Approval Voting' },
  { value: VM.SUPERMAJORITY, label: 'Supermajority' },
] as const;

const VICTORY_CONDITION_OPTIONS = [
  { value: VC.MOST_VOTES, label: 'Most Votes (Plurality)' },
  { value: VC.MAJORITY, label: 'Majority (>50%)' },
  { value: VC.SUPERMAJORITY, label: 'Supermajority' },
  { value: VC.THRESHOLD, label: 'Threshold' },
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
      <div className="flex min-h-[60dvh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void navigate('/elections')}
            className="hover:bg-theme-surface-secondary text-theme-text-muted rounded-md p-2"
            aria-label="Back to elections"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-theme-text-primary text-2xl font-bold">Election Settings</h1>
        </div>
        <button
          onClick={() => {
            void handleSave();
          }}
          disabled={saving}
          className="btn-primary flex items-center gap-2 rounded-md px-4 py-2 text-sm"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>
      </div>

      <div className="space-y-6">
        {/* Default Election Settings */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Default Election Settings</h2>
          <p className="text-theme-text-muted mb-4 text-sm">
            These defaults pre-populate the creation form. They can be overridden per-election and per-ballot-item.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Default Voting Method</label>
              <select
                className={selectClass}
                value={settings.default_voting_method ?? VM.SIMPLE_MAJORITY}
                onChange={(e) =>
                  updateField('default_voting_method', e.target.value as ElectionSettings['default_voting_method'])
                }
              >
                {VOTING_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>Default Victory Condition</label>
              <select
                className={selectClass}
                value={settings.default_victory_condition ?? VC.MOST_VOTES}
                onChange={(e) =>
                  updateField(
                    'default_victory_condition',
                    e.target.value as ElectionSettings['default_victory_condition']
                  )
                }
              >
                {VICTORY_CONDITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {(settings.default_victory_condition === VC.SUPERMAJORITY ||
              settings.default_victory_condition === VC.THRESHOLD) && (
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
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
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
                className="border-theme-input-border h-4 w-4 rounded text-red-600"
              />
              <label htmlFor="default_anonymous" className="text-theme-text-secondary text-sm">
                Anonymous voting by default
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="default_write_ins"
                checked={settings.default_allow_write_ins ?? false}
                onChange={(e) => updateField('default_allow_write_ins', e.target.checked)}
                className="border-theme-input-border h-4 w-4 rounded text-red-600"
              />
              <label htmlFor="default_write_ins" className="text-theme-text-secondary text-sm">
                Allow write-in candidates by default
              </label>
            </div>
          </div>
        </section>

        {/* Proxy Voting */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-theme-text-primary mb-2 text-lg font-semibold">Proxy Voting</h2>
          <p className="text-theme-text-muted mb-4 text-sm">
            When enabled, a secretary can authorize one member to vote on behalf of another absent member.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="proxy_voting_enabled"
                checked={settings.proxy_voting_enabled ?? false}
                onChange={(e) => updateField('proxy_voting_enabled', e.target.checked)}
                className="border-theme-input-border h-4 w-4 rounded text-red-600"
              />
              <label htmlFor="proxy_voting_enabled" className="text-theme-text-secondary text-sm">
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
                <p className="text-theme-text-muted mt-1 text-xs">
                  Maximum number of members one person can vote on behalf of.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Feature Toggles */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-theme-text-primary mb-2 text-lg font-semibold">Features</h2>
          <p className="text-theme-text-muted mb-4 text-sm">
            Turn optional election workflows on or off for your department. All features are on by default. Automatic
            closing at the end date is always on — it finalizes results and runs the anonymity purge.
          </p>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="nominations_enabled"
                checked={settings.nominations_enabled ?? true}
                onChange={(e) => updateField('nominations_enabled', e.target.checked)}
                className="border-theme-input-border h-4 w-4 rounded text-red-600"
              />
              <label htmlFor="nominations_enabled" className="text-theme-text-secondary text-sm">
                Nomination phase — members nominate candidates (with accept/decline) before the ballot opens
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="paper_ballots_enabled"
                checked={settings.paper_ballots_enabled ?? true}
                onChange={(e) => updateField('paper_ballots_enabled', e.target.checked)}
                className="border-theme-input-border h-4 w-4 rounded text-red-600"
              />
              <label htmlFor="paper_ballots_enabled" className="text-theme-text-secondary text-sm">
                Paper-ballot entry — officers record in-room paper tallies into the results
              </label>
            </div>

            <div className="flex items-center gap-3 pl-7">
              <label htmlFor="paper_ballot_attestations_required" className="text-theme-text-secondary text-sm">
                Officers who must confirm each paper batch before it counts (besides the recorder):
              </label>
              <select
                id="paper_ballot_attestations_required"
                value={settings.paper_ballot_attestations_required ?? 2}
                onChange={(e) => updateField('paper_ballot_attestations_required', parseInt(e.target.value, 10))}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary rounded-md border px-2 py-1 text-sm"
              >
                <option value={0}>None — counts immediately</option>
                <option value={1}>1 attestation</option>
                <option value={2}>2 attestations (recommended)</option>
                <option value={3}>3 attestations</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="reminders_enabled"
                checked={settings.reminders_enabled ?? true}
                onChange={(e) => updateField('reminders_enabled', e.target.checked)}
                className="border-theme-input-border h-4 w-4 rounded text-red-600"
              />
              <label htmlFor="reminders_enabled" className="text-theme-text-secondary text-sm">
                Non-voter reminders — manual and automatic reminder emails with fresh ballot links
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="auto_open_enabled"
                checked={settings.auto_open_enabled ?? true}
                onChange={(e) => updateField('auto_open_enabled', e.target.checked)}
                className="border-theme-input-border h-4 w-4 rounded text-red-600"
              />
              <label htmlFor="auto_open_enabled" className="text-theme-text-secondary text-sm">
                Scheduled opening — elections flagged "open automatically" open themselves at their start time
              </label>
            </div>
          </div>
        </section>

        {/* Test Ballot */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-theme-text-primary mb-2 text-lg font-semibold">Test Ballot</h2>
          <p className="text-theme-text-muted mb-4 text-sm">
            Send yourself a test ballot to preview the voting experience. Test votes are clearly marked and excluded
            from real results.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              className={selectClass + ' flex-1'}
              value={selectedTestElection}
              onChange={(e) => setSelectedTestElection(e.target.value)}
            >
              <option value="">Select a draft election...</option>
              {elections.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                void handleSendTestBallot();
              }}
              disabled={sendingTest || !selectedTestElection}
              className="btn-info flex items-center gap-2 rounded-md px-4 py-2 text-sm whitespace-nowrap"
            >
              {sendingTest && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Test Ballot
            </button>
          </div>
        </section>

        {/* Security & Integrity */}
        <section className="bg-theme-surface rounded-lg p-6 shadow-sm">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Security & Integrity</h2>
          <div className="space-y-3 text-sm">
            <div className="border-theme-surface-border flex items-center justify-between border-b py-2">
              <span className="text-theme-text-secondary">Vote Signatures</span>
              <span className="font-medium text-green-600 dark:text-green-400">HMAC-SHA256</span>
            </div>
            <div className="border-theme-surface-border flex items-center justify-between border-b py-2">
              <span className="text-theme-text-secondary">Anonymity Salt Rotation</span>
              <span className="font-medium text-green-600 dark:text-green-400">Auto-destroyed on close</span>
            </div>
            <div className="border-theme-surface-border flex items-center justify-between border-b py-2">
              <span className="text-theme-text-secondary">Vote Chain Hashing</span>
              <span className="font-medium text-green-600 dark:text-green-400">Enabled</span>
            </div>
            <div className="border-theme-surface-border flex items-center justify-between border-b py-2">
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
