/**
 * Forms review F-11: each registry card was a button with its "Source" link
 * inside it — axe nested-interactive, and a link too small to tap
 * (target-size). The link now sits beside the button, not within it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../pages/RegistryImportModal', () => ({
  default: ({ registryName }: { registryName: string }) => <div role="dialog">Import {registryName} dialog</div>,
}));

import { RegistryImportPanel } from './RegistryImportPanel';

const registries = [
  {
    key: 'nfpa',
    name: 'NFPA',
    description: '',
    requirement_count: 12,
    source_url: 'https://www.nfpa.org/codes',
  },
];

describe('RegistryImportPanel', () => {
  it('keeps the source link out of the import button', () => {
    render(<RegistryImportPanel registries={registries} onImported={vi.fn()} />);
    const link = screen.getByRole('link', { name: /Source/ });
    const button = screen.getByRole('button', { name: /Import NFPA/ });
    expect(button).not.toContainElement(link);
  });

  it('opens the import dialog from the button, not from the link', async () => {
    const user = userEvent.setup();
    render(<RegistryImportPanel registries={registries} onImported={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Import NFPA/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Import NFPA dialog');
  });
});
