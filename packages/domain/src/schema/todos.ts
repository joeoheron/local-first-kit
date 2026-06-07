export const TODO_TABLE = 'todos';

export const todoTablesSchema = {
  [TODO_TABLE]: {
    text:      {type: 'string'},
    completed: {type: 'boolean', default: false},
    createdAt: {type: 'number'},
    updatedAt: {type: 'number'},
    createdBy: {type: 'string', default: ''},
  },
} as const;

export type TodoId = string;

export type TodoRow = {
  text: string;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};
