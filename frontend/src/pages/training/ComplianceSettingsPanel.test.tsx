import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import ComplianceSettingsPanel from './ComplianceSettingsPanel';

describe('ComplianceSettingsPanel', () => {
  it('opens the compliance configuration page', () => {
    renderWithRouter(<ComplianceSettingsPanel />);

    expect(screen.getByRole('heading', { name: 'Compliance settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open compliance settings' })).toHaveAttribute(
      'href',
      '/training/compliance-config'
    );
  });

  it('says what is configured there, and where requirements are set instead', () => {
    renderWithRouter(<ComplianceSettingsPanel />);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/Curriculum → Requirements/)).toBeInTheDocument();
  });
});
