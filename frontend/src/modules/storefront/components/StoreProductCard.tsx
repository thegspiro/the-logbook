/**
 * Storefront Product Card
 *
 * Everything a member decides about one item — size, personalization, quantity
 * — is decided on the card itself, so the cart only ever confirms choices that
 * were already visible.
 *
 * Sizes are chips rather than a `<select>`: a dropdown hides how many sizes
 * exist, hides which are sold out until you open it, and on a phone hands the
 * choice to a native picker that covers the price you are choosing against.
 */

import React, { useMemo, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { formatCurrency } from '../../../utils/dateFormatting';
import { productGlyph } from '../utils/productGlyph';
import {
  ENGRAVED_CAPTION,
  ENGRAVED_SURFACE,
  ENGRAVED_TEXT,
  threadPreviewCaption,
  threadPreviewSurface,
} from '../utils/threadPreview';
import { DEFAULT_EMBROIDERY_THREAD_COLOR_HEX, personalizationPrompt, usesThreadColor } from '../types';
import type { StorefrontProductOffer, StorefrontVariantOption } from '../types';

/** Below this, the "only n left" nudge is worth the anxiety it creates. */
const LOW_STOCK_THRESHOLD = 5;

const CHIP_BASE =
  'focus-visible:ring-theme-focus-ring inline-flex h-11 min-w-[44px] items-center justify-center rounded-lg px-2.5 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden md:h-9';
const CHIP_IDLE =
  'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover border bg-theme-surface';
const CHIP_SELECTED =
  'border-2 border-red-800 bg-red-50 font-bold text-red-900 dark:border-red-600 dark:bg-red-500/15 dark:text-red-200';
const CHIP_UNAVAILABLE =
  'border-theme-input-border text-theme-text-muted cursor-not-allowed border border-dashed line-through';

interface StoreProductCardProps {
  offer: StorefrontProductOffer;
  onAdd: (variantId: string | undefined, quantity: number, personalizationText: string | undefined) => void;
}

export const StoreProductCard: React.FC<StoreProductCardProps> = ({ offer, onAdd }) => {
  const [variantId, setVariantId] = useState<string>(offer.variants[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  // A required personalization is not a choice, so the box starts ticked and
  // stays that way — the member's only decision is what to put in it.
  const [personalizationOn, setPersonalizationOn] = useState(
    offer.personalizationEnabled && offer.personalizationRequired
  );
  const [personalizationText, setPersonalizationText] = useState('');

  const selectedVariant: StorefrontVariantOption | undefined = offer.variants.find((v) => v.id === variantId);
  const basePrice = Number(selectedVariant ? selectedVariant.price : offer.price);
  const upcharge = Number(offer.personalizationPrice ?? 0);
  const remaining = selectedVariant ? selectedVariant.availableQuantity : offer.availableQuantity;
  const soldOut = selectedVariant ? !selectedVariant.isAvailable : !offer.isAvailable;
  const trimmedText = personalizationText.trim();
  const missingRequiredText = offer.personalizationEnabled && offer.personalizationRequired && !trimmedText;
  const personalizing = offer.personalizationEnabled && personalizationOn;

  const lineTotal = useMemo(
    () => (basePrice + (personalizing && trimmedText ? upcharge : 0)) * quantity,
    [basePrice, personalizing, quantity, trimmedText, upcharge]
  );

  const Glyph = productGlyph(offer);
  const canAdd = !soldOut && !(offer.requiresVariant && !variantId) && !missingRequiredText;
  // The prompt names the process, so a coin does not ask to be embroidered.
  const personalizationLabel = offer.personalizationLabel || personalizationPrompt(offer.personalizationMethod);
  const stitched = usesThreadColor(offer.personalizationMethod);
  // Falls back to the historical gold for an offer served by a backend that
  // predates the setting, so the preview never renders with no color at all.
  const threadHex = offer.personalizationThreadColorHex || DEFAULT_EMBROIDERY_THREAD_COLOR_HEX;

  const handleAdd = () => {
    onAdd(variantId || undefined, quantity, (personalizing && trimmedText) || undefined);
    setQuantity(1);
    setPersonalizationText('');
  };

  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="bg-theme-surface-hover relative flex h-[180px] w-full items-center justify-center sm:h-[168px]">
        {offer.imageUrl ? (
          <img src={offer.imageUrl} alt={offer.name} className="h-full w-full object-cover" />
        ) : (
          <Glyph className="text-theme-text-muted h-10 w-10" aria-hidden="true" />
        )}
        {soldOut ? (
          <span className="absolute top-2.5 left-2.5 rounded-full bg-slate-900 px-2.5 py-[3px] text-[11px] font-semibold text-white">
            Sold out
          </span>
        ) : (
          offer.category && (
            <span className="bg-theme-surface border-theme-surface-border text-theme-text-secondary absolute top-2.5 left-2.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold">
              {offer.category}
            </span>
          )
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-theme-text-primary text-base font-semibold">{offer.name}</h3>
          <span className="text-theme-text-primary font-mono text-base font-bold whitespace-nowrap">
            {formatCurrency(basePrice)}
          </span>
        </div>

        {offer.description && (
          <p className="text-theme-text-secondary text-[13px] leading-relaxed whitespace-pre-line">
            {offer.description}
          </p>
        )}

        {offer.variants.length > 0 && (
          <div>
            <p
              className="text-theme-text-secondary mb-1.5 text-[10px] font-bold tracking-[.1em] uppercase"
              id={`size-${offer.id}`}
            >
              Size
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`size-${offer.id}`}>
              {offer.variants.map((variant) => {
                const selected = variant.id === variantId;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={!variant.isAvailable}
                    onClick={() => setVariantId(variant.id)}
                    className={`${CHIP_BASE} ${
                      !variant.isAvailable ? CHIP_UNAVAILABLE : selected ? CHIP_SELECTED : CHIP_IDLE
                    }`}
                  >
                    {variant.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {offer.personalizationEnabled && (
          <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-3">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={personalizationOn}
                disabled={offer.personalizationRequired}
                onChange={(e) => setPersonalizationOn(e.target.checked)}
              />
              <span
                aria-hidden="true"
                className={`peer-focus-visible:ring-theme-focus-ring inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 ${
                  personalizationOn ? 'bg-red-800' : 'border-theme-input-border bg-theme-input-bg border'
                }`}
              >
                {personalizationOn && <Check className="h-3 w-3 text-white" />}
              </span>
              <span className="text-theme-text-primary flex-1 text-[13px] font-semibold">{personalizationLabel}</span>
              {upcharge > 0 && (
                <span className="text-theme-text-secondary font-mono text-[13px]">+{formatCurrency(upcharge)}</span>
              )}
            </label>

            {personalizationOn && (
              <div className="motion-safe:animate-scale-in mt-2.5">
                <label htmlFor={`personalization-${offer.id}`} className="sr-only">
                  {personalizationLabel}
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    id={`personalization-${offer.id}`}
                    type="text"
                    value={personalizationText}
                    maxLength={offer.personalizationMaxLength}
                    onChange={(e) => setPersonalizationText(e.target.value)}
                    className="form-input font-mono"
                    placeholder="e.g. J. SMITH"
                  />
                  <span className="text-theme-text-secondary shrink-0 text-[11px]">
                    {personalizationText.length}/{offer.personalizationMaxLength}
                  </span>
                </div>

                {/* Decorative: the input above already announces its own value,
                    and the uppercasing here is display-only — the raw text is
                    what gets embroidered. */}
                {trimmedText && (
                  <div
                    aria-hidden="true"
                    className={`mt-2.5 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${
                      stitched ? threadPreviewSurface(threadHex) : ENGRAVED_SURFACE
                    }`}
                  >
                    <span
                      className={`text-[10px] font-bold tracking-[.1em] uppercase ${
                        stitched ? threadPreviewCaption(threadHex) : ENGRAVED_CAPTION
                      }`}
                    >
                      Preview
                    </span>
                    {/* Inline color, not a Tailwind class: the thread is chosen
                        by the quartermaster at runtime and resolved to a hex by
                        the API, so there is no class name to compile ahead. */}
                    <span
                      className="font-mono text-sm font-bold tracking-[.14em] uppercase"
                      style={{ color: stitched ? threadHex : ENGRAVED_TEXT }}
                    >
                      {trimmedText}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {remaining != null && remaining > 0 && remaining <= LOW_STOCK_THRESHOLD && (
          <p className="text-xs text-amber-900 dark:text-amber-200">
            Only {remaining} left{selectedVariant ? ` in ${selectedVariant.label}` : ''}
          </p>
        )}

        <div className="mt-auto flex items-center gap-2">
          {!soldOut && (
            <div className="border-theme-surface-border bg-theme-surface flex shrink-0 items-center rounded-lg border">
              <button
                type="button"
                aria-label={`Decrease quantity of ${offer.name}`}
                className="btn-icon text-theme-text-secondary"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="text-theme-text-primary w-8 text-center text-sm font-semibold">{quantity}</span>
              <button
                type="button"
                aria-label={`Increase quantity of ${offer.name}`}
                className="btn-icon text-theme-text-secondary"
                onClick={() => setQuantity((q) => q + 1)}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn-primary btn-md flex min-h-[44px] flex-1 items-center justify-center gap-2 font-semibold"
            disabled={!canAdd}
            onClick={handleAdd}
          >
            {soldOut ? (
              'Sold out this window'
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add {formatCurrency(lineTotal)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StoreProductCard;
