import { describe, expect, it } from 'vitest';

import { canWriteTable } from './access';
import { TODO_TABLE } from './schema/todos';

describe('canWriteTable', () => {
  it('lets owners write any table via the wildcard', () => {
    expect(canWriteTable('owner', TODO_TABLE)).toBe(true);
    expect(canWriteTable('owner', 'some_other_table')).toBe(true);
  });

  it('lets members write their permitted table only', () => {
    expect(canWriteTable('member', TODO_TABLE)).toBe(true);
    expect(canWriteTable('member', 'some_other_table')).toBe(false);
  });

  it('denies viewers all writes', () => {
    expect(canWriteTable('viewer', TODO_TABLE)).toBe(false);
  });

  it('denies non-members (null role)', () => {
    expect(canWriteTable(null, TODO_TABLE)).toBe(false);
  });

  it('denies unknown roles', () => {
    expect(canWriteTable('superadmin', TODO_TABLE)).toBe(false);
  });
});
