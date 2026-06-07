<script lang="ts">
  import { Popover } from 'bits-ui';
  import {
    generateEcdhKeyPair,
    exportEcdhPublicKey,
    importEcdhPublicKey,
    deriveInviteSharedKey,
    loadSpaceKey,
    wrapKey,
  } from '$lib/local/crypto';

  let { spaceId }: { spaceId: string } = $props();

  let inviteEmail = $state('');
  let inviteStatus = $state<'idle' | 'sending' | 'sent' | 'error'>('idle');
  let inviteError = $state('');

  function resetInvite() {
    inviteEmail = '';
    inviteStatus = 'idle';
    inviteError = '';
  }

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    inviteStatus = 'sending';
    try {
      const lookupRes = await fetch(`/api/users/lookup?email=${encodeURIComponent(email)}`);
      if (!lookupRes.ok) {
        const err = await lookupRes.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? 'User not found');
      }
      const { id: inviteeUserId, ecdhPublicKey } = await lookupRes.json() as { id: string; ecdhPublicKey: string };

      const spaceKey = await loadSpaceKey(spaceId);
      if (!spaceKey) throw new Error('Space key not in session — please refresh and try again');

      const kp = await generateEcdhKeyPair();
      const inviterEcdhPub = await exportEcdhPublicKey(kp.publicKey);
      const inviteePub = await importEcdhPublicKey(ecdhPublicKey);
      const sharedKey = await deriveInviteSharedKey(kp.privateKey, inviteePub);
      const wrappedSpaceKey = await wrapKey(spaceKey, sharedKey);

      const res = await fetch(`/api/spaces/${spaceId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteeUserId, wrappedSpaceKey, inviterEcdhPub }),
      });
      if (!res.ok) throw new Error('Failed to create invite');
      inviteStatus = 'sent';
      inviteEmail = '';
    } catch (e) {
      inviteStatus = 'error';
      inviteError = String(e);
    }
  }
</script>

<Popover.Root onOpenChange={(open) => { if (open) resetInvite(); }}>
  <Popover.Trigger class="btn-xs btn-ghost" aria-label="Invite someone">
    <svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <circle cx="6" cy="5" r="2.5"/>
      <path d="M1 14c0-2.5 2.2-4 5-4s5 1.5 5 4"/>
      <path d="M13 6v5M10.5 8.5h5"/>
    </svg>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content side="bottom" sideOffset={6} class="panel rounded-md shadow-md z-50 w-72">
      {#if inviteStatus === 'sent'}
        <p class="text-sm text-success">Invite sent!</p>
        <Popover.Close class="mt-1 btn-xs btn-link">Close</Popover.Close>
      {:else}
        <form onsubmit={(e) => { e.preventDefault(); sendInvite(); }} class="flex items-center gap-2">
          <input
            type="email"
            bind:value={inviteEmail}
            placeholder="Invite by email"
            disabled={inviteStatus === 'sending'}
            class="field flex-1"
            autofocus
          />
          <button
            type="submit"
            disabled={inviteStatus === 'sending' || !inviteEmail.trim()}
            class="btn-xs btn-primary"
          >
            {inviteStatus === 'sending' ? '…' : 'Send invite'}
          </button>
        </form>
        {#if inviteStatus === 'error'}
          <p class="mt-1 text-xs text-destructive">{inviteError}</p>
        {/if}
        <Popover.Close class="mt-2 btn-xs btn-link">Cancel</Popover.Close>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
