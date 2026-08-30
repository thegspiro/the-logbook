/**
 * Equipment-check types — re-export shim.
 *
 * These moved to `modules/inventory/types/equipmentCheck` when equipment
 * checklists became an Inventory feature: a checklist is a list of inventory
 * items, and its API is gated on the Inventory module.
 *
 * The shim stays because Scheduling still owns *performing* a check —
 * EquipmentCheckForm, MyChecklistsPage, ShiftDetailPanel, ShiftCheckInPage —
 * and `modules/scheduling/types/index.ts` re-exports a dozen of these names
 * onward. Pointing those at the new home through one file is what keeps the
 * move from touching every consumer.
 *
 * `export *` rather than a named list: this module exports runtime values
 * (`CheckType`, `normalizeCheckType`, `CONTAINER_TYPE_PRESETS`, …) as well as
 * types, and under `isolatedModules` a named re-export of a type-only symbol
 * has to be spelled `export type`. Enumerating 80-odd names in two lists is a
 * merge conflict waiting to happen.
 */
export * from '../../inventory/types/equipmentCheck';
