import { describe, expect, it } from 'vitest';

import { createAppStore } from '@local-first-kit/data';
import { addTodo, deleteTodo, toggleTodo } from './todos';
import { TODO_TABLE, todoTablesSchema } from '../schema/todos';

describe('todo operations', () => {
  it('adds a todo row with sync-friendly string id and timestamps', async () => {
    const store = createAppStore(todoTablesSchema);

    const id = await addTodo(store, 'Learn TinyBase');

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(store.getCell(TODO_TABLE, id, 'text')).toBe('Learn TinyBase');
    expect(store.getCell(TODO_TABLE, id, 'completed')).toBe(false);
    expect(typeof store.getCell(TODO_TABLE, id, 'createdAt')).toBe('number');
    expect(typeof store.getCell(TODO_TABLE, id, 'updatedAt')).toBe('number');
    expect(store.getCell(TODO_TABLE, id, 'createdBy')).toBe('');
  });

  it('stores createdBy when provided', async () => {
    const store = createAppStore(todoTablesSchema);

    const id = await addTodo(store, 'Owned todo', 'user-123');

    expect(store.getCell(TODO_TABLE, id, 'createdBy')).toBe('user-123');
  });

  it('trims todo text and rejects empty todos', async () => {
    const store = createAppStore(todoTablesSchema);

    const id = await addTodo(store, '  Trim me  ');

    expect(store.getCell(TODO_TABLE, id, 'text')).toBe('Trim me');
    await expect(addTodo(store, '   ')).rejects.toThrow('Todo text is required');
  });

  it('toggles and deletes todos', async () => {
    const store = createAppStore(todoTablesSchema);
    const id = await addTodo(store, 'Toggle me');

    toggleTodo(store, id);
    expect(store.getCell(TODO_TABLE, id, 'completed')).toBe(true);

    toggleTodo(store, id);
    expect(store.getCell(TODO_TABLE, id, 'completed')).toBe(false);

    deleteTodo(store, id);
    expect(store.hasRow(TODO_TABLE, id)).toBe(false);
  });
});
