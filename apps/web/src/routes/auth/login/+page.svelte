<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    PRF_SALT, deriveStorageKey, storeStorageKey,
    generateEcdhKeyPair, exportEcdhPublicKey, importEcdhPublicKey,
    deriveSharedKey, wrapKey, unwrapKey,
    storeEcdhPrivateKey, loadEcdhPrivateKey, clearEcdhPrivateKey,
    storeDeviceKey, deriveDeviceLinkPopToken, deviceLinkVerificationCode,
  } from '$lib/local/crypto';
  import { credentialIdStorageKey } from '$lib/local/storageKeys';
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const registrationUserId = crypto.getRandomValues(new Uint8Array(16));

  type Status = 'idle' | 'checking' | 'sign-in' | 'sign-up' | 'pending' | 'error' | 'link-pending' | 'link-registering';

  let email = $state('');
  let status = $state<Status>('idle');
  let errorMessage = $state<string | null>(null);
  let debounceTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  let linkRequestId = $state<string | null>(null);
  let linkUserKey = $state<CryptoKey | null>(null);
  let linkPopToken = $state<string | null>(null);
  let linkVerificationCode = $state<string | null>(null);
  let pollTimer = $state<ReturnType<typeof setTimeout> | null>(null);

  function onEmailInput() {
    errorMessage = null;
    if (debounceTimer) clearTimeout(debounceTimer);

    if (!EMAIL_REGEX.test(email)) {
      status = 'idle';
      return;
    }

    status = 'checking';
    debounceTimer = setTimeout(checkEmail, 300);
  }

  async function checkEmail() {
    try {
      const res = await fetch(`/auth/check-email?email=${encodeURIComponent(email.trim())}`);
      if (!res.ok) { status = 'idle'; return; }
      const { exists } = await res.json() as { exists: boolean };
      status = exists ? 'sign-in' : 'sign-up';
    } catch {
      status = 'idle';
    }
  }

  function saveCredentialId(id: string, userId: string): void {
    try { localStorage.setItem(credentialIdStorageKey(userId), id); } catch { /* best-effort */ }
  }

  async function signIn() {
    status = 'pending';
    errorMessage = null;
    try {
      const beginRes = await fetch('/auth/passkey/authenticate/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!beginRes.ok) throw new Error('Failed to begin authentication');
      const { challengeId, challenge, rpId, allowCredentials } = await beginRes.json() as {
        challengeId: string;
        challenge: string;
        rpId: string;
        allowCredentials: { type: 'public-key'; id: string; transports?: string[] }[];
      };

      const resolvedCredentials: PublicKeyCredentialDescriptor[] = allowCredentials.map((c) => ({
        type: 'public-key',
        id: new Uint8Array(base64urlToBytes(c.id)),
        transports: c.transports as AuthenticatorTransport[] | undefined,
      }));

      let credential: PublicKeyCredential;
      try {
        credential = await navigator.credentials.get({
          publicKey: {
            challenge: new Uint8Array(base64urlToBytes(challenge)),
            rpId,
            userVerification: 'preferred',
            allowCredentials: resolvedCredentials,
            extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
          },
        }) as PublicKeyCredential;
      } catch (err) {
        if ((err as Error).name === 'NotAllowedError') throw new Error('Sign-in cancelled');
        throw err;
      }

      const assertion = credential.response as AuthenticatorAssertionResponse;
      const prfResult = (credential.getClientExtensionResults() as Record<string, unknown>)
        ?.prf as { results?: { first?: ArrayBuffer } } | undefined;

      const completeRes = await fetch('/auth/passkey/authenticate/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          response: {
            id: credential.id,
            rawId: bytesToBase64url(new Uint8Array(credential.rawId)),
            type: 'public-key',
            response: {
              clientDataJSON: bytesToBase64url(new Uint8Array(assertion.clientDataJSON)),
              authenticatorData: bytesToBase64url(new Uint8Array(assertion.authenticatorData)),
              signature: bytesToBase64url(new Uint8Array(assertion.signature)),
              userHandle: assertion.userHandle ? bytesToBase64url(new Uint8Array(assertion.userHandle)) : undefined,
            },
          },
        }),
      });

      if (!completeRes.ok) throw new Error(`Authentication failed: ${await completeRes.text()}`);
      const { userId: signedInUserId } = await completeRes.json() as { isNewAccount: boolean; userId: string };

      saveCredentialId(credential.id, signedInUserId);

      if (prfResult?.results?.first) {
        const key = await deriveStorageKey(prfResult.results.first, credential.id);
        await storeStorageKey(key);
      }

      await goto('/', { invalidateAll: true });
    } catch (err) {
      status = 'sign-in';
      errorMessage = err instanceof Error ? err.message : 'Sign-in failed';
    }
  }

  async function register() {
    status = 'pending';
    errorMessage = null;
    try {
      const beginRes = await fetch('/auth/passkey/register/begin', { method: 'POST' });
      if (!beginRes.ok) throw new Error('Failed to begin registration');
      const { challengeId, challenge, rpId, rpName } = await beginRes.json() as {
        challengeId: string; challenge: string; rpId: string; rpName: string;
      };

      let credential: PublicKeyCredential;
      try {
        credential = await navigator.credentials.create({
          publicKey: {
            challenge: new Uint8Array(base64urlToBytes(challenge)),
            rp: { id: rpId, name: rpName },
            user: { id: registrationUserId, name: email.trim().toLowerCase(), displayName: email.trim() },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
            extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
          },
        }) as PublicKeyCredential;
      } catch (err) {
        if ((err as Error).name === 'NotAllowedError') throw new Error('Registration cancelled');
        throw err;
      }

      const attestation = credential.response as AuthenticatorAttestationResponse;
      const prfResult = (credential.getClientExtensionResults() as Record<string, unknown>)
        ?.prf as { results?: { first?: ArrayBuffer } } | undefined;

      const completeRes = await fetch('/auth/passkey/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          email: email.trim().toLowerCase(),
          response: {
            id: credential.id,
            rawId: bytesToBase64url(new Uint8Array(credential.rawId)),
            type: 'public-key',
            response: {
              clientDataJSON: bytesToBase64url(new Uint8Array(attestation.clientDataJSON)),
              attestationObject: bytesToBase64url(new Uint8Array(attestation.attestationObject)),
              transports: attestation.getTransports?.() ?? [],
            },
          },
        }),
      });

      if (!completeRes.ok) throw new Error(`Registration failed: ${await completeRes.text()}`);
      const { userId: registeredUserId } = await completeRes.json() as { isNewAccount: boolean; userId: string };

      saveCredentialId(credential.id, registeredUserId);

      if (prfResult?.results?.first) {
        const key = await deriveStorageKey(prfResult.results.first, credential.id);
        await storeStorageKey(key);
      }

      await goto('/auth/welcome', { invalidateAll: true });
    } catch (err) {
      status = 'sign-up';
      errorMessage = err instanceof Error ? err.message : 'Registration failed';
    }
  }

  async function startDeviceLink() {
    errorMessage = null;
    try {
      const keyPair = await generateEcdhKeyPair();
      await storeEcdhPrivateKey(keyPair.privateKey);
      const ecdhPublicKey = await exportEcdhPublicKey(keyPair.publicKey);
      linkVerificationCode = await deviceLinkVerificationCode(ecdhPublicKey);

      const res = await fetch('/auth/device-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), ecdhPublicKey }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { requestId } = await res.json() as { requestId: string };

      linkRequestId = requestId;
      status = 'link-pending';
      schedulePoll();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to start device link';
    }
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(pollLinkStatus, 3000);
  }

  async function pollLinkStatus() {
    if (!linkRequestId || status !== 'link-pending') return;
    try {
      const res = await fetch(`/auth/device-link/${linkRequestId}`);
      if (!res.ok) { cancelDeviceLink(); return; }
      const data = await res.json() as { status: string; primaryEcdhPublicKey?: string; wrappedUserKey?: string };

      if (data.status === 'approved' && data.primaryEcdhPublicKey && data.wrappedUserKey) {
        const privateKey = await loadEcdhPrivateKey();
        if (!privateKey) throw new Error('ECDH private key missing');
        const peerPublicKey = await importEcdhPublicKey(data.primaryEcdhPublicKey);
        const sharedKey = await deriveSharedKey(privateKey, peerPublicKey);
        const userKey = await unwrapKey(data.wrappedUserKey, sharedKey);
        // Proof of possession: derive the PoP token from the same ECDH secret before
        // discarding the private key; the server verifies it against the hash the
        // approving device committed, proving we hold the bound ECDH key.
        linkPopToken = await deriveDeviceLinkPopToken(privateKey, peerPublicKey);
        clearEcdhPrivateKey();
        linkUserKey = userKey;
        status = 'link-registering';
        await linkRegister();
      } else {
        schedulePoll();
      }
    } catch {
      schedulePoll();
    }
  }

  function cancelDeviceLink() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    clearEcdhPrivateKey();
    linkRequestId = null;
    linkUserKey = null;
    linkPopToken = null;
    linkVerificationCode = null;
    status = 'sign-in';
  }

  async function linkRegister() {
    if (!linkRequestId || !linkUserKey || !linkPopToken) return;
    const requestId = linkRequestId;
    const userKey = linkUserKey;
    const popToken = linkPopToken;
    errorMessage = null;
    try {
      const beginRes = await fetch('/auth/passkey/register/begin', { method: 'POST' });
      if (!beginRes.ok) throw new Error('Failed to begin registration');
      const { challengeId, challenge, rpId, rpName } = await beginRes.json() as {
        challengeId: string; challenge: string; rpId: string; rpName: string;
      };

      let credential: PublicKeyCredential;
      try {
        credential = await navigator.credentials.create({
          publicKey: {
            challenge: new Uint8Array(base64urlToBytes(challenge)),
            rp: { id: rpId, name: rpName },
            user: { id: registrationUserId, name: email.trim().toLowerCase(), displayName: email.trim() },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
            extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
          },
        }) as PublicKeyCredential;
      } catch (err) {
        if ((err as Error).name === 'NotAllowedError') throw new Error('Registration cancelled');
        throw err;
      }

      const attestation = credential.response as AuthenticatorAttestationResponse;
      const prfResult = (credential.getClientExtensionResults() as Record<string, unknown>)
        ?.prf as { results?: { first?: ArrayBuffer } } | undefined;

      const completeRes = await fetch(`/auth/device-link/${requestId}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          popToken,
          response: {
            id: credential.id,
            rawId: bytesToBase64url(new Uint8Array(credential.rawId)),
            type: 'public-key',
            response: {
              clientDataJSON: bytesToBase64url(new Uint8Array(attestation.clientDataJSON)),
              attestationObject: bytesToBase64url(new Uint8Array(attestation.attestationObject)),
              transports: attestation.getTransports?.() ?? [],
            },
          },
        }),
      });
      if (!completeRes.ok) throw new Error(`Registration failed: ${await completeRes.text()}`);
      const { userId: linkedUserId } = await completeRes.json() as { isNewAccount: boolean; userId: string };

      saveCredentialId(credential.id, linkedUserId);

      // Always cache in sessionStorage so decryption works this session
      // even when the authenticator doesn't support PRF.
      await storeDeviceKey(userKey);

      if (prfResult?.results?.first) {
        const prfKey = await deriveStorageKey(prfResult.results.first, credential.id);
        await storeStorageKey(prfKey);
        const wrappedUserKey = await wrapKey(userKey, prfKey);
        await fetch('/api/keys/device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentialId: credential.id, wrappedKey: wrappedUserKey }),
        });
      }

      await goto('/', { invalidateAll: true });
    } catch (err) {
      status = 'link-pending';
      errorMessage = err instanceof Error ? err.message : 'Registration failed';
      schedulePoll();
    }
  }

  function base64urlToBytes(str: string): Uint8Array {
    const padded = str + '='.repeat((4 - str.length % 4) % 4);
    return Uint8Array.from(atob(padded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  }

  function bytesToBase64url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
</script>

<svelte:head>
  <title>Sign in</title>
</svelte:head>

<div class="flex min-h-[50vh] items-center justify-center">
  <div class="card-auth">
    <div class="text-center">
      <h1 class="text-2xl font-bold">Sign in</h1>
      <p class="mt-2 text-sm text-fg-muted">Enter your email to continue</p>
    </div>

    {#if errorMessage}
      <div class="alert-error">
        {errorMessage}
      </div>
    {/if}

    <div class="space-y-4">
      <div class="space-y-1">
        <label for="email" class="block text-sm font-medium text-fg-muted">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          oninput={onEmailInput}
          placeholder="you@example.com"
          disabled={status === 'pending' || status === 'link-pending' || status === 'link-registering'}
          class="field-lg"
        />
      </div>

      {#if status === 'checking'}
        <p class="text-center text-xs text-muted">Checking…</p>
      {:else if status === 'sign-in'}
        <button
          type="button"
          onclick={signIn}
          class="btn-lg btn-secondary gap-3"
        >
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M15 7a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"/>
            <path d="M11 11H3m4-4v8m8-4h5"/>
          </svg>
          Sign in with passkey
        </button>
        <p class="text-center text-xs text-muted">
          <button type="button" onclick={startDeviceLink} class="btn-link text-xs">
            Signing in from a new device?
          </button>
        </p>
      {:else if status === 'sign-up'}
        <button
          type="button"
          onclick={register}
          class="btn-lg btn-ghost border border-stroke gap-3"
        >
          Create account
        </button>
      {:else if status === 'link-pending'}
        <div class="space-y-3 text-center">
          <p class="text-sm text-fg-muted">Waiting for approval on your primary device…</p>
          {#if linkVerificationCode}
            <div class="rounded border border-stroke bg-surface p-3">
              <p class="text-xs text-muted">Verification code</p>
              <p class="text-2xl font-mono font-semibold tracking-widest select-all">{linkVerificationCode}</p>
              <p class="mt-1 text-xs text-muted">Confirm this matches the code shown in the approval prompt on your other device.</p>
            </div>
          {/if}
          <button
            type="button"
            onclick={cancelDeviceLink}
            class="btn-link text-xs"
          >
            Cancel
          </button>
        </div>
      {:else if status === 'link-registering'}
        <p class="text-center text-sm text-fg-muted">Approved — setting up your passkey…</p>
      {/if}
    </div>

    <p class="text-center text-xs text-muted">
      Your data stays on your device.<br/>
      A passkey replaces passwords — nothing to remember.
    </p>
  </div>
</div>
