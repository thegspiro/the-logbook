/**
 * Elections Settings Page
 *
 * Centralised configuration for election defaults, voter eligibility,
 * test ballots, ballot preview, and security posture.
 * Requires `elections.manage` permission.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Loader2, Settings as SettingsIcon, UserCheck, ToggleRight, Send, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { ElectionSettings, ElectionListItem } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { VotingMethod as VM, VictoryCondition as VC } from '../constants/enums';
import { SettingsLayout, type SettingsSection } from '../components/settings/SettingsLayout';
import SettingsPanelHead from '../components/settings/SettingsPanelHead';
import { SettingsToggle as Toggle } from '../components/settings/SettingsToggle';
import { useSettingsAutosave } from '../hooks/useSettingsAutosave';

type SectionKey = 'defaults' | 'proxy' | 'features' | 'test' | 'security';

const SECTIONS: SettingsSection<SectionKey>[] = [
  { key: 'defaults', label: 'Defaults', icon: SettingsIcon, description: 'Pre-filled values for new elections' },
  { key: 'proxy', label: 'Proxy Voting', icon: UserCheck, description: 'Voting on behalf of an absent member' },
  { key: 'features', label: 'Features', icon: ToggleRight, description: 'Optional election workflows' },
  { key: 'test', label: 'Test Ballot', icon: Send, description: 'Preview the voting experience' },
  { key: 'security', label: 'Security', icon: ShieldCheck, description: 'Integrity guarantees in force' },
];

const isSectionKey = (value: string | null): value is SectionKey =>
  value !== null && SECTIONS.some((section) => section.key === value);

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<ElectionSettings>({});
  const [elections, setElections] = useState<ElectionListItem[]>([]);
  const [selectedTestElection, setSelectedTestElection] = useState('');
  const { saveState, save, saveDebounced, retry } = useSettingsAutosave();
  const [sendingTest, setSendingTest] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [settingsData, electionsData] = await Promise.all([
        electionService.getSettings(),
        electionService.getElections('draft'),
      ]);
      setSettings(settingsData);
      // The savers read this ref, so the loaded values have to land in both.
      settingsRef.current = settingsData;
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

  // Every control writes on change; the header pill carries the outcome. The
  // page previously held one Save button at the top-right for five screens'
  // worth of fields, so a member who changed a value near the bottom had no
  // indication that anything still needed saving.
  /**
   * Mirrors `settings` so a write sends the object as it stands when the
   * request goes out. These writes send the whole settings object, so a
   * debounced save closing over its scheduled snapshot would undo any switch
   * flipped while it was pending.
   */
  const settingsRef = useRef<ElectionSettings>(settings);

  const updateField = <K extends keyof ElectionSettings>(
    key: K,
    value: ElectionSettings[K],
    { immediate = true }: { immediate?: boolean } = {}
  ) => {
    const next = { ...settingsRef.current, [key]: value };
    settingsRef.current = next;
    setSettings(next);
    const write = () => electionService.updateSettings(settingsRef.current);
    if (immediate) {
      void save(write, { errorMessage: 'Failed to save settings' });
    } else {
      saveDebounced('election-settings', write, { errorMessage: 'Failed to save settings' });
    }
  };

  const activeSection: SectionKey = isSectionKey(searchParams.get('tab'))
    ? (searchParams.get('tab') as SectionKey)
    : 'defaults';

  const switchSection = (key: SectionKey) => {
    setSearchParams(key === 'defaults' ? {} : { tab: key }, { replace: true });
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      );
    }

    switch (activeSection) {
      case 'proxy':
        return (
          <div>
            <SettingsPanelHead
              title="Proxy Voting"
              description="When enabled, a secretary can authorize one member to vote on behalf of another absent member."
            />
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.proxy_voting_enabled ?? false}
                  onChange={(next) => updateField('proxy_voting_enabled', next)}
                  label="Allow proxy voting"
                />
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
                    onChange={(e) =>
                      updateField('max_proxies_per_person', parseInt(e.target.value, 10) || 1, { immediate: false })
                    }
                  />
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Maximum number of members one person can vote on behalf of.
                  </p>
                </div>
              )}
            </div>
          </div>
        );

      case 'features':
        return (
          <div>
            <SettingsPanelHead
              title="Features"
              description="Optional election workflows for your department. All features are on by default. Automatic closing at the end date is always on — it finalizes results and runs the anonymity purge."
            />
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.nominations_enabled ?? true}
                  onChange={(next) => updateField('nominations_enabled', next)}
                  label="Nomination phase — members nominate candidates (with accept/decline) before the ballot opens"
                />
              </div>

              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.paper_ballots_enabled ?? true}
                  onChange={(next) => updateField('paper_ballots_enabled', next)}
                  label="Paper-ballot entry — officers record in-room paper tallies into the results"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pl-7">
                <label htmlFor="paper_ballot_attestations_required" className="text-theme-text-secondary text-sm">
                  Officers who must confirm each paper batch before it counts (besides the recorder):
                </label>
                <select
                  id="paper_ballot_attestations_required"
                  value={settings.paper_ballot_attestations_required ?? 2}
                  onChange={(e) => updateField('paper_ballot_attestations_required', parseInt(e.target.value, 10))}
                  className="form-input-sm"
                >
                  <option value={0}>None — counts immediately</option>
                  <option value={1}>1 attestation</option>
                  <option value={2}>2 attestations (recommended)</option>
                  <option value={3}>3 attestations</option>
                </select>
              </div>

              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.reminders_enabled ?? true}
                  onChange={(next) => updateField('reminders_enabled', next)}
                  label="Non-voter reminders — manual and automatic reminder emails with fresh ballot links"
                />
              </div>

              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.auto_open_enabled ?? true}
                  onChange={(next) => updateField('auto_open_enabled', next)}
                  label={
                    'Scheduled opening — elections flagged "open automatically" open themselves at their start time'
                  }
                />
              </div>
            </div>
          </div>
        );

      case 'test':
        return (
          <div>
            <SettingsPanelHead
              title="Test Ballot"
              description="Send yourself a test ballot to preview the voting experience. Test votes are clearly marked and excluded from real results."
            />
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
          </div>
        );

      case 'security':
        return (
          <div>
            <SettingsPanelHead
              title="Security & Integrity"
              description="Guarantees the platform enforces on every ballot. These are not configurable."
            />
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
          </div>
        );

      case 'defaults':
        return (
          <div>
            <SettingsPanelHead
              title="Default Election Settings"
              description="These defaults pre-populate the creation form. They can be overridden per-election and per-ballot-item."
            />
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
                    onChange={(e) =>
                      updateField('default_victory_percentage', parseInt(e.target.value, 10) || undefined, {
                        immediate: false,
                      })
                    }
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
                    onChange={(e) =>
                      updateField('default_quorum_value', parseInt(e.target.value, 10) || undefined, {
                        immediate: false,
                      })
                    }
                  />
                </div>
              )}

              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.default_anonymous_voting ?? true}
                  onChange={(next) => updateField('default_anonymous_voting', next)}
                  label="Anonymous voting by default"
                />
              </div>

              <div className="flex items-center gap-3">
                <Toggle
                  checked={settings.default_allow_write_ins ?? false}
                  onChange={(next) => updateField('default_allow_write_ins', next)}
                  label="Allow write-in candidates by default"
                />
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <SettingsLayout<SectionKey>
      sections={SECTIONS}
      activeSection={activeSection}
      onSectionChange={switchSection}
      navLabel="Election settings sections"
      title="Election Settings"
      subtitle="Defaults, proxy voting, and ballot integrity"
      saveState={saveState}
      onRetrySave={retry}
      onBack={() => void navigate('/elections')}
      backLabel="Back to elections"
    >
      {renderContent()}
    </SettingsLayout>
  );
};

export default ElectionsSettingsPage;
