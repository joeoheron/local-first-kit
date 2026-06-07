<script lang="ts">
  import { Checkbox, Label } from 'bits-ui';
  import { goto } from '$app/navigation';
  import { syncState, markDeviceTrusted } from '$lib/local/persistenceLifecycle.svelte';
  import { loadStorageKey } from '$lib/local/crypto';
  import { credentialIdStorageKey } from '$lib/local/storageKeys';

  let { data } = $props();

  let pending = $state(false);
  let trustedDevice = $state(true);

  async function proceed(action: 'claim' | 'fresh') {
    pending = true;
    try {
      if (trustedDevice) markDeviceTrusted();

      const storageKey = await loadStorageKey();
      const credentialId = localStorage.getItem(credentialIdStorageKey(data.user!.id)) ?? undefined;
      const syncData = {
        user: data.user!,
        publicServerUrl: data.publicServerUrl,
        spaceId: data.activeSpaceId!,
        credentialId,
      };

      if (action === 'claim') {
        await syncState.enableWithClaim(syncData, storageKey ?? undefined);
      } else {
        await syncState.enableFresh(syncData, storageKey ?? undefined);
      }

      await goto('/', { invalidateAll: true });
    } catch (err) {
      console.error('Welcome action failed:', err);
      pending = false;
    }
  }
</script>

<svelte:head>
  <title>Welcome</title>
</svelte:head>

<div class="flex min-h-[60vh] items-center justify-center">
  <div class="card max-w-md space-y-8 p-8">
    <div class="text-center">
      <h1 class="text-2xl font-bold">Welcome</h1>
      <p class="mt-2 text-sm text-fg-muted">Your account is ready. What would you like to do with any existing local data?</p>
    </div>

    <div class="space-y-3">
      <button
        type="button"
        onclick={() => proceed('claim')}
        disabled={pending}
        class="btn-lg btn-secondary text-left"
      >
        <div class="font-medium">Keep my data</div>
        <div class="mt-1 text-sm text-fg-muted">Any notes or todos you created will be linked to your account.</div>
      </button>

      <button
        type="button"
        onclick={() => proceed('fresh')}
        disabled={pending}
        class="btn-lg btn-secondary text-left"
      >
        <div class="font-medium">Start fresh</div>
        <div class="mt-1 text-sm text-fg-muted">Begin with an empty account. Any local data will be cleared.</div>
      </button>
    </div>

    <div class="flex cursor-pointer items-center gap-3">
      <Checkbox.Root
        id="trusted-device"
        bind:checked={trustedDevice}
        class="size-4 rounded border border-stroke bg-surface
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
      <Label.Root for="trusted-device" class="text-sm text-fg-muted cursor-pointer">
        This is my personal device (keeps data encrypted between sessions)
      </Label.Root>
    </div>
  </div>
</div>
