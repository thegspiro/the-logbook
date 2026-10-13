import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

vi.mock('../services/api', () => ({
  reportsApiService: { generateReport: vi.fn() },
  savedReportsService: {},
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('../../../hooks/useRanks', () => ({ useRanks: () => ({ formatRank: (rank: string) => rank }) }));

import { useReportsStore } from '../store/reportsStore';
import { ReportsPage } from './ReportsPage';

const mockGenerateReport = vi.fn();

// Member Roster is the first card, so its button is the first of its label.
const firstButton = (name: string | RegExp): HTMLElement => {
  const button = screen.getAllByRole('button', { name })[0];
  if (!button) throw new Error(`No button named ${String(name)}`);
  return button;
};

// The button used to be `disabled` while its report generated. A disabled
// button drops focus to <body>, so the results dialog recorded <body> as its
// opener and closing it left a keyboard user at the top of the page.
describe('ReportsPage generate button', () => {
  beforeEach(() => {
    mockGenerateReport.mockReset();
    mockGenerateReport.mockResolvedValue(undefined);
    useReportsStore.setState({
      generatingReportType: null,
      activeReportData: null,
      activeReportType: null,
      generateReport: mockGenerateReport,
    });
  });

  it('stays focusable while generating and ignores a second press', async () => {
    const user = userEvent.setup();
    useReportsStore.setState({ generatingReportType: 'member_roster' });
    renderWithRouter(<ReportsPage />);

    const button = firstButton(/generating/i);

    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');

    button.focus();
    await user.click(button);
    expect(button).toHaveFocus();
    expect(mockGenerateReport).not.toHaveBeenCalled();
  });

  it('generates the report when not busy', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ReportsPage />);

    await user.click(firstButton('Generate Report'));

    expect(mockGenerateReport).toHaveBeenCalledWith(expect.objectContaining({ report_type: 'member_roster' }));
  });
});
