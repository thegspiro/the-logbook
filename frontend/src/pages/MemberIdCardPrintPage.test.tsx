/**
 * The ID card print page: it starts from the department's saved layout, sends
 * the layout on screen with the selected members, and only writes the
 * department default when the officer asks it to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockPreview = vi.fn();
vi.mock('../services/labelService', () => ({
  Symbology: { CODE128: 'code128', QR: 'qr' },
  labelService: {
    preview: (...args: unknown[]) => mockPreview(...args) as unknown,
  },
}));

const mockGetLayout = vi.fn();
const mockSaveLayout = vi.fn();
const mockGeneratePdf = vi.fn();
vi.mock('../services/memberIdCardService', () => ({
  memberIdCardService: {
    getLayout: (...args: unknown[]) => mockGetLayout(...args) as unknown,
    saveLayout: (...args: unknown[]) => mockSaveLayout(...args) as unknown,
    generatePdf: (...args: unknown[]) => mockGeneratePdf(...args) as unknown,
  },
}));

const mockGetBadgeSettings = vi.fn();
const mockSaveBadgeSettings = vi.fn();
vi.mock('../services/memberBadgeService', () => ({
  memberBadgeService: {
    getSettings: (...args: unknown[]) => mockGetBadgeSettings(...args) as unknown,
    saveSettings: (...args: unknown[]) => mockSaveBadgeSettings(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MemberIdCardPrintPage from './MemberIdCardPrintPage';

const SAVED = { orientation: 'portrait', sides: 'both', symbology: 'qr' };

function renderAt(search: string) {
  window.history.pushState({}, '', `/members/print-id-cards${search}`);
  return renderWithRouter(<MemberIdCardPrintPage />);
}

describe('MemberIdCardPrintPage', () => {
  beforeEach(() => {
    mockPreview.mockReset();
    mockPreview.mockResolvedValue({
      items: [
        { name: 'Laura Adams', barcode_value: 'M-1', subtitle: null },
        { name: 'Ben Anderson', barcode_value: 'M-2', subtitle: null },
      ],
    });
    mockGetLayout.mockReset();
    mockGetLayout.mockResolvedValue(SAVED);
    mockSaveLayout.mockReset();
    mockSaveLayout.mockImplementation((layout: unknown) => Promise.resolve(layout));
    mockGeneratePdf.mockReset();
    mockGeneratePdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    mockGetBadgeSettings.mockReset();
    mockGetBadgeSettings.mockResolvedValue({ accept_legacy: true });
    mockSaveBadgeSettings.mockReset();
    mockSaveBadgeSettings.mockImplementation((v: unknown) => Promise.resolve(v));
    URL.createObjectURL = vi.fn(() => 'blob:cards');
    URL.revokeObjectURL = vi.fn();
  });

  it('lists the selected members and starts from the department layout', async () => {
    renderAt('?ids=u1,u2');

    expect(await screen.findByText('Laura Adams')).toBeInTheDocument();
    expect(screen.getByText('Ben Anderson')).toBeInTheDocument();
    expect(mockPreview).toHaveBeenCalledWith('membership', ['u1', 'u2']);
    expect(screen.getByRole('radio', { name: /Portrait/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Front and back/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /QR code/ })).toBeChecked();
    expect(screen.getByText('Department layout')).toBeInTheDocument();
  });

  it('prints every selected member with the layout on screen', async () => {
    const user = userEvent.setup();
    renderAt('?ids=u1,u2');
    await screen.findByText('Laura Adams');

    await user.click(screen.getByRole('radio', { name: /Landscape/ }));
    await user.click(screen.getByRole('button', { name: /Download 2 cards/ }));

    expect(mockGeneratePdf).toHaveBeenCalledWith(['u1', 'u2'], {
      orientation: 'landscape',
      sides: 'both',
      symbology: 'qr',
    });
    // Choosing an option for one print does not change the department's.
    expect(mockSaveLayout).not.toHaveBeenCalled();
  });

  it('prints a single test card for the first member', async () => {
    const user = userEvent.setup();
    renderAt('?ids=u1,u2');
    await screen.findByText('Laura Adams');

    await user.click(screen.getByRole('button', { name: /Test card/ }));

    expect(mockGeneratePdf).toHaveBeenCalledWith(['u1'], SAVED);
  });

  it('saves a changed layout as the department layout only when asked', async () => {
    const user = userEvent.setup();
    renderAt('?ids=u1');
    await screen.findByText('Laura Adams');

    expect(screen.queryByRole('button', { name: /Save as department layout/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Front only/ }));
    await user.click(screen.getByRole('button', { name: /Save as department layout/ }));

    expect(mockSaveLayout).toHaveBeenCalledWith({ orientation: 'portrait', sides: 'front', symbology: 'qr' });
    expect(await screen.findByText('Department layout')).toBeInTheDocument();
  });

  it('explains duplex printing only when the back is printed', async () => {
    const user = userEvent.setup();
    renderAt('?ids=u1');
    await screen.findByText('Laura Adams');

    expect(screen.getByText(/two-sided printing/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Front only/ }));
    expect(screen.queryByText(/two-sided printing/)).not.toBeInTheDocument();
  });

  it('says how many selected records were not found', async () => {
    renderAt('?ids=u1,u2,u3');

    expect(await screen.findByText(/1 selected record was not found/)).toBeInTheDocument();
  });

  it('asks for a selection instead of fetching when none was made', async () => {
    renderAt('');

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing selected to print');
    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockGetLayout).not.toHaveBeenCalled();
  });
  describe('Accept old badges', () => {
    it('starts on, and asks before old badges stop scanning', async () => {
      const user = userEvent.setup();
      renderAt('?ids=u1');

      const toggle = await screen.findByRole('switch', { name: 'Accept old badges' });
      expect(toggle).toHaveAttribute('aria-checked', 'true');

      await user.click(toggle);
      await user.click(await screen.findByRole('button', { name: 'Stop accepting them' }));

      expect(mockSaveBadgeSettings).toHaveBeenCalledWith({ accept_legacy: false });
      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    });

    it('changes nothing when the officer keeps accepting them', async () => {
      const user = userEvent.setup();
      renderAt('?ids=u1');

      await user.click(await screen.findByRole('switch', { name: 'Accept old badges' }));
      await user.click(await screen.findByRole('button', { name: 'Keep accepting' }));

      expect(mockSaveBadgeSettings).not.toHaveBeenCalled();
    });

    it('turns them back on without a prompt', async () => {
      mockGetBadgeSettings.mockResolvedValue({ accept_legacy: false });
      const user = userEvent.setup();
      renderAt('?ids=u1');

      await user.click(await screen.findByRole('switch', { name: 'Accept old badges' }));

      expect(mockSaveBadgeSettings).toHaveBeenCalledWith({ accept_legacy: true });
    });
  });
});
