import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportTable } from './ReportTable';

const columns = [
  { key: 'name', header: 'Name' },
  { key: 'value', header: 'Value', align: 'right' as const },
];

describe('ReportTable', () => {
  it('renders empty message when no rows', () => {
    render(<ReportTable rows={[]} columns={columns} />);
    expect(screen.getByText('No data found.')).toBeInTheDocument();
  });

  it('renders custom empty message', () => {
    render(<ReportTable rows={[]} columns={columns} emptyMessage="Nothing here." />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });

  it('renders table with data', () => {
    const rows = [
      { name: 'Alice', value: 10 },
      { name: 'Bob', value: 20 },
    ];
    render(<ReportTable rows={rows} columns={columns} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    const rows = [{ name: 'Alice', value: 10 }];
    render(<ReportTable rows={rows} columns={columns} />);

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
  });

  it('shows row count', () => {
    const rows = [{ name: 'Alice', value: 10 }];
    render(<ReportTable rows={rows} columns={columns} />);

    expect(screen.getByText(/1–1 of 1 rows/)).toBeInTheDocument();
  });

  it('sorts by column when clicked', async () => {
    const user = userEvent.setup();
    const rows = [
      { name: 'Charlie', value: 30 },
      { name: 'Alice', value: 10 },
      { name: 'Bob', value: 20 },
    ];
    render(<ReportTable rows={rows} columns={columns} />);

    // Click Name header to sort
    await user.click(screen.getByText('Name'));

    const cells = screen.getAllByRole('cell');
    // After asc sort, first name cell should be Alice
    expect(cells[0]?.textContent).toBe('Alice');
  });

  it('paginates rows', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      name: `Item ${i}`,
      value: i,
    }));
    render(<ReportTable rows={rows} columns={columns} pageSize={10} />);

    expect(screen.getByText(/1–10 of 30 rows/)).toBeInTheDocument();
    expect(screen.getByText('Item 0')).toBeInTheDocument();
    // Item 15 should not be on page 1
    expect(screen.queryByText('Item 15')).not.toBeInTheDocument();
  });

  it('uses custom render function', () => {
    const customColumns = [
      {
        key: 'name',
        header: 'Name',
        render: (v: unknown) => `**${String(v)}**`,
      },
    ];
    const rows = [{ name: 'Test' }];
    render(<ReportTable rows={rows} columns={customColumns} />);
    expect(screen.getByText('**Test**')).toBeInTheDocument();
  });
});
