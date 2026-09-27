import type { InventoryEntry, InventoryState, InventoryUpdate } from '../types';

/**
 * Pantry inventory rules (plan_06). Pure functions over plain data — no I/O,
 * no AI. Mirrored in backend/app/inventory/store.py.
 *
 *   - One row per product; every update is an upsert with a fresh `updatedAt`.
 *   - An update is a full statement of what the user said: an approximate
 *     amount is kept only if this update gave one (a stale "~2 kg" never
 *     survives "rice is almost finished"), and `out` never carries one.
 *   - A confirmed purchase flips the row to `available`.
 *   - `almost_finished` / `out` are the buy signal the planner may act on —
 *     by proposing, never by adding on its own.
 */
export const INVENTORY_STATES: InventoryState[] = ['available', 'running_low', 'almost_finished', 'out'];

/** How a pantry state reads in a sentence: "rice is almost finished". */
export const INVENTORY_STATE_LABEL: Record<InventoryState, string> = {
  available: 'stocked up',
  running_low: 'running low',
  almost_finished: 'almost finished',
  out: 'finished',
};

export const needsRestock = (s: InventoryState) => s === 'almost_finished' || s === 'out';

export function upsertInventory(list: InventoryEntry[], u: InventoryUpdate, now: Date): InventoryEntry[] {
  const row: InventoryEntry = { productId: u.productId, state: u.state, updatedAt: now.toISOString() };
  if (u.state !== 'out' && u.approxQty != null && u.approxUnit) {
    row.approxQty = u.approxQty;
    row.approxUnit = u.approxUnit;
  }
  const idx = list.findIndex((i) => i.productId === u.productId);
  if (idx < 0) return [...list, row];
  const next = [...list];
  next[idx] = row;
  return next;
}

/** Bought → `available` with a fresh timestamp, creating the row if the pantry didn't track it yet. */
export function restockPurchased(list: InventoryEntry[], productIds: string[], now: Date): InventoryEntry[] {
  return [...new Set(productIds)].reduce((inv, productId) => upsertInventory(inv, { productId, state: 'available' }, now), list);
}
