<!--
  Manages the TinyBase sync lifecycle.
  Connects when the user is authenticated and has a personal space.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { syncState } from '$lib/local/persistenceLifecycle.svelte';
  import { loadStorageKey } from '$lib/local/crypto';
  import { credentialIdStorageKey } from '$lib/local/storageKeys';

  let {
    user,
    publicServerUrl,
    spaceId,
  }: {
    user: { id: string } | null;
    publicServerUrl: string;
    spaceId: string | null;
  } = $props();

  const userId = $derived(user?.id ?? null);
  // Derive a boolean so the effect doesn't re-run on unrelated navigations —
  // only re-runs when this value flips (leaving or arriving at welcome).
  const isWelcomePage = $derived(page.url.pathname.startsWith('/auth/welcome'));

  // Non-reactive — tracks whether this component has observed an active session.
  // Prevents a spurious disable() when navigating from /auth/welcome to / :
  // page.url updates synchronously (flipping isWelcomePage) before data.user
  // arrives from the layout re-load, creating a window where userId is transiently
  // null while no real logout has occurred.
  // See docs/scenarios/persistence-lifecycle-scenarios.md#scenario-3-spurious-disable-during-navigation
  // DO NOT remove the prevActiveUserId guard.
  let prevActiveUserId: string | null = null;

  $effect(() => {
    if (isWelcomePage) return;

    if (userId && publicServerUrl && spaceId) {
      prevActiveUserId = userId;
      loadStorageKey().then(key => {
        const credentialId = localStorage.getItem(credentialIdStorageKey(userId)) ?? undefined;
        return syncState.enable(
          { user: { id: userId }, publicServerUrl, spaceId, credentialId },
          key ?? undefined,
        );
      }).catch((err: unknown) => {
        console.error('Failed to initialize sync:', err);
      });
    } else if (prevActiveUserId !== null) {
      prevActiveUserId = null;
      syncState.disable().catch(() => { /* best-effort */ });
    }
  });

  $effect(() => {
    return () => {
      syncState.disable().catch(() => { /* best-effort */ });
    };
  });
</script>

{#if user && spaceId}
  <div class="fixed bottom-2 right-2 text-xs opacity-50">
    Sync: {syncState.status}
  </div>
{/if}
