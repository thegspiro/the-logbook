/**
 * Edit an approval chain's name, description and active flag.
 *
 * Deliberately limited to the three fields that change what a chain is called
 * and whether it is used; routing (applies-to, amounts, category, default) is
 * set when the chain is created.
 */

import React, { useState } from 'react';
import { Modal } from '../../../components/Modal';
import { blankToNull } from '../../../utils/formValues';
import type { ApprovalChain, ApprovalChainUpdatePayload } from '../types';

interface ApprovalChainEditDialogProps {
  chain: ApprovalChain;
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: ApprovalChainUpdatePayload) => Promise<void>;
}

export const ApprovalChainEditDialog: React.FC<ApprovalChainEditDialogProps> = ({
  chain,
  saving,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState(chain.name);
  const [description, setDescription] = useState(chain.description || '');
  const [isActive, setIsActive] = useState(chain.isActive);
  const [nameError, setNameError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Enter a name for this chain.');
      return;
    }
    setNameError('');
    void onSubmit({ name: trimmed, description: blankToNull(description), is_active: isActive });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Edit chain"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Save chain
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="chain-name" className="form-label">
            Name
          </label>
          <input
            id="chain-name"
            className="form-input"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? 'chain-name-error' : undefined}
          />
          {nameError && (
            <p id="chain-name-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {nameError}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="chain-description" className="form-label">
            Description
          </label>
          <textarea
            id="chain-description"
            className="form-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <label className="text-theme-text-primary flex items-start gap-2 text-sm max-md:min-h-[44px]">
          <input
            type="checkbox"
            className="form-checkbox mt-0.5"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>
            Active
            <span className="text-theme-text-secondary block text-xs">
              Only active chains are used for newly submitted requests. Turning a chain off does not change requests
              already going through it.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
};

export default ApprovalChainEditDialog;
