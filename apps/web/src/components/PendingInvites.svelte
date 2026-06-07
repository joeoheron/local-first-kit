<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import {
    importEcdhPublicKey,
    deriveInviteSharedKey,
    loadEncPrivKey,
    loadDeviceKey,
    wrapKey,
    unwrapKey,
    storeSpaceKey,
  } from '$lib/local/crypto';
  import { syncState } from '$lib/local/persistenceLifecycle.svelte';

  let {
    invites,
    user,
    publicServerUrl,
  }: {
    invites: Array<{ id: string; space_id: string; space_name: string; inviter_email: string }>;
    user: { id: string } | null;
    publicServerUrl: string;
  } = $props();

  let busy: Record<string, boolean> = $state({});
  let errors: Record<string, string> = $state({});

  async function accept(invite: typeof invites[number]) {
    if (!user) return;
    busy[invite.id] = true;
    try {
      const res = await fetch(`/api/invites/${invite.id}/accept`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const { spaceId, wrappedSpaceKey, inviterEcdhPub } =
        await res.json() as { spaceId: string; wrappedSpaceKey: string; inviterEcdhPub: string };

      const privKey = await loadEncPrivKey();
      if (!privKey) throw new Error('Encryption key not in session — please log in again');
      const inviterPub = await importEcdhPublicKey(inviterEcdhPub);
      const sharedKey = await deriveInviteSharedKey(privKey, inviterPub);
      const spaceKey = await unwrapKey(wrappedSpaceKey, sharedKey);
      await storeSpaceKey(spaceId, spaceKey);

      const deviceKey = await loadDeviceKey();
      if (deviceKey) {
        const wrappedForUser = await wrapKey(spaceKey, deviceKey);
        await fetch(`/api/keys/space/${spaceId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wrappedKey: wrappedForUser }),
        });
      }

      await syncState.switchSpace({ user, publicServerUrl, spaceId });
      await invalidateAll();
    } catch (e) {
      errors[invite.id] = String(e);
      busy[invite.id] = false;
    }
  }

  async function reject(inviteId: string) {
    busy[inviteId] = true;
    await fetch(`/api/invites/${inviteId}/reject`, { method: 'POST' });
    await invalidateAll();
  }
</script>

{#if invites.length > 0}
  <div class="alert-info mx-4 mt-3 space-y-2">
    <p class="text-xs text-info font-medium uppercase tracking-wide">Pending invites</p>
    {#each invites as invite (invite.id)}
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm text-fg-muted">
          <span class="text-muted">{invite.inviter_email}</span>
          {' '}invited you to{' '}
          <strong class="text-fg">{invite.space_name}</strong>
        </span>
        <div class="flex items-center gap-1 shrink-0">
          {#if errors[invite.id]}
            <span class="text-xs text-destructive">{errors[invite.id]}</span>
          {/if}
          <button
            disabled={busy[invite.id]}
            onclick={() => accept(invite)}
            class="btn-xs btn-primary"
          >
            Accept
          </button>
          <button
            disabled={busy[invite.id]}
            onclick={() => reject(invite.id)}
            class="btn-xs btn-ghost"
          >
            Reject
          </button>
        </div>
      </div>
    {/each}
  </div>
{/if}
