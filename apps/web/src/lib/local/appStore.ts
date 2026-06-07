import {createAppStore, type AppStore} from '@local-first-kit/data';
import {todoTablesSchema} from '@local-first-kit/domain';

/**
 * Factory for a per-space MergeableStore wired to the domain schema.
 *
 * Each space gets its OWN store instance — created on switch-in, torn down on
 * switch-out (see persistenceLifecycle.svelte.ts) — so a space only ever syncs with
 * its own Durable Object and its own OPFS file. The active store lives on
 * `syncState.store`.
 *
 * Do NOT reintroduce a single shared store across spaces. A shared store multiplexed
 * over multiple sync targets let a synchronizer bound to it bleed/wipe todo data
 * between spaces (it could observe one space's data — or a transient empty reset — and
 * propagate it to another space's DO). Per-space instances make that structurally
 * impossible.
 */
export const createSpaceStore = (): AppStore => createAppStore(todoTablesSchema);

export type {AppStore};
