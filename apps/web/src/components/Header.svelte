<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';

  let { data }: { data: { user: { id: string } | null; publicServerUrl: string } } = $props();

  async function logout() {
    await fetch('/auth/logout', { method: 'POST' });
    await invalidateAll();
    await goto('/');
  }
</script>

<div>
  <div class="flex flex-row items-center justify-between px-4 py-2 md:px-6">
    <nav class="flex gap-4 text-lg">
      <a href="/" class="text-sm text-fg-muted transition-colors hover:text-fg">Home</a>
      <a href="/todos" class="text-sm text-fg-muted transition-colors hover:text-fg">Todos</a>
    </nav>
    <div class="flex items-center gap-3 text-sm">
      {#if data.user}
        <span class="text-fg-muted">{data.user.id.substring(0, 8)}...</span>
        <a href="/settings" class="text-fg-muted transition-colors hover:text-fg">Settings</a>
        <button onclick={logout} class="ml-2 cursor-pointer text-destructive transition-colors hover:text-destructive/80">Logout</button>
      {:else}
        <a href="/auth/login" class="text-info transition-colors hover:text-info/80">Sign in</a>
      {/if}
    </div>
  </div>
  <hr class="border-stroke" />
</div>
