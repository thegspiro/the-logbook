import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockExportReport = vi.fn();
const mockSaveFile = vi.fn();
const mockToastError = vi.fn();
vi.mock('../services/api', () => ({
  reportsApiService: { exportReport: (...args: unknown[]) => mockExportReport(...args) as unknown },
}));
vi.mock('@/utils/fileDownload', () => ({
  saveFile: (...args: unknown[]) => mockSaveFile(...args) as unknown,
}));
vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

import { ExportControls } from './ExportControls';

const SOURCE = { report_type: 'event_attendance', start_date: '2026-01-01', end_date: '2026-06-30' };

describe('ExportControls', () => {
  beforeEach(() => {
    mockExportReport.mockReset();
    mockExportReport.mockResolvedValue({ blob: new Blob(['x']), filename: 'event_attendance_2026-11-15.csv' });
    mockSaveFile.mockReset();
    mockToastError.mockReset();
  });

  it('asks the server for the format clicked and saves what it sends', async () => {
    const user = userEvent.setup();
    render(<ExportControls reportTitle="Event Attendance" source={SOURCE} />);

    await user.click(screen.getByRole('button', { name: 'CSV' }));

    expect(mockExportReport).toHaveBeenCalledWith(SOURCE, 'csv', 'event_attendance.csv');
    const saved = mockSaveFile.mock.calls[0]?.[0] as { blob: unknown; filename: string } | undefined;
    expect(saved?.blob).toBeInstanceOf(Blob);
    expect(saved?.filename).toBe('event_attendance_2026-11-15.csv');
  });

  it('asks for signature lines on the PDF only when the box is ticked', async () => {
    const user = userEvent.setup();
    render(<ExportControls reportTitle="Event Attendance" source={SOURCE} />);

    await user.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mockExportReport).toHaveBeenLastCalledWith(SOURCE, 'pdf', 'event_attendance.pdf');

    await user.click(screen.getByRole('checkbox', { name: 'Add signature lines to PDF' }));
    await user.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mockExportReport).toHaveBeenLastCalledWith(
      { ...SOURCE, signature_lines: true },
      'pdf',
      'event_attendance.pdf'
    );

    // A CSV has no page to sign.
    await user.click(screen.getByRole('button', { name: 'CSV' }));
    expect(mockExportReport).toHaveBeenLastCalledWith(SOURCE, 'csv', 'event_attendance.csv');
  });

  it('says why when the server refuses, and saves nothing', async () => {
    const user = userEvent.setup();
    mockExportReport.mockRejectedValue(new Error('This report requires the members.view permission'));
    render(<ExportControls reportTitle="Member Roster" source={SOURCE} />);

    await user.click(screen.getByRole('button', { name: 'PDF' }));

    expect(mockToastError).toHaveBeenCalledWith('This report requires the members.view permission');
    expect(mockSaveFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeEnabled();
  });

  it('holds both buttons while one download is in flight', async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    mockExportReport.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(<ExportControls reportTitle="Event Attendance" source={SOURCE} />);

    await user.click(screen.getByRole('button', { name: 'PDF' }));

    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'PDF' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    finish({ blob: new Blob(['x']), filename: 'x.pdf' });
    expect(await screen.findByRole('button', { name: 'CSV' })).toBeEnabled();
  });

  it('offers nothing when there is nothing to export or nothing to re-run', () => {
    const { rerender } = render(<ExportControls reportTitle="Event Attendance" source={SOURCE} disabled />);
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();

    rerender(<ExportControls reportTitle="Event Attendance" source={null} />);
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled();
  });
});
