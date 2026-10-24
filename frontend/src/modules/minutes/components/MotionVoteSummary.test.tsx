import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MotionVoteSummary } from './MotionVoteSummary';
import type { Motion } from '../types/minutes';

const motion = (overrides: Partial<Motion> = {}): Motion => ({
  id: 'm1',
  minutes_id: 'min',
  order: 0,
  motion_text: 'Buy hose.',
  status: 'passed',
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('MotionVoteSummary', () => {
  it('shows nothing for a motion carried without a count', () => {
    const { container } = render(<MotionVoteSummary motion={motion()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('states the totals, abstentions, recusals and a stricter threshold', () => {
    render(
      <MotionVoteSummary
        motion={motion({ votes_for: 7, votes_against: 2, votes_abstain: 1, votes_recused: 1, threshold: 'two_thirds' })}
      />
    );
    expect(
      screen.getByText('Vote: 7-2, 1 abstained, 1 recused · needed two-thirds of the votes cast')
    ).toBeInTheDocument();
  });

  it('shows a zero against as zero', () => {
    render(<MotionVoteSummary motion={motion({ votes_for: 4 })} />);
    expect(screen.getByText('Vote: 4-0')).toBeInTheDocument();
  });

  it('keeps who voted how behind a button', async () => {
    const user = userEvent.setup();
    render(
      <MotionVoteSummary
        motion={motion({
          votes_for: 1,
          votes_against: 1,
          roll_call: [
            { name: 'Pat Chief', vote: 'yes' },
            { name: 'Lee Treasurer', vote: 'no' },
          ],
        })}
      />
    );
    expect(screen.queryByText('Pat Chief: Yes')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show how each member voted' }));

    expect(screen.getByText('Pat Chief: Yes')).toBeInTheDocument();
    expect(screen.getByText('Lee Treasurer: No')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide how each member voted' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says so when the counts support a different result, and offers to change it', async () => {
    const onUse = vi.fn();
    render(
      <MotionVoteSummary
        motion={motion({ votes_for: 1, votes_against: 3, suggested_status: 'failed' })}
        onUseSuggested={onUse}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'The counts support failed, but the result is recorded as passed.'
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Change it to failed' }));
    expect(onUse).toHaveBeenCalledWith('failed');
  });

  it('is silent when the counts agree with the recorded result', () => {
    render(<MotionVoteSummary motion={motion({ votes_for: 3, votes_against: 1, suggested_status: 'passed' })} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not second-guess a tabled or withdrawn motion', () => {
    render(
      <MotionVoteSummary
        motion={motion({ status: 'tabled', votes_for: 1, votes_against: 3, suggested_status: 'failed' })}
      />
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers no change to someone who cannot edit', () => {
    render(<MotionVoteSummary motion={motion({ votes_for: 1, votes_against: 3, suggested_status: 'failed' })} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change it to/ })).toBeNull();
  });
});
