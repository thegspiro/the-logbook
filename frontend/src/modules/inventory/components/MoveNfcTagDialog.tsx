/**
 * Move an inventory NFC tag onto another target of the same kind — for a tag
 * linked to the wrong helmet, shelf or compartment — without the tag in hand.
 *
 * The kind is fixed by the tag: an item tag moves to another item, a shelf tag
 * to another storage area, a compartment tag to another compartment. A tag
 * that changes kind has been peeled off and re-stuck, which is an unlink and a
 * fresh link, and the server refuses it.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { inventoryService } from '../../../services/api';
import { InventoryNfcTagKind } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { InventoryNfcMoveTarget, InventoryNfcRegisterTag, InventoryNfcTagMove } from '../types/nfc';

const KIND_NOUNS: Record<InventoryNfcTagKind, string> = {
  item: 'item',
  storage_area: 'storage area',
  compartment: 'compartment',
};

const currentTargetId = (tag: InventoryNfcRegisterTag): string | null =>
  tag.item_id ?? tag.storage_area_id ?? tag.check_compartment_id;

const moveBody = (kind: InventoryNfcTagKind, id: string): InventoryNfcTagMove => {
  if (kind === InventoryNfcTagKind.ITEM) return { item_id: id };
  if (kind === InventoryNfcTagKind.STORAGE_AREA) return { storage_area_id: id };
  return { check_compartment_id: id };
};

interface MoveNfcTagDialogProps {
  /** The tag being moved; null while the dialog is closed. */
  tag: InventoryNfcRegisterTag | null;
  onClose: () => void;
  onMoved: () => void;
}

export const MoveNfcTagDialog: React.FC<MoveNfcTagDialogProps> = ({ tag, onClose, onMoved }) => {
  const idBase = useId();
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState<InventoryNfcMoveTarget[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A search typed quickly fires several requests; only the latest may land.
  const requestSeq = useRef(0);

  const load = useCallback(async (kind: InventoryNfcTagKind, query: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const found = await inventoryService.getNfcMoveTargets(kind, query);
      if (seq !== requestSeq.current) return;
      setTargets(found);
    } catch (err: unknown) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(err, 'Could not load places to move the tag to.'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // A fresh start for each tag, so a target picked for one is never moved
  // onto by the next.
  useEffect(() => {
    setSearch('');
    setChosen(null);
    setTargets([]);
    if (tag) void load(tag.kind, '');
  }, [tag, load]);

  if (!tag) return null;
  const noun = KIND_NOUNS[tag.kind];
  const here = currentTargetId(tag);

  const submit = async () => {
    if (!chosen) return;
    setSaving(true);
    try {
      await inventoryService.moveNfcTag(tag.id, moveBody(tag.kind, chosen));
      const name = targets.find((t) => t.id === chosen)?.name ?? `the ${noun}`;
      toast.success(`Tag …${tag.uid_preview} moved to ${name}`);
      onMoved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not move the tag.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Move tag …${tag.uid_preview}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            disabled={!chosen || saving}
            onClick={() => void submit()}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Move tag
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-theme-text-secondary text-sm">
          Now on <strong className="text-theme-text-primary">{tag.target_name ?? `an unknown ${noun}`}</strong>. A tag
          moves to another {noun} only; to stick it on something else, unlink it and link it again there.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(tag.kind, search);
          }}
        >
          <div className="flex-1">
            <label className="form-label" htmlFor={`${idBase}-search`}>
              Find a {noun}
            </label>
            <input
              id={`${idBase}-search`}
              className="form-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
            />
          </div>
          <button type="submit" className="btn-secondary btn-auto self-end" aria-label={`Search for a ${noun}`}>
            <Search className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>

        {error && <p className="text-theme-alert-danger-text text-sm">{error}</p>}
        {loading ? (
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" aria-label="Loading" />
        ) : targets.length === 0 && !error ? (
          <p className="text-theme-text-secondary text-sm">No {noun} matches.</p>
        ) : (
          <fieldset>
            <legend className="sr-only">Move to</legend>
            <ul className="divide-theme-surface-border max-h-72 divide-y overflow-y-auto">
              {targets.map((target) => (
                <li key={target.id}>
                  <label className="touch:min-h-11 flex cursor-pointer items-center gap-3 py-2">
                    <input
                      type="radio"
                      name={`${idBase}-target`}
                      className="form-checkbox"
                      value={target.id}
                      checked={chosen === target.id}
                      disabled={target.id === here}
                      onChange={() => setChosen(target.id)}
                    />
                    <span className="min-w-0">
                      <span className="text-theme-text-primary block text-sm">
                        {target.name}
                        {target.id === here && ' (current)'}
                      </span>
                      {target.detail && (
                        <span className="text-theme-text-secondary block text-xs">{target.detail}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </div>
    </Modal>
  );
};
