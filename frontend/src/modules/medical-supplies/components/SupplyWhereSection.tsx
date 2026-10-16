/**
 * SupplyWhereSection — where one medical supply is: the shelf it is filed on,
 * and every apparatus that carries it.
 *
 * The apparatus list is the checklist link read from the supply's side, the
 * direction an officer holding a recall notice or an expiring lot works from:
 * which trucks have this, in which compartment, and how many are aboard.
 */

import React, { useEffect, useState } from 'react';
import { Package, Truck } from 'lucide-react';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import type { InventoryItem } from '../../../services/eventServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCalendarDate, formatNumber } from '../../../utils/dateFormatting';
import { storageNote } from '../types';
import type { MedicalSupplyPlacement } from '../types';

interface SupplyWhereSectionProps {
  item: InventoryItem;
}

/** "Medic 1", or the apparatus type a template was written for, or the template's own name. */
function carrierName(p: MedicalSupplyPlacement): string {
  return p.apparatusName || (p.apparatusType ? `Any ${p.apparatusType}` : p.templateName || 'Unnamed checklist');
}

/** "Main Compartment › Jump Bag", from the checklist's nesting. */
function compartmentLabel(p: MedicalSupplyPlacement): string {
  const path = p.compartmentPath?.length ? p.compartmentPath : p.compartmentName ? [p.compartmentName] : [];
  return path.join(' › ');
}

export const SupplyWhereSection: React.FC<SupplyWhereSectionProps> = ({ item }) => {
  const [placements, setPlacements] = useState<MedicalSupplyPlacement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const note = storageNote(item);

  useEffect(() => {
    let cancelled = false;
    medicalSuppliesService
      .getItemPlacements(item.id)
      .then((rows) => {
        if (!cancelled) setPlacements(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Failed to load the apparatus that carry it'));
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  return (
    <section aria-labelledby="supply-where" className="space-y-3">
      <h3 id="supply-where" className="text-theme-text-primary text-sm font-semibold">
        Where it is
      </h3>

      <div className="flex items-start gap-2 text-sm">
        <Package className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-theme-text-primary">
            {item.storage_path || (note ? 'No storage area' : 'No storage location recorded')}
          </p>
          {note && <p className="text-theme-text-muted text-xs">{note}</p>}
        </div>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <Truck className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {error ? (
            <p role="alert" className="alert-danger text-sm">
              {error}
            </p>
          ) : !placements ? (
            <p className="text-theme-text-muted">Loading apparatus…</p>
          ) : placements.length === 0 ? (
            <p className="text-theme-text-muted">
              Not on any apparatus checklist. Link a checklist line to this supply to see it here.
            </p>
          ) : (
            <ul className="divide-theme-surface-border divide-y" aria-label="Apparatus that carry it">
              {placements.map((p) => {
                const aboard = p.quantityOnTruck ?? p.targetQuantity;
                return (
                  <li key={p.templateItemId} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5">
                    <span className="text-theme-text-primary min-w-0">
                      <span className="font-medium">{carrierName(p)}</span>
                      {compartmentLabel(p) && <span className="text-theme-text-muted"> · {compartmentLabel(p)}</span>}
                    </span>
                    <span className="text-theme-text-secondary text-xs tabular-nums">
                      {aboard != null && (
                        <>
                          {formatNumber(aboard)}
                          {p.targetQuantity != null ? ` of ${formatNumber(p.targetQuantity)}` : ''} aboard
                          {p.quantityOnTruck == null && p.targetQuantity != null ? ' (not counted yet)' : ''}
                        </>
                      )}
                      {p.expirationDate && (
                        <span className={p.isExpired ? 'ml-2 text-red-700 dark:text-red-400' : 'ml-2'}>
                          {p.isExpired ? 'Expired' : 'Expires'} {formatCalendarDate(p.expirationDate)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};

export default SupplyWhereSection;
