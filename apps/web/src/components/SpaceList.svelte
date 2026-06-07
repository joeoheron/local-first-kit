<script lang="ts">
  import { Tabs } from "bits-ui";
  import { invalidateAll } from '$app/navigation';
  import { syncState } from '$lib/local/persistenceLifecycle.svelte';
  import {
    generateAesKey,
    wrapKey,
    loadDeviceKey,
    storeSpaceKey,
  } from '$lib/local/crypto';

  let {
    spaces,
    user,
    publicServerUrl,
  }: {
    spaces: Array<{ id: string; name: string; role: string }>;
    user: { id: string } | null;
    publicServerUrl: string;
  } = $props();

  let newListName = $state('');
  let creating = $state(false);
  let showInput = $state(false);

  async function switchTo(spaceId: string) {
    if (!user || syncState.activeSpaceId === spaceId) return;
    await syncState.switchSpace({ user, publicServerUrl, spaceId });
  }

  async function createSpace() {
    if (!user || !newListName.trim()) return;
    creating = true;
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (!res.ok) throw new Error('Space creation failed');
      const { spaceId } = await res.json() as { spaceId: string };

      const deviceKey = await loadDeviceKey();
      if (deviceKey) {
        const spaceKey = await generateAesKey();
        const wrappedKey = await wrapKey(spaceKey, deviceKey);
        await fetch(`/api/keys/space/${spaceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wrappedKey }),
        });
        await storeSpaceKey(spaceId, spaceKey);
      }

      newListName = '';
      showInput = false;
      await invalidateAll();
      await syncState.switchSpace({ user, publicServerUrl, spaceId });
    } catch (err) {
      console.error('[SpaceList] createSpace failed:', err);
    } finally {
      creating = false;
    }
  }
</script>

{#if user && spaces.length > 0}
  <div class="border-b border-stroke px-4 py-2">
    <Tabs.Root
      value={syncState.activeSpaceId ?? undefined}
      onValueChange={(id) => switchTo(id)}
      class="flex items-center gap-1"
    >
      <Tabs.List class="bg-dark-10 shadow-mini-inset flex items-center gap-1 rounded-lg p-1">
        {#each spaces as space (space.id)}
          <Tabs.Trigger
            value={space.id}
            data-space-active={syncState.activeSpaceId === space.id}
            class="data-[state=active]:shadow-mini data-[state=active]:bg-background data-[state=active]:text-fg data-[state=active]:font-semibold h-7 rounded-md bg-transparent px-3 py-1 text-sm font-medium text-muted"
          >
            {space.name}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>

      {#if showInput}
        <form
          onsubmit={(e) => { e.preventDefault(); createSpace(); }}
          class="flex items-center gap-1 ml-1"
        >
          <input
            type="text"
            bind:value={newListName}
            placeholder="List name"
            disabled={creating}
            class="field w-28"
            autofocus
          />
          <button
            type="submit"
            disabled={creating || !newListName.trim()}
            class="btn-xs btn-primary"
          >
            {creating ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onclick={() => { showInput = false; newListName = ''; }}
            class="btn-xs btn-link"
          >
            Cancel
          </button>
        </form>
      {:else}
        <button
          type="button"
          onclick={() => { showInput = true; }}
          class="btn-xs btn-ghost shrink-0 ml-1"
        >
          + New list
        </button>
      {/if}
    </Tabs.Root>
  </div>
{/if}
