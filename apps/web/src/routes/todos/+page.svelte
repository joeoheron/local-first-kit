<!-- src/routes/todos/+page.svelte -->
<script lang="ts">
  import { Checkbox, Label } from 'bits-ui';
  import {addTodo, deleteTodo, toggleTodo, TODO_TABLE} from '@local-first-kit/domain';
  import {getTable} from 'tinybase/ui-svelte';

  import {syncState} from '$lib/local/persistenceLifecycle.svelte';
  import SpaceList from '../../components/SpaceList.svelte';
  import PendingInvites from '../../components/PendingInvites.svelte';
  import InviteButton from '../../components/InviteButton.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Getter (not a fixed instance) so the listenable re-subscribes when the active
  // space's store is swapped on switchSpace — see persistenceLifecycle.svelte.ts.
  const todosTable = getTable(TODO_TABLE, () => syncState.store);
  const rawTodos = $derived(Object.entries(todosTable.current).filter(([, t]) => t.text));

  // Decrypted display list — updated reactively when store or domainCrypto changes.
  let todos = $state<[string, Record<string, unknown> & { text: string }][]>([]);

  $effect(() => {
    const entries = rawTodos;
    const crypto = syncState.domainCrypto;
    Promise.all(
      entries.map(async ([id, todo]) => {
        const text = crypto
          ? await crypto.decrypt(TODO_TABLE, 'text', todo.text as string)
          : todo.text as string;
        return [id, { ...todo, text }] as [string, Record<string, unknown> & { text: string }];
      })
    ).then(result => { todos = result; });
  });

  let newTodoText = $state('');
  let error = $state<string | null>(null);

  async function handleAddTodo() {
    try {
      await addTodo(syncState.store, newTodoText, data.user?.id ?? '', syncState.domainCrypto ?? undefined);
      newTodoText = '';
      error = null;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'An unknown error occurred';
    }
  }

  function handleToggleTodo(id: string) {
    toggleTodo(syncState.store, id);
  }

  function handleDeleteTodo(id: string) {
    deleteTodo(syncState.store, id);
  }
</script>

<SpaceList
  spaces={data.spaces}
  user={data.user}
  publicServerUrl={data.publicServerUrl}
/>

<PendingInvites
  invites={data.pendingInvites}
  user={data.user}
  publicServerUrl={data.publicServerUrl}
/>

<div class="p-4">
  <div class="flex items-center gap-2 mb-4">
    <h1 class="text-xl">Todos</h1>
    {#if data.user && syncState.activeSpaceId}
      <InviteButton spaceId={syncState.activeSpaceId} />
    {/if}
  </div>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      handleAddTodo();
    }}
    class="flex gap-2 mb-4"
  >
    <input
      type="text"
      bind:value={newTodoText}
      placeholder="New task..."
      class="field grow"
    />
    <button
      type="submit"
      disabled={!newTodoText.trim()}
      class="btn-sm btn-primary"
    >
      Add
    </button>
  </form>

  {#if todos.length === 0}
    <p>No todos yet.</p>
  {:else}
    <ul class="space-y-1">
      {#each todos as [todoId, todo] (todoId)}
        <li class="flex items-center justify-between p-2">
          <div class="flex items-center gap-2">
            <Checkbox.Root
              id="todo-{todoId}"
              checked={todo.completed === true}
              onCheckedChange={() => handleToggleTodo(todoId)}
              class="size-4 shrink-0 rounded border border-stroke bg-surface
                     data-[state=checked]:bg-primary data-[state=checked]:border-primary
                     flex items-center justify-center transition-colors"
            >
              {#snippet children({ checked })}
                {#if checked}
                  <svg class="size-3 text-primary-fg" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                {/if}
              {/snippet}
            </Checkbox.Root>
            <Label.Root
              for="todo-{todoId}"
              class="text-sm cursor-pointer {todo.completed ? 'line-through text-muted' : 'text-fg'}"
            >
              {todo.text}
            </Label.Root>
          </div>
          <button
            type="button"
            onclick={() => handleDeleteTodo(todoId)}
            aria-label="Delete todo"
            class="btn-xs btn-danger"
          >
            X
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
    <p class="alert-error mt-4">
      Error: {error}
    </p>
  {/if}
</div>
