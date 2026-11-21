const getOptions = vi.fn();
const preview = vi.fn();

vi.mock('../../services/api', () => ({
  memberAudienceService: {
    getOptions: (...args: unknown[]) => getOptions(...args) as unknown,
    preview: (...args: unknown[]) => preview(...args) as unknown,
  },
}));

import { describe, expect, it, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MemberAudiencePicker from './MemberAudiencePicker';
import { EMPTY_AUDIENCE, type MemberAudienceChoice } from '../../types/memberAudience';

const OPTIONS = {
  member_classes: ['operational', 'administrative', 'social'],
  member_statuses: [
    { value: 'regular', label: null },
    { value: 'life', label: null },
    { value: 'senior', label: 'Senior Member' },
  ],
  positions: [{ id: 'pos-lt', name: 'Lieutenant' }],
};

const Harness: React.FC<{ onCount?: (n: number | null) => void }> = ({ onCount }) => {
  const [choice, setChoice] = useState<MemberAudienceChoice>(EMPTY_AUDIENCE);
  return <MemberAudiencePicker value={choice} onChange={setChoice} onCount={onCount} />;
};

describe('MemberAudiencePicker', () => {
  beforeEach(() => {
    getOptions.mockReset();
    preview.mockReset();
    getOptions.mockResolvedValue(OPTIONS);
    preview.mockResolvedValue({ recipients: 12, skipped_opted_out: 0 });
  });

  it('offers classes, built-in and department statuses, and positions', async () => {
    render(<Harness />);

    expect(await screen.findByRole('checkbox', { name: 'Administrative' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Life' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Senior Member' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Lieutenant' })).toBeInTheDocument();
  });

  it('counts the members the current choice reaches, as the server answers', async () => {
    const onCount = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCount={onCount} />);

    expect(await screen.findByText('12 members will be emailed')).toBeInTheDocument();
    preview.mockResolvedValue({ recipients: 3, skipped_opted_out: 2 });
    await user.click(screen.getByRole('checkbox', { name: 'Life' }));
    await user.click(screen.getByRole('checkbox', { name: 'Social' }));

    expect(await screen.findByText('3 members will be emailed')).toBeInTheDocument();
    expect(screen.getByText(/2 more match but turned off volunteer call emails/)).toBeInTheDocument();
    expect(preview).toHaveBeenLastCalledWith(
      { member_classes: ['social'], member_statuses: ['life'], position_ids: [] },
      expect.any(AbortSignal)
    );
    expect(onCount).toHaveBeenLastCalledWith(3);
  });

  it('says plainly when nobody matches', async () => {
    preview.mockResolvedValue({ recipients: 0, skipped_opted_out: 0 });
    const onCount = vi.fn();
    render(<Harness onCount={onCount} />);

    expect(await screen.findByText('No members match these choices')).toBeInTheDocument();
    await waitFor(() => expect(onCount).toHaveBeenLastCalledWith(0));
  });

  it('shows why the choices could not load', async () => {
    getOptions.mockRejectedValue(new Error('down'));
    render(<Harness />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
