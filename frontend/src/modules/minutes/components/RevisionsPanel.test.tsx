import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const mockRevisions = vi.fn();
const mockVerify = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getRevisions: (...a: unknown[]) => mockRevisions(...a) as unknown,
    verify: (...a: unknown[]) => mockVerify(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import { RevisionsPanel } from './RevisionsPanel';
import { renderWithRouter } from '../../../test/utils';

const v2 = {
  id: 'r2',
  minutes_id: 'm1',
  version: 2,
  content_hash: 'c'.repeat(64),
  approved_by_name: 'Casey Chief',
  submitted_by_name: 'Sam Secretary',
  approved_at: '2026-10-05T12:00:00Z',
  superseded_at: null,
};
const v1 = {
  id: 'r1',
  minutes_id: 'm1',
  version: 1,
  content_hash: 'a'.repeat(64),
  approved_by_name: 'Casey Chief',
  approved_at: '2026-10-02T12:00:00Z',
  superseded_at: '2026-10-03T12:00:00Z',
  superseded_by_name: 'Sam Secretary',
  superseded_reason: 'The location was recorded wrongly',
};

describe('RevisionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevisions.mockReset();
    mockVerify.mockReset();
    mockRevisions.mockResolvedValue([v2, v1]);
    mockVerify.mockResolvedValue({ verified: true, version: 2, changed: [], detail: 'ok' });
  });

  it('confirms approved minutes match the version in force', async () => {
    renderWithRouter(<RevisionsPanel minutesId="m1" status="approved" version="t1" />);

    expect(await screen.findByText('These minutes match version 2 as it was approved.')).toBeInTheDocument();
    expect(screen.getByText('In force')).toBeInTheDocument();
    expect(screen.getByText(/Approved .* by Casey Chief · submitted by Sam Secretary/)).toBeInTheDocument();
    expect(screen.getByText(`SHA-256 ${'c'.repeat(64)}`)).toBeInTheDocument();
  });

  it('keeps the replaced version with who reopened it and why', async () => {
    renderWithRouter(<RevisionsPanel minutesId="m1" status="approved" version="t1" />);

    expect(await screen.findByText('Replaced')).toBeInTheDocument();
    expect(screen.getByText(/Reopened .* by Sam Secretary: The location was recorded wrongly/)).toBeInTheDocument();
  });

  it('names what changed when the record no longer matches', async () => {
    mockVerify.mockResolvedValue({
      verified: false,
      version: 2,
      changed: ['location', 'attendees'],
      detail: 'Differs from version 2 as approved.',
    });
    renderWithRouter(<RevisionsPanel minutesId="m1" status="approved" version="t1" />);

    expect(await screen.findByText('These minutes no longer match version 2 as it was approved.')).toBeInTheDocument();
    expect(screen.getByText('Changed since approval: location, attendance.')).toBeInTheDocument();
  });

  it('explains minutes approved before versions were recorded', async () => {
    mockRevisions.mockResolvedValue([]);
    mockVerify.mockResolvedValue({
      verified: false,
      version: null,
      changed: [],
      detail: 'These minutes were approved before approved versions were recorded. Reopen and re-approve them.',
    });
    renderWithRouter(<RevisionsPanel minutesId="m1" status="approved" version="t1" />);

    expect(await screen.findByText('There is no approved version to check these minutes against.')).toBeInTheDocument();
    expect(screen.getByText(/approved before approved versions were recorded/)).toBeInTheDocument();
    expect(screen.getByText('No approved version is on file yet.')).toBeInTheDocument();
  });

  it('shows a reopened draft its history but does not verify it', async () => {
    mockRevisions.mockResolvedValue([v1]);
    renderWithRouter(<RevisionsPanel minutesId="m1" status="draft" version="t1" />);

    expect(await screen.findByText('Version 1')).toBeInTheDocument();
    expect(mockVerify).not.toHaveBeenCalled();
    expect(screen.queryByText(/match version/)).not.toBeInTheDocument();
  });

  it('shows nothing for a draft that was never approved', async () => {
    mockRevisions.mockResolvedValue([]);
    const { container } = renderWithRouter(<RevisionsPanel minutesId="m1" status="draft" version="t1" />);
    await waitFor(() => expect(mockRevisions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('reloads when the minutes change', async () => {
    const { rerender } = renderWithRouter(<RevisionsPanel minutesId="m1" status="approved" version="t1" />);
    await screen.findByText('Version 2');
    expect(mockVerify).toHaveBeenCalledTimes(1);

    rerender(<RevisionsPanel minutesId="m1" status="approved" version="t2" />);
    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(2));
  });
});
