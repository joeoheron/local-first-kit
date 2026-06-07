import type {AppStore} from '@local-first-kit/data';
import type {DomainCrypto} from '../crypto.js';
import {TODO_TABLE} from '../schema/todos';

const createTodoId = () => crypto.randomUUID();

export async function addTodo(
  store: AppStore,
  text: string,
  createdBy = '',
  domainCrypto?: DomainCrypto,
): Promise<string> {
  const trimmedText = text.trim();

  if (!trimmedText) {
    throw new Error('Todo text is required');
  }

  const now = Date.now();
  const id = createTodoId();
  const storedText = domainCrypto
    ? await domainCrypto.encrypt(TODO_TABLE, 'text', trimmedText)
    : trimmedText;

  store.setRow(TODO_TABLE, id, {
    text: storedText,
    completed: false,
    createdAt: now,
    updatedAt: now,
    createdBy,
  });

  return id;
}

export function toggleTodo(store: AppStore, id: string): void {
  const completed = store.getCell(TODO_TABLE, id, 'completed');

  if (typeof completed !== 'boolean') {
    return;
  }

  store.setPartialRow(TODO_TABLE, id, {
    completed: !completed,
    updatedAt: Date.now(),
  });
}

export function deleteTodo(store: AppStore, id: string): void {
  store.delRow(TODO_TABLE, id);
}
