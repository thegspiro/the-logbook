import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EventOrganizerPickers } from './EventOrganizerPickers';

const options = [
  { id: 'me', name: 'Alex Tester' },
  { id: 'dana', name: 'Dana Okafor' },
  { id: 'owen', name: 'Owen Kittredge' },
];

const optionNames = (label: string) =>
  within(screen.getByLabelText(label))
    .getAllByRole('option')
    .map((option) => option.textContent);

const renderPickers = (props: Partial<React.ComponentProps<typeof EventOrganizerPickers>> = {}) =>
  render(
    <EventOrganizerPickers
      idPrefix="test"
      options={options}
      organizerId=""
      alternateId=""
      onOrganizerChange={vi.fn()}
      onAlternateChange={vi.fn()}
      {...props}
    />
  );

describe('EventOrganizerPickers', () => {
  it('does not list the default organizer by name beside the placeholder that stands for them', () => {
    renderPickers({ organizerPlaceholder: 'Me (default)', defaultOrganizerId: 'me' });

    expect(optionNames('Organizer')).toEqual(['Me (default)', 'Dana Okafor', 'Owen Kittredge']);
    expect(optionNames('Alternate (optional)')).toEqual(['No alternate', 'Dana Okafor', 'Owen Kittredge']);
  });

  it('keeps the default organizer listed while they are the explicit choice', () => {
    renderPickers({ organizerPlaceholder: 'Me (default)', defaultOrganizerId: 'me', organizerId: 'me' });

    expect(screen.getByLabelText('Organizer')).toHaveValue('me');
  });

  it('lists every member when the organizer is a required pick', () => {
    renderPickers();

    expect(optionNames('Organizer *')).toEqual(['Choose a member', 'Alex Tester', 'Dana Okafor', 'Owen Kittredge']);
  });
});
