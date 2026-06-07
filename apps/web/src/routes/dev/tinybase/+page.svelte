<script lang="ts">
  import {Provider} from 'tinybase/ui-svelte';
  import {Inspector} from 'tinybase/ui-svelte-inspector';

  import {syncState} from '$lib/local/persistenceLifecycle.svelte';
</script>

<div class="p-4 space-y-4">
  <div>
    <h1 class="text-xl mb-2">TinyBase Inspector</h1>
    <p class="text-sm">
      Development-only view of the live TinyBase store. Use this as the
      TinyBase equivalent of a lightweight Drizzle Studio while prototyping.
    </p>
  </div>

  <div class="text-sm">
    Sync: {syncState.status}
  </div>

  {#key syncState.store}
    <Provider store={syncState.store} storesById={{app: syncState.store}}>
      <Inspector position="full" open={true} />
    </Provider>
  {/key}
</div>
