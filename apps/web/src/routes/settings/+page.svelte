<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import {
    loadSpaceKey, wrapKey, deriveTokenWrappingKey,
    generateEcdhKeyPair, exportEcdhPublicKey, importEcdhPublicKey,
    deriveSharedKey, loadDeviceKey, deriveDeviceLinkPopToken, sha256Base64,
    deviceLinkVerificationCode,
  } from '$lib/local/crypto';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // — Device approvals —
  let approvedIds = $state(new Set<string>());
  let dismissedIds = $state(new Set<string>());
  let approving = $state<string | null>(null);
  let approveError = $state<string | null>(null);

  const pendingApprovals = $derived(
    data.pendingApprovals.filter(r => !approvedIds.has(r.id) && !dismissedIds.has(r.id))
  );

  async function approve(requestId: string, newDeviceEcdhPublicKey: string) {
    approving = requestId;
    approveError = null;
    try {
      const deviceKey = await loadDeviceKey();
      if (!deviceKey) throw new Error('Device key not available — please sign out and sign in again');

      const keyPair = await generateEcdhKeyPair();
      const peerPublicKey = await importEcdhPublicKey(newDeviceEcdhPublicKey);
      const sharedKey = await deriveSharedKey(keyPair.privateKey, peerPublicKey);
      const wrappedUserKey = await wrapKey(deviceKey, sharedKey);
      const primaryEcdhPublicKey = await exportEcdhPublicKey(keyPair.publicKey);
      // Commit to the proof-of-possession token derived from the same ECDH secret;
      // only the new device (which holds the matching ECDH private key) can produce
      // the preimage at register time.
      const popHash = await sha256Base64(await deriveDeviceLinkPopToken(keyPair.privateKey, peerPublicKey));

      const res = await fetch(`/auth/device-link/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryEcdhPublicKey, wrappedUserKey, popHash }),
      });
      if (!res.ok) throw new Error(await res.text());

      approvedIds = new Set([...approvedIds, requestId]);
    } catch (err) {
      approveError = err instanceof Error ? err.message : 'Approval failed';
    } finally {
      approving = null;
    }
  }

  function dismiss(requestId: string) {
    dismissedIds = new Set([...dismissedIds, requestId]);
  }

  // — API tokens —
  let createdToken = $state<string | null>(null);
  let createError = $state<string | null>(null);
  let creating = $state(false);

  async function handleCreate(e: SubmitEvent) {
    e.preventDefault();
    createError = null;
    createdToken = null;
    creating = true;

    try {
      const fd = new FormData(e.target as HTMLFormElement);
      const name = String(fd.get('name')).trim();
      const scope = String(fd.get('scope'));

      const spaceId = String(fd.get('spaceId'));
      const rawToken = crypto.randomUUID() + '-' + crypto.randomUUID();

      let wrappedSpaceKey: string | undefined;
      if (spaceId) {
        const spaceKey = await loadSpaceKey(spaceId);
        if (spaceKey) {
          const wk = await deriveTokenWrappingKey(rawToken);
          wrappedSpaceKey = await wrapKey(spaceKey, wk);
        }
      }

      // A write token needs the space's encryption key escrowed into it; without the
      // key loaded we can't, and the token would be rejected at write time.
      if (scope === 'readwrite' && !wrappedSpaceKey) {
        createError = 'Open this space first so its encryption key loads, then create a write token.';
        return;
      }

      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scope, rawToken, spaceId, wrappedSpaceKey }),
      });

      if (!res.ok) {
        createError = 'Failed to create token';
        return;
      }

      createdToken = rawToken;
      (e.target as HTMLFormElement).reset();
      await invalidateAll();
    } catch {
      createError = 'An error occurred creating the token';
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head>
  <title>Settings</title>
</svelte:head>

<main class="mx-auto max-w-2xl p-6">
  <h1 class="mb-6 text-2xl font-bold">Settings</h1>

  {#if pendingApprovals.length > 0}
    <section class="mb-8">
      <h2 class="mb-1 text-lg font-semibold">Pending device requests</h2>
      <p class="mb-3 text-sm text-muted">
        A new device is requesting access to your account. Only approve if you started this —
        and only if the code below matches the one shown on that device. If you didn't start it, Dismiss.
      </p>
      {#if approveError}
        <p class="mb-3 text-sm text-destructive">{approveError}</p>
      {/if}
      <ul class="space-y-2">
        {#each pendingApprovals as request (request.id)}
          <li class="flex items-center justify-between rounded border border-stroke px-4 py-3 text-sm">
            <div>
              <div>
                <span class="font-medium">New device</span>
                <span class="ml-2 text-muted">requested {request.created_at.slice(0, 10)}</span>
              </div>
              <div class="mt-1 text-muted">
                Code:
                {#await deviceLinkVerificationCode(request.ecdh_public_key) then code}
                  <span class="font-mono font-semibold tracking-widest text-fg">{code}</span>
                {/await}
              </div>
            </div>
            <div class="flex gap-2">
              <button
                type="button"
                disabled={approving === request.id}
                onclick={() => approve(request.id, request.ecdh_public_key)}
                class="btn-xs btn-primary"
              >
                {approving === request.id ? 'Approving…' : 'Approve'}
              </button>
              <button
                type="button"
                onclick={() => dismiss(request.id)}
                class="btn-xs btn-ghost"
              >
                Dismiss
              </button>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <h2 class="mb-6 text-lg font-semibold">API Tokens</h2>

  {#if createdToken}
    <div class="alert-success mb-6">
      <p class="mb-2 font-medium">Token created — copy it now, it won't be shown again.</p>
      <code class="block break-all bg-surface rounded p-2 text-sm select-all">{createdToken}</code>
    </div>
  {/if}

  {#if createError}
    <p class="text-destructive mb-4">{createError}</p>
  {/if}

  {#if form && 'error' in form && form.error}
    <p class="text-destructive mb-4">{form.error}</p>
  {/if}

  <section class="mb-8">
    <h2 class="mb-3 text-lg font-semibold">Create token</h2>
    <form onsubmit={handleCreate} class="flex gap-3 flex-wrap">
      <input
        name="name"
        placeholder="Token name (e.g. Claude Desktop)"
        required
        class="field flex-1"
      />
      <select name="spaceId" class="field w-auto">
        {#each data.spaces as space (space.id)}
          <option value={space.id}>{space.name}</option>
        {/each}
      </select>
      <select name="scope" class="field w-auto">
        <option value="read">Read only</option>
        <option value="readwrite">Read + Write</option>
      </select>
      <button type="submit" disabled={creating} class="btn-md btn-primary">
        {creating ? '…' : 'Create'}
      </button>
    </form>
  </section>

  <section>
    <h2 class="mb-3 text-lg font-semibold">Existing tokens</h2>
    {#if data.tokens.length === 0}
      <p class="text-sm text-muted">No tokens yet.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.tokens as token (token.token_hash)}
          {@const spaceName = data.spaces.find(s => s.id === token.space_id)?.name ?? null}
          <li class="flex items-center justify-between rounded border border-stroke px-4 py-3 text-sm">
            <div>
              <span class="font-medium">{token.name}</span>
              <span class="badge bg-surface-2 text-fg-muted ml-2">{token.scope}</span>
              {#if spaceName}
                <span class="badge bg-surface-2 text-fg-muted ml-2">{spaceName}</span>
              {/if}
              <span class="ml-2 text-fg-muted">created {token.created_at.slice(0, 10)}</span>
              {#if token.expires_at}
                <span class="ml-2 text-fg-muted">expires {token.expires_at.slice(0, 10)}</span>
              {/if}
            </div>
            <form method="POST" action="?/revoke" use:enhance>
              <input type="hidden" name="tokenHash" value={token.token_hash} />
              <button type="submit" class="btn-xs btn-danger">Revoke</button>
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>
