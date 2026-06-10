import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockPreview = vi.fn();
const mockGetPreset = vi.fn();
const mockSetPreset = vi.fn();
const mockGenerate = vi.fn();

vi.mock('../../services/labelService', () => ({
  labelService: {
    preview: (...a: unknown[]) => mockPreview(...a) as unknown,
    getPreset: (...a: unknown[]) => mockGetPreset(...a) as unknown,
    setPreset: (...a: unknown[]) => mockSetPreset(...a) as unknown,
    generate: (...a: unknown[]) => mockGenerate(...a) as unknown,
  },
}));

vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('jsbarcode', () => ({ default: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { LabelPrintPage } from './LabelPrintPage';

const renderPage = (query: string) =>
  render(
    <MemoryRouter initialEntries={[`/apparatus/print-labels${query}`]}>
      <LabelPrintPage module="apparatus" title="Print Apparatus Labels" backTo="/apparatus" />
    </MemoryRouter>,
  );

describe('LabelPrintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockPreview.mockResolvedValue({
      items: [{ name: 'Engine 5', barcode_value: 'E5', subtitle: 'Unit 5' }],
    });
    mockGetPreset.mockResolvedValue({ preset: null });
    mockSetPreset.mockResolvedValue({ preset: null });
    mockGenerate.mockResolvedValue({ blob: new Blob(['pdf']), autoPopulated: 0 });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:test');
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('errors when no ids are provided', async () => {
    renderPage('');
    expect(await screen.findByText(/No records specified/)).toBeInTheDocument();
  });

  it('loads the preview for the module and renders the records', async () => {
    renderPage('?ids=a1,a2');
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('apparatus', ['a1', 'a2']));
    expect((await screen.findAllByText('Engine 5')).length).toBeGreaterThan(0);
  });

  it('generates a PDF for the module', async () => {
    const user = userEvent.setup();
    renderPage('?ids=a1');
    await screen.findAllByText('Engine 5');

    await user.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
    expect(mockGenerate.mock.calls[0]?.[0]).toBe('apparatus');
    expect(mockGenerate.mock.calls[0]?.[1]).toEqual(['a1']);
  });

  it('applies and saves the module preset', async () => {
    // Position remembers Rollo for apparatus.
    mockGetPreset.mockResolvedValue({ preset: 'rollo_4x6' });
    const user = userEvent.setup();
    renderPage('?ids=a1');
    await screen.findAllByText('Engine 5');
    await waitFor(() => expect(mockGetPreset).toHaveBeenCalledWith('apparatus'));

    // Generating uses the remembered Rollo preset.
    await user.click(screen.getByRole('button', { name: 'PDF' }));
    await waitFor(() =>
      expect(mockGenerate.mock.calls[0]?.[2]).toMatchObject({
        label_format: 'rollo_4x6',
      }),
    );
  });
});
