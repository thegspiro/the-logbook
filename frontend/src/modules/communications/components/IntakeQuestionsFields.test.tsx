import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { IntakeQuestion } from '../types/suggestions';

const mockPickOptions = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    pickOptions: (...args: unknown[]) => mockPickOptions(...args) as unknown,
  },
}));

import IntakeQuestionsFields from './IntakeQuestionsFields';

let latest: Record<string, string> = {};

const Harness: React.FC<{ questions: IntakeQuestion[] }> = ({ questions }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <IntakeQuestionsFields
      questions={questions}
      values={values}
      onChange={(id, value) =>
        setValues((current) => {
          latest = { ...current, [id]: value };
          return latest;
        })
      }
    />
  );
};

const rating: IntakeQuestion = { id: 'urgency', label: 'How urgent?', type: 'rating', required: true, options: [] };
const deadline: IntakeQuestion = {
  id: 'deadline',
  label: 'What is the deadline?',
  type: 'date',
  required: false,
  options: [],
  conditionQuestionId: 'urgency',
  conditionOperator: 'at_least',
  conditionValue: '4',
};
const member: IntakeQuestion = { id: 'who', label: 'Who is this about?', type: 'member', required: false, options: [] };
const vehicle: IntakeQuestion = { id: 'rig', label: 'Which vehicle?', type: 'apparatus', required: false, options: [] };

describe('IntakeQuestionsFields — rating and time', () => {
  beforeEach(() => {
    latest = {};
    mockPickOptions.mockReset();
  });

  it('records a rating and shows its follow-up from the threshold up', async () => {
    renderWithRouter(<Harness questions={[rating, deadline]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: '3' }));
    expect(latest).toEqual({ urgency: '3' });
    expect(screen.queryByLabelText(/deadline/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '4' }));
    expect(screen.getByLabelText(/deadline/)).toBeInTheDocument();
    expect(mockPickOptions).not.toHaveBeenCalled();
  });

  it('takes a time of day', async () => {
    const when: IntakeQuestion = { id: 'when', label: 'What time?', type: 'time', required: false, options: [] };
    renderWithRouter(<Harness questions={[when]} />);
    const user = userEvent.setup();

    const input = screen.getByLabelText('What time?');
    expect(input).toHaveAttribute('type', 'time');
    await user.type(input, '14:30');
    expect(latest).toEqual({ when: '14:30' });
  });
});

describe('IntakeQuestionsFields — picking a member or vehicle', () => {
  beforeEach(() => {
    latest = {};
    mockPickOptions.mockReset();
    mockPickOptions.mockImplementation((kind: string) =>
      Promise.resolve(
        kind === 'member'
          ? [
              { id: 'u1', name: 'Riley Member' },
              { id: 'u2', name: 'Sam Member' },
            ]
          : []
      )
    );
  });

  it('loads the whole list once and narrows it without another request', async () => {
    renderWithRouter(<Harness questions={[member]} />);
    const user = userEvent.setup();
    const group = screen.getByRole('group', { name: 'Who is this about?' });

    const filter = await within(group).findByPlaceholderText('Type to find a member');
    await user.type(filter, 'ril');
    expect(within(group).queryByRole('button', { name: 'Sam Member' })).not.toBeInTheDocument();
    await user.click(within(group).getByRole('button', { name: 'Riley Member' }));

    expect(latest).toEqual({ who: 'u1' });
    expect(within(group).getByText('Riley Member')).toBeInTheDocument();
    expect(mockPickOptions).toHaveBeenCalledTimes(1);
    expect(mockPickOptions).toHaveBeenCalledWith('member');
  });

  it('lets a member clear the choice and pick again', async () => {
    renderWithRouter(<Harness questions={[member]} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Sam Member' }));
    await user.click(screen.getByRole('button', { name: 'Choose a different member' }));

    expect(latest).toEqual({ who: '' });
    expect(screen.getByPlaceholderText('Type to find a member')).toBeInTheDocument();
  });

  it('tells the member to skip a vehicle question when none are on file', async () => {
    renderWithRouter(<Harness questions={[vehicle]} />);

    expect(await screen.findByText(/No vehicles are on file/)).toBeInTheDocument();
    expect(mockPickOptions).toHaveBeenCalledWith('apparatus');
  });
});
