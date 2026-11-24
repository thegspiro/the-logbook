import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const checkPublicStatus = vi.fn();

vi.mock('../services/api', () => ({
  eventRequestService: {
    checkPublicStatus: (...args: unknown[]) => checkPublicStatus(...args) as unknown,
    getOutreachTypeLabels: () => Promise.resolve({ fire_safety_demo: 'Fire Safety Demo' }),
  },
}));

vi.mock('../services/outreachFeedbackServices', () => ({
  outreachFeedbackService: {
    getPublicFeedbackForm: () =>
      Promise.resolve({ form_name: 'Outreach feedback', contact_name: 'Pat Rivera', fields: [] }),
  },
}));

// The visitor's own clock: a requester whose laptop is on UTC.
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import EventRequestStatusPage from './EventRequestStatusPage';

const STATUS = {
  contact_name: 'Pat Rivera',
  outreach_type: 'fire_safety_demo',
  status: 'scheduled',
  date_flexibility: 'specific_dates',
  preferred_date_start: '2027-01-15',
  preferred_date_end: '2027-01-29',
  created_at: '2026-11-20T19:49:48Z',
  updated_at: '2026-11-20T19:51:00Z',
  // 6:00 PM on the 21st in Chicago is already the 22nd in UTC.
  event_date: '2027-01-22T00:00:00Z',
  can_cancel: true,
  timezone: 'America/Chicago',
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/event-request/status/tok']}>
      <Routes>
        <Route path="/event-request/status/:token" element={<EventRequestStatusPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('EventRequestStatusPage dates', () => {
  beforeEach(() => {
    checkPublicStatus.mockReset();
    checkPublicStatus.mockResolvedValue(STATUS);
  });

  it('shows the requested days as written, whatever the visitor’s timezone', async () => {
    renderPage();

    expect(await screen.findByText(/Jan 15, 2027 — Jan 29, 2027/)).toBeInTheDocument();
  });

  it('shows the scheduled date on the department’s calendar, not the visitor’s', async () => {
    renderPage();

    expect(await screen.findByText('1/21/2027')).toBeInTheDocument();
    expect(screen.queryByText('1/22/2027')).not.toBeInTheDocument();
  });
});

describe('EventRequestStatusPage feedback', () => {
  beforeEach(() => {
    checkPublicStatus.mockReset();
  });

  it("offers the department's feedback form once the request is completed", async () => {
    checkPublicStatus.mockResolvedValue({ ...STATUS, status: 'completed', can_cancel: false, feedback_offered: true });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Outreach feedback' })).toBeInTheDocument();
  });

  it('thanks a requester who has already answered', async () => {
    checkPublicStatus.mockResolvedValue({ ...STATUS, status: 'completed', can_cancel: false, feedback_sent: true });
    renderPage();

    expect(await screen.findByText(/Thank you for your feedback/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Outreach feedback' })).not.toBeInTheDocument();
  });
});
