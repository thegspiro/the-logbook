/**
 * The department-wide catalog link report.
 *
 * What matters is what reaches the API: one choice per name must link every
 * position carrying it, and nothing a person did not confirm should be sent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';

const mockGetLinkReport = vi.fn();
const mockLinkAcrossTemplates = vi.fn();
const mockAutoLink = vi.fn();
const mockUnlink = vi.fn();
vi.mock('../services/equipmentCheckApi', () => ({
  equipmentCheckService: {
    getLinkReport: (...a: unknown[]) => mockGetLinkReport(...a) as unknown,
    linkAcrossTemplates: (...a: unknown[]) => mockLinkAcrossTemplates(...a) as unknown,
    autoLinkAcrossTemplates: (...a: unknown[]) => mockAutoLink(...a) as unknown,
    unlinkAcrossTemplates: (...a: unknown[]) => mockUnlink(...a) as unknown,
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
    mockAutoLink.mockReset();
    mockUnlink.mockReset();
    mockUnlink.mockResolvedValue({ unlinked: 1, skipped: 0 });
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockGetLinkReport.mockResolvedValue(report());
    mockLinkAcrossTemplates.mockResolvedValue({ linked: 2, skipped: 0, skippedPositions: [] });
    mockAutoLink.mockResolvedValue({
      linked: 3,
      skipped: 0,
      skippedPositions: [],
      leftForReview: 2,
      groups: [
        {
          name: 'Gauze Pads 4x4',
          inventoryItemId: 'inv-gauze',
          inventoryItemName: 'Gauze Pads 4x4',
          confidence: 'exact',
          positionCount: 2,
          positions: [position('ti-1', 'Medic 1'), position('ti-2', 'Medic 2', false)],
        },
        {
          name: 'Oxygen Mask',
          inventoryItemId: 'inv-mask-adult',
          inventoryItemName: 'Oxygen Mask Adult',
          confidence: 'strong',
          matchedAlias: null,
          positionCount: 1,
          positions: [position('ti-3', 'Medic 1')],
        },
      ],
    });
  });

  describe('linking automatically', () => {
    it('links after confirmation, then lists what it linked and flags the close matches', async () => {
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: /Link matches automatically/ }));
      await user.click(await screen.findByRole('button', { name: 'Link matches' }));

      await waitFor(() => expect(mockAutoLink).toHaveBeenCalled());
      const panel = await screen.findByRole('region', { name: /Linked 2 names automatically/ });
      expect(panel).toHaveTextContent('Oxygen Mask → Oxygen Mask Adult');
      expect(panel).toHaveTextContent('check this');
      expect(mockToastSuccess).toHaveBeenCalledWith('Linked 3 positions; 2 left for you to review');
      // The report is reloaded so the linked names drop off it.
      expect(mockGetLinkReport).toHaveBeenCalledTimes(2);
    });

    it('links each name to the templates it landed on', async () => {
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: /Link matches automatically/ }));
      await user.click(await screen.findByRole('button', { name: 'Link matches' }));

      const panel = await screen.findByRole('region', { name: /Linked 2 names automatically/ });
      const links = within(panel).getAllByRole('link', { name: 'Open Medic 1' });
      expect(links.map((l) => l.getAttribute('href'))).toEqual([
        '/inventory/admin/checklists/templates/t-Medic 1',
        '/inventory/admin/checklists/templates/t-Medic 1',
      ]);
      expect(within(panel).getByRole('link', { name: 'Open Medic 2' })).toBeInTheDocument();
    });

    it('undoes one name, sending each position with the item it was linked to', async () => {
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: /Link matches automatically/ }));
      await user.click(await screen.findByRole('button', { name: 'Link matches' }));
      await user.click(await screen.findByRole('button', { name: 'Undo linking Oxygen Mask' }));

      await waitFor(() => expect(mockUnlink).toHaveBeenCalledWith({ 'ti-3': 'inv-mask-adult' }));
      expect(mockToastSuccess).toHaveBeenCalledWith('Unlinked 1 position of Oxygen Mask');
      // Gone from the panel, the other name kept, and the report reloaded so
      // the undone line is back on it to choose again.
      const panel = await screen.findByRole('region', { name: /Linked 1 name automatically/ });
      expect(panel).not.toHaveTextContent('Oxygen Mask →');
      expect(panel).toHaveTextContent('Gauze Pads 4x4 → Gauze Pads 4x4');
      expect(mockGetLinkReport).toHaveBeenCalledTimes(3);
    });

    it('says when an undone position had been changed in its template since', async () => {
      mockUnlink.mockResolvedValue({ unlinked: 1, skipped: 1 });
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: /Link matches automatically/ }));
      await user.click(await screen.findByRole('button', { name: 'Link matches' }));
      await user.click(await screen.findByRole('button', { name: 'Undo linking Gauze Pads 4x4' }));

      await waitFor(() =>
        expect(mockToastSuccess).toHaveBeenCalledWith(
          'Unlinked 1 position of Gauze Pads 4x4; 1 had been changed in the template since and was left as it was'
        )
      );
    });

    it('keeps the name listed when an undo fails', async () => {
      mockUnlink.mockRejectedValue(new Error('Server unavailable'));
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: /Link matches automatically/ }));
      await user.click(await screen.findByRole('button', { name: 'Link matches' }));
      await user.click(await screen.findByRole('button', { name: 'Undo linking Oxygen Mask' }));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Server unavailable'));
      expect(screen.getByRole('button', { name: 'Undo linking Oxygen Mask' })).toBeEnabled();
    });

    it('sends nothing when the confirmation is declined', async () => {
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: /Link matches automatically/ }));
      await user.click(await screen.findByRole('button', { name: /cancel|keep/i }));

      expect(mockAutoLink).not.toHaveBeenCalled();
    });

    it('says so when nothing was clear enough to link', async () => {
      mockAutoLink.mockResolvedValue({ linked: 0, skipped: 0, skippedPositions: [], leftForReview: 5, groups: [] });
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: /Link matches automatically/ }));
      await user.click(await screen.findByRole('button', { name: 'Link matches' }));

      await waitFor(() =>
        expect(mockToastSuccess).toHaveBeenCalledWith('No lines had a clear enough match to link automatically')
      );
    });

    it('reports a failure', async () => {
      mockAutoLink.mockRejectedValue(new Error('Server unavailable'));
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: /Link matches automatically/ }));
      await user.click(await screen.findByRole('button', { name: 'Link matches' }));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Server unavailable'));
    });

    it('is not offered when no name has a catalog match', async () => {
      const onlyUnmatched = report();
      onlyUnmatched.groups = onlyUnmatched.groups.filter((g) => g.suggestions.length === 0);
      mockGetLinkReport.mockResolvedValue(onlyUnmatched);
      renderWithRouter(<CatalogLinkReportPage />);

      await screen.findByText(/No catalog match/);
      expect(screen.queryByRole('button', { name: /Link matches automatically/ })).not.toBeInTheDocument();
    });
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

  describe('positions linked by someone else meanwhile', () => {
    const skippedPosition = {
      templateItemId: 'ti-2',
      itemName: 'Gauze Pads 4x4',
      templateId: 't-Medic 2',
      templateName: 'Medic 2',
      compartmentName: 'Jump Bag',
      currentInventoryItemId: 'inv-gauze-sterile',
      currentInventoryItemName: 'Gauze Pads 4x4 Sterile',
      chosenInventoryItemId: 'inv-gauze',
      chosenInventoryItemName: 'Gauze Pads 4x4',
    };

    beforeEach(() => {
      mockLinkAcrossTemplates.mockReset();
      mockLinkAcrossTemplates.mockResolvedValue({ linked: 1, skipped: 1, skippedPositions: [skippedPosition] });
    });

    it('lists each one with both items and a way into its template', async () => {
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: 'Link 2 positions' }));

      const panel = await screen.findByRole('region', { name: '1 position was left as it was' });
      expect(panel).toHaveTextContent('Gauze Pads 4x4 · Medic 2 · Jump Bag');
      expect(panel).toHaveTextContent('Linked to Gauze Pads 4x4 Sterile; you chose Gauze Pads 4x4.');
      expect(screen.getByRole('link', { name: 'Open Medic 2' })).toHaveAttribute(
        'href',
        '/inventory/admin/checklists/templates/t-Medic 2'
      );
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Linked 1 position; 1 had been linked by someone else — see the list above'
      );
    });

    it('stays after the report reloads, until dismissed', async () => {
      const user = userEvent.setup();
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: 'Link 2 positions' }));
      await screen.findByRole('region', { name: '1 position was left as it was' });
      await waitFor(() => {
        expect(mockGetLinkReport).toHaveBeenCalledTimes(2);
      });
      expect(screen.getByRole('region', { name: '1 position was left as it was' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Dismiss skipped positions' }));

      expect(screen.queryByRole('region', { name: /left as/ })).not.toBeInTheDocument();
    });

    it('says so when the current link is to an item outside the inventory', async () => {
      const user = userEvent.setup();
      mockLinkAcrossTemplates.mockResolvedValue({
        linked: 1,
        skipped: 1,
        skippedPositions: [{ ...skippedPosition, currentInventoryItemName: null }],
      });
      renderWithRouter(<CatalogLinkReportPage />);

      await user.click(await screen.findByRole('button', { name: 'Link 2 positions' }));

      expect(await screen.findByRole('region', { name: '1 position was left as it was' })).toHaveTextContent(
        'Linked to an item outside your inventory; you chose Gauze Pads 4x4.'
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
