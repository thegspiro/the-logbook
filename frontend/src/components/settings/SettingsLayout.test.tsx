import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bell, Settings } from 'lucide-react';
import { SettingsLayout, type SettingsSection } from './SettingsLayout';

type Key = 'general' | 'alerts';

const SECTIONS: SettingsSection<Key>[] = [
  { key: 'general', label: 'General', icon: Settings, description: 'Basics' },
  { key: 'alerts', label: 'Alerts', icon: Bell, description: 'Who gets told' },
];

function renderLayout(activeSection: Key, onSectionChange: (key: Key) => void = vi.fn()): void {
  render(
    <SettingsLayout
      sections={SECTIONS}
      activeSection={activeSection}
      onSectionChange={onSectionChange}
      navLabel="Test settings sections"
      header={<h1>Test Settings</h1>}
    >
      <p>Content for {activeSection}</p>
    </SettingsLayout>
  );
}

describe('SettingsLayout', () => {
  it('renders the header and the active section content', () => {
    renderLayout('general');

    expect(screen.getByRole('heading', { name: 'Test Settings' })).toBeInTheDocument();
    expect(screen.getByText('Content for general')).toBeInTheDocument();
  });

  // Both nav landmarks are rendered at once and hidden by breakpoint, so each
  // section button appears twice — assert per-landmark rather than globally.
  it('labels both nav landmarks so the section list is findable', () => {
    renderLayout('general');

    const navs = screen.getAllByRole('navigation', { name: 'Test settings sections' });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(within(nav).getByRole('button', { name: /General/ })).toBeInTheDocument();
      expect(within(nav).getByRole('button', { name: /Alerts/ })).toBeInTheDocument();
    }
  });

  it('marks only the active section with aria-current', () => {
    renderLayout('alerts');

    const nav = screen.getAllByRole('navigation', { name: 'Test settings sections' })[0] as HTMLElement;
    expect(within(nav).getByRole('button', { name: /Alerts/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: /General/ })).not.toHaveAttribute('aria-current');
  });

  it('reports the section the user picked', async () => {
    const user = userEvent.setup();
    const onSectionChange = vi.fn();
    renderLayout('general', onSectionChange);

    const nav = screen.getAllByRole('navigation', { name: 'Test settings sections' })[0] as HTMLElement;
    await user.click(within(nav).getByRole('button', { name: /Alerts/ }));

    expect(onSectionChange).toHaveBeenCalledWith('alerts');
  });

  it('shows section descriptions in the desktop sidebar', () => {
    renderLayout('general');

    expect(screen.getByText('Who gets told')).toBeInTheDocument();
  });
});
