import { describe, it, expect, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { EventDetailTabs, type EventDetailTab } from './EventDetailTabs';

const Draft = () => {
  const [text, setText] = useState('');
  return <input aria-label="Outcome note" value={text} onChange={(e) => setText(e.target.value)} />;
};

const tabs = (overrides: Partial<Record<string, React.ReactNode>> = {}): EventDetailTab[] => [
  { id: 'overview', label: 'Overview', content: overrides.overview ?? <p>Event details</p> },
  {
    id: 'attendance',
    label: 'Attendance (2)',
    content: 'attendance' in overrides ? overrides.attendance : <p>Roster</p>,
  },
  { id: 'staffing', label: 'Staffing & outreach', content: 'staffing' in overrides ? overrides.staffing : <Draft /> },
];

describe('EventDetailTabs', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('shows the first section and hides the rest', () => {
    renderWithRouter(<EventDetailTabs tabs={tabs()} />);

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Event details')).toBeVisible();
    expect(screen.getByText('Roster')).not.toBeVisible();
  });

  it('switches section on a tab and records it in the address', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventDetailTabs tabs={tabs()} />);

    await user.click(screen.getByRole('tab', { name: 'Attendance (2)' }));

    expect(screen.getByText('Roster')).toBeVisible();
    expect(screen.getByText('Event details')).not.toBeVisible();
    expect(window.location.search).toBe('?tab=attendance');
  });

  it('opens on the section the address names', () => {
    window.history.replaceState({}, '', '/?tab=attendance');
    renderWithRouter(<EventDetailTabs tabs={tabs()} />);

    expect(screen.getByRole('tab', { name: 'Attendance (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Roster')).toBeVisible();
  });

  it('gives a section with nothing in it no tab, and falls back when the address names it', () => {
    window.history.replaceState({}, '', '/?tab=attendance');
    renderWithRouter(<EventDetailTabs tabs={tabs({ attendance: null })} />);

    expect(screen.queryByRole('tab', { name: /^Attendance/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Event details')).toBeVisible();
  });

  it('draws no tab bar when only one section has anything in it', () => {
    renderWithRouter(<EventDetailTabs tabs={tabs({ attendance: null, staffing: null })} />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('Event details')).toBeVisible();
  });

  it('keeps a half-filled form while another section is open', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventDetailTabs tabs={tabs()} />);

    await user.click(screen.getByRole('tab', { name: 'Staffing & outreach' }));
    await user.type(screen.getByRole('textbox', { name: 'Outcome note' }), 'Forty came');
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('tab', { name: 'Staffing & outreach' }));

    expect(screen.getByRole('textbox', { name: 'Outcome note' })).toHaveValue('Forty came');
  });

  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    renderWithRouter(<EventDetailTabs tabs={tabs()} />);

    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Attendance (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Attendance (2)' })).toHaveFocus();
  });
});

describe('EventDetailTabs with a card that fills in later', () => {
  const Filling = () => {
    const [loaded, setLoaded] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setLoaded(true)}>
          Finish loading
        </button>
        <EventDetailTabs
          tabs={[
            { id: 'overview', label: 'Overview', content: <p>Event details</p> },
            { id: 'staffing', label: 'Staffing & outreach', content: loaded ? <p>Signup sheet</p> : null },
          ]}
        />
      </>
    );
  };

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('adds the tab once its section has something to show', async () => {
    const user = userEvent.setup();
    renderWithRouter(<Filling />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish loading' }));

    expect(await screen.findByRole('tab', { name: 'Staffing & outreach' })).toBeInTheDocument();
  });
});
