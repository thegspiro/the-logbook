import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { SuggestionBoxPublic } from '../types/suggestions';

const mockListBoxes = vi.fn();
const mockSubmit = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    listBoxes: (...args: unknown[]) => mockListBoxes(...args) as unknown,
    submit: (...args: unknown[]) => mockSubmit(...args) as unknown,
  },
}));

import SuggestionSubmitForm from './SuggestionSubmitForm';

const box = (overrides: Partial<SuggestionBoxPublic> = {}): SuggestionBoxPublic => ({
  id: 'b1',
  name: 'Training ideas',
  description: 'Ideas for drills',
  anonymityMode: 'allowed',
  followUpEnabled: true,
  ...overrides,
});

async function fillAndSubmit(buttonName: RegExp) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Title'), 'Night drills');
  await user.type(screen.getByLabelText('Details'), 'More of them');
  await user.click(screen.getByRole('button', { name: buttonName }));
  return user;
}

describe('SuggestionSubmitForm', () => {
  beforeEach(() => {
    mockListBoxes.mockReset();
    mockSubmit.mockReset();
  });

  it('shows the follow-up key once after an anonymous submission', async () => {
    mockListBoxes.mockResolvedValue([box()]);
    mockSubmit.mockResolvedValue({ id: null, isAnonymous: true, followUpKey: 'secret-key-value-1234567890' });
    renderWithRouter(<SuggestionSubmitForm />);

    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(/Submit anonymously/));
    await fillAndSubmit(/Submit anonymously/);

    expect(mockSubmit).toHaveBeenCalledWith('b1', {
      title: 'Night drills',
      details: 'More of them',
      anonymous: true,
      screenshots: [],
    });
    expect(await screen.findByText('secret-key-value-1234567890')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I saved it' }));
    expect(screen.queryByText('secret-key-value-1234567890')).not.toBeInTheDocument();
  });

  it('submits anonymously without offering a choice when the box requires it', async () => {
    mockListBoxes.mockResolvedValue([box({ anonymityMode: 'required', followUpEnabled: false })]);
    mockSubmit.mockResolvedValue({ id: null, isAnonymous: true, followUpKey: null });
    renderWithRouter(<SuggestionSubmitForm />);

    expect(await screen.findByText(/always anonymous/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Submit anonymously/ })).not.toBeInTheDocument();
    await fillAndSubmit(/Submit anonymously/);

    expect(mockSubmit).toHaveBeenCalledWith('b1', expect.objectContaining({ anonymous: true }));
  });

  it('submits named when the box refuses anonymity', async () => {
    mockListBoxes.mockResolvedValue([box({ anonymityMode: 'disabled' })]);
    mockSubmit.mockResolvedValue({ id: 's1', isAnonymous: false, followUpKey: null });
    renderWithRouter(<SuggestionSubmitForm />);

    expect(await screen.findByText(/include your name/i)).toBeInTheDocument();
    await fillAndSubmit(/^Submit$/);

    expect(mockSubmit).toHaveBeenCalledWith('b1', expect.objectContaining({ anonymous: false }));
  });

  it('says so when the department has no boxes', async () => {
    mockListBoxes.mockResolvedValue([]);
    renderWithRouter(<SuggestionSubmitForm />);

    expect(await screen.findByText('No suggestion boxes yet')).toBeInTheDocument();
  });
});
