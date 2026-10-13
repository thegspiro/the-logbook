/**
 * The department-wide catalog link report.
 *
 * What matters is what reaches the API: one choice per name must link every
 * position carrying it, and nothing a person did not confirm should be sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';

const mockGetLinkReport = vi.fn();
const mockLinkAcrossTemplates = vi.fn();
vi.mock('../services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLinkReport: (...a: unknown[]) => mockGetLinkReport(...a) as unknown,
    linkAcrossTemplates: (...a: unknown[]) => mockLinkAcrossTemplates(...a) as unknown,
  },
}));

vi.mock('../hooks/useChecklistCatalogAccess', () => ({
  useChecklistCatalogAccess: () => ({
    searchScope: { gear: true, medical: true },
    canCreateGear: true,
    canCreateMedical: true,
  }),
}));

// The picker has its own suite; here it only needs to hand back an id.
vi.mock('../components/InventoryItemPicker', () => ({
  default: ({ onChange }: { onChange: (id: string | undefined) => void }) => (
    <button type="button" onClick={() => onChange('inv-searched')}>
      pick from catalog
    </button>
  ),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import CatalogLinkReportPage from './CatalogLinkReportPage';

const position = (id: string, templateName: string, templateActive = true) => ({
  templateItemId: id,
  templateId: `t-${templateName}`,
  templateName,
  templateActive,
  compartmentName: 'Jump Bag',
  checkType: 'count',
});

const report = () => ({
  coverage: { linkable: 10, linked: 5, unlinked: 5 },
  templateCount: 2,
  groups: [
    {
      key: 'gauze pads 4x4',
      name: 'Gauze Pads 4x4',
      positionCount: 2,
      templateCount: 2,
      positions: [position('ti-1', 'Medic 1'), position('ti-2', 'Medic 2', false)],
      suggestions: [{ id: 'inv-gauze', name: 'Gauze Pads 4x4', score: 1, confidence: 'exact' }],
    },
    {
      key: 'oxygen mask',
      name: 'Oxygen Mask',
      positionCount: 1,
      templateCount: 1,
      positions: [position('ti-3', 'Medic 1')],
      suggestions: [{ id: 'inv-mask-adult', name: 'Oxygen Mask Adult', score: 0.75, confidence: 'strong' }],
    },
    {
      key: 'check tire pressure',
      name: 'Check tire pressure',
      positionCount: 2,
      templateCount: 2,
      positions: [position('ti-4', 'Medic 1'), position('ti-5', 'Medic 2')],
      suggestions: [],
    },
  ],
});

describe('CatalogLinkReportPage', () => {
  beforeEach(() => {
    mockGetLinkReport.mockReset();
    mockLinkAcrossTemplates.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockGetLinkReport.mockResolvedValue(report());
    mockLinkAcrossTemplates.mockResolvedValue({ linked: 2, skipped: 0 });
  });

  it('pre-selects exact matches only', async () => {
    renderWithRouter(<CatalogLinkReportPage />);

    expect(await screen.findByLabelText('Catalog item for Gauze Pads 4x4')).toHaveValue('inv-gauze');
    expect(screen.getByLabelText('Catalog item for Oxygen Mask')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Link 2 positions' })).toBeEnabled();
  });

  it('links every position carrying the chosen name, across templates', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CatalogLinkReportPage />);

    await user.click(await screen.findByRole('button', { name: 'Link 2 positions' }));

    await waitFor(() => {
      expect(mockLinkAcrossTemplates).toHaveBeenCalledWith({ 'ti-1': 'inv-gauze', 'ti-2': 'inv-gauze' });
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('Linked 2 positions');
    // Reloaded, so linked names drop off the list.
    expect(mockGetLinkReport).toHaveBeenCalledTimes(2);
  });

  it('sends a likely match only once a person chooses it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CatalogLinkReportPage />);

    await user.selectOptions(await screen.findByLabelText('Catalog item for Oxygen Mask'), 'inv-mask-adult');
    await user.click(screen.getByRole('button', { name: 'Link 3 positions' }));

    await waitFor(() => {
      expect(mockLinkAcrossTemplates).toHaveBeenCalledWith({
        'ti-1': 'inv-gauze',
        'ti-2': 'inv-gauze',
        'ti-3': 'inv-mask-adult',
      });
    });
  });

  it('leaves a name out when set to "Don’t link"', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CatalogLinkReportPage />);

    await user.selectOptions(await screen.findByLabelText('Catalog item for Gauze Pads 4x4'), '');

    expect(screen.getByRole('button', { name: 'Link 0 positions' })).toBeDisabled();
  });

  it('keeps names with no catalog match collapsed until asked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CatalogLinkReportPage />);

    const toggle = await screen.findByRole('button', { name: /No catalog match \(1\)/ });
    expect(screen.queryByLabelText('Catalog item for Check tire pressure')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByLabelText('Catalog item for Check tire pressure')).toBeInTheDocument();
  });

  it('links an unmatched name to an item found through the search', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CatalogLinkReportPage />);

    await user.click(await screen.findByRole('button', { name: /No catalog match/ }));
    await user.selectOptions(screen.getByLabelText('Catalog item for Check tire pressure'), '__search__');
    await user.click(screen.getByRole('button', { name: 'pick from catalog' }));
    await user.click(screen.getByRole('button', { name: 'Link 4 positions' }));

    await waitFor(() => {
      expect(mockLinkAcrossTemplates).toHaveBeenCalledWith({
        'ti-1': 'inv-gauze',
        'ti-2': 'inv-gauze',
        'ti-4': 'inv-searched',
        'ti-5': 'inv-searched',
      });
    });
  });

  it('shows where a name appears, marking drafts', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CatalogLinkReportPage />);

    await user.click(await screen.findByRole('button', { name: '2 positions on 2 templates' }));

    // Medic 2 is the only draft in the fixture, so it carries the only badge.
    expect(screen.getByText('Medic 2')).toBeInTheDocument();
    expect(screen.getAllByText('Draft')).toHaveLength(1);
  });

  it('says when positions had been linked by someone else meanwhile', async () => {
    const user = userEvent.setup();
    mockLinkAcrossTemplates.mockResolvedValue({ linked: 1, skipped: 1 });
    renderWithRouter(<CatalogLinkReportPage />);

    await user.click(await screen.findByRole('button', { name: 'Link 2 positions' }));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Linked 1 position; 1 had been linked by someone else and were left as they were'
      );
    });
  });

  it('reports a failed link and reloads', async () => {
    const user = userEvent.setup();
    mockLinkAcrossTemplates.mockRejectedValue(new Error('1 inventory item(s) are not in your inventory'));
    renderWithRouter(<CatalogLinkReportPage />);

    await user.click(await screen.findByRole('button', { name: 'Link 2 positions' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(mockGetLinkReport).toHaveBeenCalledTimes(2);
  });

  it('says so when everything is linked', async () => {
    mockGetLinkReport.mockResolvedValue({
      coverage: { linkable: 4, linked: 4, unlinked: 0 },
      templateCount: 0,
      groups: [],
    });
    renderWithRouter(<CatalogLinkReportPage />);

    expect(await screen.findByText('Every checklist line is linked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link \d+ position/ })).not.toBeInTheDocument();
  });

  it('shows a load failure', async () => {
    mockGetLinkReport.mockRejectedValue(new Error('offline'));
    renderWithRouter(<CatalogLinkReportPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
