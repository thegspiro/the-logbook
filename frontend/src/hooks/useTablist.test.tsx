import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTablist } from './useTablist';

const Tabs: React.FC<{ disabledSecond?: boolean }> = ({ disabledSecond = false }) => {
  const [active, setActive] = useState('one');
  const tablist = useTablist();
  return (
    <>
      <div role="tablist" aria-label="Views" {...tablist}>
        {['one', 'two', 'three'].map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active === id}
            disabled={disabledSecond && id === 'two'}
            onClick={() => setActive(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <button type="button">After</button>
    </>
  );
};

describe('useTablist', () => {
  it('keeps only the selected tab in the Tab order', async () => {
    const user = userEvent.setup();
    render(<Tabs />);

    await user.tab();
    expect(screen.getByRole('tab', { name: 'one' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('moves and activates with the arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    render(<Tabs />);

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'two' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'two' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'three' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'one' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'three' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'one' })).toHaveFocus();
  });

  it('skips a disabled tab', async () => {
    const user = userEvent.setup();
    render(<Tabs disabledSecond />);

    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'three' })).toHaveFocus();
  });
});
