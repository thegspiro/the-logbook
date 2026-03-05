import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileItemCard } from './MobileItemCard';

describe('MobileItemCard', () => {
  const baseProps = {
    name: 'SCBA Mask',
    status: 'available',
    statusStyle: 'bg-green-500/10 text-green-700',
  };

  it('renders item name and status', () => {
    render(<MobileItemCard {...baseProps} />);
    expect(screen.getByText('SCBA Mask')).toBeInTheDocument();
    expect(screen.getByText('AVAILABLE')).toBeInTheDocument();
  });

  it('renders optional metadata tags', () => {
    render(
      <MobileItemCard
        {...baseProps}
        category="PPE"
        size="Large"
        color="Black"
        condition="good"
        conditionColor="text-emerald-700"
        serialNumber="SN-12345"
        assetTag="TAG-001"
        quantity={5}
      />
    );
    expect(screen.getByText('PPE')).toBeInTheDocument();
    expect(screen.getByText('Large')).toBeInTheDocument();
    expect(screen.getByText('Black')).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
    expect(screen.getByText('SN: SN-12345')).toBeInTheDocument();
    expect(screen.getByText('Tag: TAG-001')).toBeInTheDocument();
    expect(screen.getByText('Qty: 5')).toBeInTheDocument();
  });

  it('does not show quantity badge when quantity is 1', () => {
    render(<MobileItemCard {...baseProps} quantity={1} />);
    expect(screen.queryByText(/Qty:/)).not.toBeInTheDocument();
  });

  it('renders manufacturer info', () => {
    render(<MobileItemCard {...baseProps} manufacturer="Scott Safety AV-3000" />);
    expect(screen.getByText('Scott Safety AV-3000')).toBeInTheDocument();
  });

  it('calls onTap when card is clicked', async () => {
    const user = userEvent.setup();
    const onTap = vi.fn();
    render(<MobileItemCard {...baseProps} onTap={onTap} />);
    await user.click(screen.getByRole('button'));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('renders checkbox and calls onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MobileItemCard {...baseProps} selected={false} onSelect={onSelect} />);
    const checkbox = screen.getByRole('checkbox', { name: /select scba mask/i });
    expect(checkbox).toBeInTheDocument();
    await user.click(checkbox);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not render checkbox when onSelect is not provided', () => {
    render(<MobileItemCard {...baseProps} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('renders action buttons when showActions is true', () => {
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    render(
      <MobileItemCard
        {...baseProps}
        showActions
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        canRetire={false}
        canIssue={false}
      />
    );
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('shows issue button only when canIssue is true', () => {
    render(
      <MobileItemCard
        {...baseProps}
        showActions
        onIssue={vi.fn()}
        canIssue
        canRetire={false}
      />
    );
    expect(screen.getByText('Issue')).toBeInTheDocument();
  });

  it('hides actions when showActions is false', () => {
    render(<MobileItemCard {...baseProps} showActions={false} onEdit={vi.fn()} />);
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('renders location info', () => {
    render(<MobileItemCard {...baseProps} location="Station 1 — Bay 2" />);
    expect(screen.getByText('Station 1 — Bay 2')).toBeInTheDocument();
  });
});
