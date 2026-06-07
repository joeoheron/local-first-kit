import {createMergeableStore} from 'tinybase/mergeable-store';
import type {TablesSchema} from 'tinybase/store';

export function createAppStore<S extends TablesSchema>(schema: S) {
  return createMergeableStore().setTablesSchema(schema);
}

// Broad type for infrastructure code (persistence layer) that accepts any app store.
export type AppStore = ReturnType<typeof createMergeableStore>;
