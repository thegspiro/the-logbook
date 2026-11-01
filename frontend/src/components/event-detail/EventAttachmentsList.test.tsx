import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EventAttachmentsList } from './EventAttachmentsList';

const ATTACHMENT = {
  id: 'att-1',
  file_name: 'Drill plan.pdf',
  file_path: 'x',
  file_size: 2048,
  file_type: 'application/pdf',
  uploaded_by: 'u1',
  uploaded_at: '2026-10-31T00:00:00Z',
};

const url = (eventId: string, attachmentId: string) => `/dl/${eventId}/${attachmentId}`;

describe('EventAttachmentsList', () => {
  it('offers no upload or removal to a member who cannot manage events', () => {
    render(<EventAttachmentsList attachments={[ATTACHMENT]} eventId="e1" getAttachmentDownloadUrl={url} />);

    expect(screen.getByText('Drill plan.pdf')).toBeInTheDocument();
    expect(screen.queryByLabelText('Attach a file')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('attaches the chosen file', async () => {
    const onUpload = vi.fn<(file: File) => Promise<void>>().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<EventAttachmentsList attachments={[]} eventId="e1" getAttachmentDownloadUrl={url} onUpload={onUpload} />);

    const file = new File(['plan'], 'plan.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Attach a file'), file);

    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it('refuses a file over the limit before sending it', async () => {
    const onUpload = vi.fn<(file: File) => Promise<void>>();
    const user = userEvent.setup();
    render(<EventAttachmentsList attachments={[]} eventId="e1" getAttachmentDownloadUrl={url} onUpload={onUpload} />);

    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await user.upload(screen.getByLabelText('Attach a file'), big);

    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('huge.pdf is larger than 25 MB.');
  });

  it('removes an attachment', async () => {
    const onDelete = vi.fn<(a: typeof ATTACHMENT) => Promise<void>>().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <EventAttachmentsList
        attachments={[ATTACHMENT]}
        eventId="e1"
        getAttachmentDownloadUrl={url}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Remove Drill plan.pdf' }));

    expect(onDelete).toHaveBeenCalledWith(ATTACHMENT);
  });
});
