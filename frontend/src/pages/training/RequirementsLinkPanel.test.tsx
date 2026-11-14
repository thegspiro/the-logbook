import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import RequirementsLinkPanel from './RequirementsLinkPanel';

describe('RequirementsLinkPanel', () => {
  it('opens Curriculum → Requirements in the hub', () => {
    renderWithRouter(<RequirementsLinkPanel />);

    expect(screen.getByRole('heading', { name: 'Requirements' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open requirements' })).toHaveAttribute(
      'href',
      '/training/admin?page=curriculum&tab=requirements'
    );
  });

  it('says what is managed there', () => {
    renderWithRouter(<RequirementsLinkPanel />);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/managed under Curriculum/)).toBeInTheDocument();
  });
});
