import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('builds initials and the label from the first and last name', () => {
    render(<Avatar firstName="John" lastName="Heather" />);

    expect(screen.getByRole('img', { name: 'John Heather' })).toHaveTextContent('JH');
  });

  it('uses the preferred name in place of the first name', () => {
    render(<Avatar firstName="John" preferredName="Terry" lastName="Heather" />);

    expect(screen.getByRole('img', { name: 'Terry Heather' })).toHaveTextContent('TH');
  });

  it('falls back to the first name when the preferred name is blank', () => {
    render(<Avatar firstName="John" preferredName="  " lastName="Heather" />);

    expect(screen.getByRole('img', { name: 'John Heather' })).toHaveTextContent('JH');
  });

  it('labels a photo with the preferred name', () => {
    render(<Avatar firstName="John" preferredName="Terry" lastName="Heather" photoUrl="/p.jpg" />);

    expect(screen.getByRole('img', { name: 'Terry Heather' })).toHaveAttribute('src', '/p.jpg');
  });
});
