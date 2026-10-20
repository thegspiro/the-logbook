/**
 * Minutes Settings: every department-wide choice about meeting minutes, in one
 * place.
 *
 * Attendance, signatures, reminders and publishing used to be four buttons on
 * the Minutes page, each opening its own dialog. They share one read
 * (`GET /minutes-records/settings`, what the server applies) and one write path
 * (the organization settings, `settings.manage`), so they live together on the
 * department's one settings screen: anyone who manages minutes can read them,
 * and only a settings administrator changes them.
 *
 * Outlines are not here. They are a working tool, edited and applied meeting by
 * meeting, not a department setting.
 */

import React from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Globe, PenLine, Bell, Users, Vote } from 'lucide-react';
import { SettingsLayout, type SettingsSection } from '../../../components/settings/SettingsLayout';
import SettingsPanelHead from '../../../components/settings/SettingsPanelHead';
import { useAuthStore } from '../../../stores/authStore';
import { AttendanceListingPanel } from '../components/AttendanceListingPanel';
import { ElectionFilingPanel } from '../components/ElectionFilingPanel';
import { PublishingSettingsPanel } from '../components/PublishingSettingsPanel';
import { ReminderSettingsPanel } from '../components/ReminderSettingsPanel';
import { SignerSettingsPanel } from '../components/SignerSettingsPanel';
import { useMinutesSettings } from '../hooks/useMinutesSettings';

type SectionKey = 'attendance' | 'signatures' | 'reminders' | 'publishing' | 'elections';

const SECTIONS: SettingsSection<SectionKey>[] = [
  { key: 'attendance', label: 'Attendance', icon: Users, description: 'Who the minutes name' },
  { key: 'signatures', label: 'Signatures', icon: PenLine, description: 'Who signs adopted minutes' },
  { key: 'reminders', label: 'Reminders', icon: Bell, description: 'Following up action items' },
  { key: 'publishing', label: 'Publishing', icon: Globe, description: 'The library and the public page' },
  { key: 'elections', label: 'Elections', icon: Vote, description: 'Filing results with the minutes' },
];

const HEADINGS: Record<SectionKey, { title: string; description: string }> = {
  attendance: {
    title: 'How attendance is listed',
    description: 'The roll is always recorded in full. This chooses who a reader of the minutes is shown.',
  },
  signatures: {
    title: 'Who signs adopted minutes',
    description: 'The signatures asked for once minutes are adopted, in order.',
  },
  reminders: {
    title: 'Action item reminders',
    description: 'How assignees and minutes managers are reminded of open action items.',
  },
  publishing: {
    title: 'Publishing minutes',
    description: 'Where adopted minutes are filed and whether a public copy is posted.',
  },
  elections: {
    title: 'Election results',
    description: 'Whether a closed election files its result with the minutes of its meeting.',
  },
};

const isSectionKey = (value: string | null): value is SectionKey =>
  value !== null && SECTIONS.some((section) => section.key === value);

export const MinutesSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canEdit = checkPermission('settings.manage') || checkPermission('organization.update_settings');
  const { settings, error, reload } = useMinutesSettings();

  const tab = searchParams.get('tab');
  const active: SectionKey = isSectionKey(tab) ? tab : 'attendance';
  const heading = HEADINGS[active];

  const panel = () => {
    if (!settings) return null;
    const props = { settings, canEdit, onSaved: reload };
    switch (active) {
      case 'attendance':
        return <AttendanceListingPanel {...props} />;
      case 'signatures':
        return <SignerSettingsPanel {...props} />;
      case 'reminders':
        return <ReminderSettingsPanel {...props} />;
      case 'publishing':
        return <PublishingSettingsPanel {...props} />;
      case 'elections':
        return <ElectionFilingPanel {...props} />;
    }
  };

  return (
    <SettingsLayout
      sections={SECTIONS}
      activeSection={active}
      onSectionChange={(key) => setSearchParams({ tab: key }, { replace: true })}
      navLabel="Minutes settings sections"
      title="Minutes Settings"
      onBack={() => {
        void navigate('/minutes');
      }}
      backLabel="Back to Minutes"
    >
      <SettingsPanelHead title={heading.title} description={heading.description} />
      {error && (
        <p className="alert-danger text-sm" role="alert">
          {error}
        </p>
      )}
      {!settings && !error && <p className="text-theme-text-muted text-sm">Loading…</p>}
      {panel()}
    </SettingsLayout>
  );
};

export default MinutesSettingsPage;
