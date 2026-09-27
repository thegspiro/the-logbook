import type { StorageAreaResponse } from '../types';

// A container nested deeper than this is not a container any more; the bound
// keeps a mis-parented tree from fanning out into hundreds of requests.
const MAX_CONTAINER_AREAS = 50;

/** The area and every area nested under it, nearest first. */
export function containerAreaIds(rootId: string, areas: StorageAreaResponse[]): string[] {
  const ids = [rootId];
  const seen = new Set(ids);
  for (let i = 0; i < ids.length && ids.length < MAX_CONTAINER_AREAS; i++) {
    for (const area of areas) {
      if (area.parent_id === ids[i] && !seen.has(area.id)) {
        seen.add(area.id);
        ids.push(area.id);
      }
    }
  }
  return ids.slice(0, MAX_CONTAINER_AREAS);
}
