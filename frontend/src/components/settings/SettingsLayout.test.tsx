import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bell, Settings } from 'lucide-react';
import { SettingsLayout, type SettingsSection } from './SettingsLayout';

type Key = 'general' | 'alerts';
type Page = 'profile' | 'contact';

const SECTIONS: SettingsSection<Key, Page>[] = [
  {
    key: 'general',
    label: 'General',
    icon: Settings,
    description: 'Basics',
    subPages: [
      { key: 'profile', label: 'Profile', hint: 'Name and logo' },
      { key: 'contact', label: 'Contact', hint: 'Phone and email' },
    ],
  },
  { key: 'alerts', label: 'Alerts', icon: Bell, description: 'Who gets told' },
];

interface Overrides {
  activeSection?: Key;
  activeSubPage?: Page | null;
  onSectionChange?: (key: Key) => void;
  onSubPageChange?: (key: Page) => void;
  width?: 'standard' | 'wide';
}

function renderLayout({
  activeSection = 'general',
  activeSubPage = 'profile',
  onSectionChange = vi.fn(),
  onSubPageChange = vi.fn(),
  width,
}: Overrides = {}): void {
  render(
    <SettingsLayout<Key, Page>
      sections={SECTIONS}
      activeSection={activeSection}
      onSectionChange={onSectionChange}
      activeSubPage={activeSubPage}
      onSubPageChange={onSubPageChange}
      navLabel="Test settings sections"
      title="Test Settings"
      {...(width ? { width } : {})}
    >
      <p>Content for {activeSection}</p>
    </SettingsLayout>
  );
}

/**
 * The two elements carrying the content width caps: the column the section nav
 * sits in, and the container around it.
 *
 * Structural rather than a Testing Library query because a width cap is not
 * something a user or a screen reader can observe — there is no role, name or
 * text for "this column stops at 960px". Both walks are done here, once, so
 * the tests below read as assertions rather than as DOM traversal.
 */
const widthCaps = (): { column: HTMLElement; container: HTMLElement } => {
  // eslint-disable-next-line testing-library/no-node-access -- see above
  const column = sectionNav().parentElement;
  // eslint-disable-next-line testing-library/no-node-access -- see above
  const container = column?.parentElement;
  if (!column || !container) throw new Error('section nav is not nested as expected');
  return { column, container };
};

const sectionNav = (): HTMLElement => screen.getByRole('navigation', { name: 'Test settings sections' });

describe('SettingsLayout', () => {
  it('renders the page title and the active section content', () => {
    renderLayout();

    expect(screen.getByRole('heading', { name: 'Test Settings' })).toBeInTheDocument();
    expect(screen.getByText('Content for general')).toBeInTheDocument();
  });

  // One landmark per level at every width: the section row is a single nav that
  // scrolls below md rather than a second copy hidden by breakpoint, so a
  // screen reader is not offered the same list twice.
  it('exposes the section list as one labelled landmark', () => {
    renderLayout();

    expect(screen.getAllByRole('navigation', { name: 'Test settings sections' })).toHaveLength(1);
    expect(within(sectionNav()).getByRole('button', { name: /General/ })).toBeInTheDocument();
    expect(within(sectionNav()).getByRole('button', { name: /Alerts/ })).toBeInTheDocument();
  });

  it('falls back to the active section description for the subtitle', () => {
    renderLayout({ activeSection: 'alerts', activeSubPage: null });

    expect(screen.getByText('Who gets told')).toBeInTheDocument();
  });

  it('marks only the active section with aria-current', () => {
    renderLayout({ activeSection: 'alerts', activeSubPage: null });

    expect(within(sectionNav()).getByRole('button', { name: /Alerts/ })).toHaveAttribute('aria-current', 'page');
    expect(within(sectionNav()).getByRole('button', { name: /General/ })).not.toHaveAttribute('aria-current');
  });

  it('reports the section the user picked', async () => {
    const user = userEvent.setup();
    const onSectionChange = vi.fn();
    renderLayout({ onSectionChange });

    await user.click(within(sectionNav()).getByRole('button', { name: /Alerts/ }));

    expect(onSectionChange).toHaveBeenCalledWith('alerts');
  });

  it('renders the sub-page rail for a section that has sub-pages', () => {
    renderLayout();

    const rail = screen.getByRole('navigation', { name: 'General pages' });
    expect(within(rail).getByRole('button', { name: /Profile/ })).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getByRole('button', { name: /Contact/ })).not.toHaveAttribute('aria-current');
  });

  it('reports the sub-page the user picked', async () => {
    const user = userEvent.setup();
    const onSubPageChange = vi.fn();
    renderLayout({ onSubPageChange });

    await user.click(
      within(screen.getByRole('navigation', { name: 'General pages' })).getByRole('button', { name: /Contact/ })
    );

    expect(onSubPageChange).toHaveBeenCalledWith('contact');
  });

  // A section with nothing beneath it drops the rail rather than rendering an
  // empty one, so the panel runs the full width of the column.
  describe('content width', () => {
    it('caps the column at 960px by default', () => {
      renderLayout();

      const { column } = widthCaps();
      expect(column.className).toContain('max-w-[960px]');
      expect(column.className).not.toContain('max-w-[1600px]');
    });

    it('widens both the column and its container when asked', () => {
      // Both, deliberately. The outer container's max-w-6xl is 1152px, so
      // widening only the inner column would clamp it back down to 1152 with
      // nothing in the markup saying why — a wide layout that is quietly not
      // as wide as it asked for is worse than one that never widened.
      renderLayout({ width: 'wide' });

      const { column, container } = widthCaps();
      expect(column.className).toContain('max-w-[1600px]');
      expect(container.className).toContain('max-w-[1600px]');
      expect(container.className).not.toContain('max-w-6xl');
    });
  });

  it('omits the rail for a section with no sub-pages', () => {
    renderLayout({ activeSection: 'alerts', activeSubPage: null });

    expect(screen.queryByRole('navigation', { name: 'Alerts pages' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
  });
});
