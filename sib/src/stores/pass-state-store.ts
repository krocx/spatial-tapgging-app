import type { PassState } from '@spatial/shared';
import { JsonFileStore } from './json-file-store.js';

// One PassState per tag — keyed by tagId for fast lookup in Operator mode.
// JsonFileStore persists to .sib-data/pass-states.json so data survives restarts.
export const passStateStore = new JsonFileStore<PassState>('pass-states');

export function findPassStateByTag(tagId: string): PassState | undefined {
  return passStateStore.findAll().find(p => p.tagId === tagId);
}
