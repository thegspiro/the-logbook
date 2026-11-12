import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WaiverAttachmentField } from './WaiverAttachmentField';

const pdf = (name = 'note.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

// A drop, as a member dragging files onto the zone would: it applies no
// accept list, so the component has to say itself why a file is refused.
function drop(...files: File[]) {
  fireEvent.drop(screen.getByRole('button', { name: /drop a document here/i }), { dataTransfer: { files } });
}

describe('WaiverAttachmentField', () => {
  const onChange = vi.fn();
  beforeEach(() => {
    onChange.mockReset();
  });

  it('renders nothing when the policy takes no documents', () => {
    const { container } = render(<WaiverAttachmentField mode="off" onChange={onChange} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the field optional or required and states the limits', () => {
    const { rerender } = render(<WaiverAttachmentField mode="optional" onChange={onChange} />);
    expect(screen.getByText('(optional)')).toBeInTheDocument();
    expect(screen.getByText(/PDF, JPEG, PNG or HEIC, up to 10 MB each, at most 3/)).toBeInTheDocument();
    rerender(<WaiverAttachmentField mode="required" onChange={onChange} />);
    expect(screen.getByText('(required)')).toBeInTheDocument();
  });

  it('reports a valid selection', () => {
    render(<WaiverAttachmentField mode="required" onChange={onChange} />);
    const note = pdf();
    drop(note);
    expect(onChange).toHaveBeenLastCalledWith({ files: [note], valid: true });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says why a file of the wrong type would be refused', () => {
    render(<WaiverAttachmentField mode="optional" onChange={onChange} />);
    drop(new File(['GIF89a'], 'cat.gif', { type: 'image/gif' }));
    expect(screen.getByRole('alert')).toHaveTextContent('cat.gif is not a PDF, JPEG, PNG or HEIC file.');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ valid: false }));
  });

  it('counts the documents already filed against the limit of three', () => {
    render(<WaiverAttachmentField mode="optional" alreadyFiled={2} onChange={onChange} />);
    drop(pdf('a.pdf'), pdf('b.pdf'));
    expect(screen.getByRole('alert')).toHaveTextContent('at most 3 documents. Remove 1 file.');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ valid: false }));
  });

  it('shows the required message only when asked', () => {
    const { rerender } = render(<WaiverAttachmentField mode="required" onChange={onChange} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<WaiverAttachmentField mode="required" onChange={onChange} showRequiredError />);
    expect(screen.getByRole('alert')).toHaveTextContent('Attach a document to this request.');
  });
});
