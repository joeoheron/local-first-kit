<script lang="ts">
	import 'virtual:uno.css';
	import '../app.css';
  import Header from '../components/Header.svelte';
  import SyncInit from '../components/SyncInit.svelte';

  let { children, data } = $props();
</script>

<SyncInit
  user={data.user}
  publicServerUrl={data.publicServerUrl}
  spaceId={data.activeSpaceId}
/>
<div class="grid h-svh grid-rows-[auto_1fr]">
  <Header data={data} />
  <main class="overflow-y-auto">
    {@render children()}
  </main>
</div>
