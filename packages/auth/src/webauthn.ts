/**
 * Server-side WebAuthn verification using @oslojs/webauthn primitives.
 *
 * Handles both registration (passkey creation) and authentication (passkey use).
 * Signature verification uses Web Crypto (available in Cloudflare Workers + browsers).
 *
 * Only ES256 (P-256 ECDSA) is supported — the algorithm used by virtually all
 * modern passkey authenticators (Touch ID, Face ID, Android, hardware keys).
 */
import {
  parseClientDataJSON,
  parseAuthenticatorData,
  parseAttestationObject,
  createAssertionSignatureMessage,
  ClientDataType,
  coseAlgorithmES256,
} from '@oslojs/webauthn';
import { decodeBase64urlIgnorePadding, encodeBase64urlNoPadding } from '@oslojs/encoding';

/** Standard WebAuthn JSON types (WebAuthn L3 spec). */
export interface AuthenticatorAttestationResponseJSON {
  clientDataJSON: string;       // base64url
  attestationObject: string;   // base64url
  transports?: string[];
}

export interface RegistrationResponseJSON {
  id: string;                  // base64url credential ID
  rawId: string;               // base64url
  response: AuthenticatorAttestationResponseJSON;
  type: 'public-key';
}

export interface AuthenticatorAssertionResponseJSON {
  clientDataJSON: string;      // base64url
  authenticatorData: string;   // base64url
  signature: string;           // base64url
  userHandle?: string;
}

export interface AuthenticationResponseJSON {
  id: string;                  // base64url credential ID
  rawId: string;               // base64url
  response: AuthenticatorAssertionResponseJSON;
  type: 'public-key';
}

export interface VerifiedRegistration {
  credentialId: string;        // base64url
  publicKey: Uint8Array;       // raw COSE-encoded public key bytes (store in D1)
  algorithm: number;           // -7 for ES256
  transports: string[];
  counter: number;
}

export interface VerifiedAuthentication {
  credentialId: string;
  newCounter: number;
}

/** Generate a base64url-encoded challenge (32 random bytes). */
export function generateWebAuthnChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64urlNoPadding(bytes);
}

/**
 * Verify a passkey registration response.
 *
 * Returns verified credential data on success, null on any failure.
 * Uses "none" attestation format (no attestation verification) — appropriate for
 * consumer passkeys where we trust the authenticator.
 */
export async function verifyPasskeyRegistration(
  expectedOrigin: string,
  expectedRpId: string,
  expectedChallenge: string,
  response: RegistrationResponseJSON,
): Promise<VerifiedRegistration | null> {
  try {
    const clientDataBytes = decodeBase64urlIgnorePadding(response.response.clientDataJSON);
    const attestationBytes = decodeBase64urlIgnorePadding(response.response.attestationObject);

    const clientData = parseClientDataJSON(clientDataBytes);
    if (clientData.type !== ClientDataType.Create) {
      console.error('[webauthn] registration: wrong clientData type', clientData.type);
      return null;
    }
    if (clientData.origin !== expectedOrigin) {
      console.error('[webauthn] registration: origin mismatch — got', clientData.origin, 'expected', expectedOrigin);
      return null;
    }

    const challengeBytes = decodeBase64urlIgnorePadding(expectedChallenge);
    if (!bytesEqual(clientData.challenge, challengeBytes)) {
      console.error('[webauthn] registration: challenge mismatch');
      return null;
    }

    const attestation = parseAttestationObject(attestationBytes);
    const authData = attestation.authenticatorData;

    if (!authData.verifyRelyingPartyIdHash(expectedRpId)) {
      console.error('[webauthn] registration: rpId hash mismatch for rpId', expectedRpId);
      return null;
    }
    if (!authData.userPresent) {
      console.error('[webauthn] registration: user-present flag not set');
      return null;
    }

    const credential = authData.credential;
    if (!credential) {
      console.error('[webauthn] registration: no credential in authenticatorData');
      return null;
    }

    const algorithm = credential.publicKey.algorithm();
    if (algorithm !== coseAlgorithmES256) {
      console.error('[webauthn] registration: unsupported algorithm', algorithm, '(only ES256/-7 accepted)');
      return null;
    }

    // Extract x, y from the COSE EC2 key and store as an uncompressed EC point
    // (65 bytes: 0x04 || x || y). Simpler and avoids CBOR/JSON round-trip issues.
    const ec2 = credential.publicKey.ec2();
    const publicKeyBytes = new Uint8Array(65);
    publicKeyBytes[0] = 0x04;
    publicKeyBytes.set(bigintToBytes(ec2.x, 32), 1);
    publicKeyBytes.set(bigintToBytes(ec2.y, 32), 33);

    return {
      credentialId: encodeBase64urlNoPadding(credential.id),
      publicKey: publicKeyBytes,
      algorithm,
      transports: response.response.transports ?? [],
      counter: authData.signatureCounter,
    };
  } catch (err) {
    console.error('[webauthn] registration: unexpected error', err);
    return null;
  }
}

/**
 * Verify a passkey authentication response.
 *
 * Returns the updated counter on success, null on failure.
 * Callers must update the stored counter after successful verification (replay protection).
 */
export async function verifyPasskeyAuthentication(
  expectedOrigin: string,
  expectedRpId: string,
  expectedChallenge: string,
  storedPublicKey: Uint8Array | ArrayBuffer,
  storedAlgorithm: number,
  storedCounter: number,
  response: AuthenticationResponseJSON,
): Promise<VerifiedAuthentication | null> {
  try {
    if (storedAlgorithm !== coseAlgorithmES256) {
      console.error('[webauthn] authentication: unsupported stored algorithm', storedAlgorithm);
      return null;
    }

    const clientDataBytes = decodeBase64urlIgnorePadding(response.response.clientDataJSON);
    const authDataBytes = decodeBase64urlIgnorePadding(response.response.authenticatorData);
    const signatureBytes = decodeBase64urlIgnorePadding(response.response.signature);

    const clientData = parseClientDataJSON(clientDataBytes);
    if (clientData.type !== ClientDataType.Get) {
      console.error('[webauthn] authentication: wrong clientData type', clientData.type);
      return null;
    }
    if (clientData.origin !== expectedOrigin) {
      console.error('[webauthn] authentication: origin mismatch — got', clientData.origin, 'expected', expectedOrigin);
      return null;
    }

    const challengeBytes = decodeBase64urlIgnorePadding(expectedChallenge);
    if (!bytesEqual(clientData.challenge, challengeBytes)) {
      console.error('[webauthn] authentication: challenge mismatch');
      return null;
    }

    const authData = parseAuthenticatorData(authDataBytes);
    if (!authData.verifyRelyingPartyIdHash(expectedRpId)) {
      console.error('[webauthn] authentication: rpId hash mismatch for rpId', expectedRpId);
      return null;
    }
    if (!authData.userPresent) {
      console.error('[webauthn] authentication: user-present flag not set');
      return null;
    }

    // Replay protection: counter must be 0 (no counter) or strictly greater
    if (storedCounter > 0 && authData.signatureCounter <= storedCounter) {
      console.error('[webauthn] authentication: counter replay detected — stored', storedCounter, 'got', authData.signatureCounter);
      return null;
    }

    // Verify ECDSA signature
    const signatureMessage = createAssertionSignatureMessage(authDataBytes, clientDataBytes);
    const cryptoKey = await importEC2PublicKey(storedPublicKey);
    if (!cryptoKey) {
      console.error('[webauthn] authentication: failed to import stored public key');
      return null;
    }

    const rawSignature = derToRawECDSA(signatureBytes);
    if (!rawSignature) {
      console.error('[webauthn] authentication: failed to parse DER signature');
      return null;
    }

    // ECDSA verify hashes the message internally — pass the raw message, not a pre-hash.
    // Wrap in new Uint8Array() to ensure buffer is ArrayBuffer (not ArrayBufferLike from oslojs).
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      new Uint8Array(rawSignature),
      new Uint8Array(signatureMessage),
    );
    if (!valid) {
      console.error('[webauthn] authentication: ECDSA signature verification failed');
      return null;
    }

    return {
      credentialId: response.id,
      newCounter: authData.signatureCounter,
    };
  } catch (err) {
    console.error('[webauthn] authentication: unexpected error', err);
    return null;
  }
}

// ---- Internal helpers ----

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Import a stored uncompressed EC public key (65 bytes: 0x04 || x || y) as a Web Crypto CryptoKey. */
async function importEC2PublicKey(stored: Uint8Array | ArrayBuffer): Promise<CryptoKey | null> {
  try {
    // D1 returns BLOBs as ArrayBuffer; wrap Uint8Array to ensure buffer: ArrayBuffer.
    const key: ArrayBuffer | Uint8Array<ArrayBuffer> = stored instanceof ArrayBuffer ? stored : new Uint8Array(stored);
    return await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  } catch {
    return null;
  }
}

function bigintToBytes(n: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let tmp = n;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  return bytes;
}

/**
 * Convert DER-encoded ECDSA signature to raw format (r || s, 32 bytes each).
 * Web Crypto's ECDSA verify expects raw format; WebAuthn authenticators produce DER.
 */
function derToRawECDSA(der: Uint8Array): Uint8Array | null {
  try {
    // DER SEQUENCE: 0x30 <len> 0x02 <rLen> <r> 0x02 <sLen> <s>
    if (der[0] !== 0x30) return null;
    let offset = 2; // skip 0x30 + length byte
    if (der[1] === 0x81) offset = 3; // long form length

    if (der[offset] !== 0x02) return null;
    const rLen = der[offset + 1] ?? 0;
    let rStart = offset + 2;
    // DER pads with 0x00 if high bit set
    if (der[rStart] === 0x00) { rStart++; }
    const r = der.slice(rStart, offset + 2 + rLen);

    const sOffset = offset + 2 + rLen;
    if (der[sOffset] !== 0x02) return null;
    const sLen = der[sOffset + 1] ?? 0;
    let sStart = sOffset + 2;
    if (der[sStart] === 0x00) { sStart++; }
    const s = der.slice(sStart, sOffset + 2 + sLen);

    const raw = new Uint8Array(64);
    raw.set(r.slice(-32), 32 - Math.min(r.length, 32));
    raw.set(s.slice(-32), 64 - Math.min(s.length, 32));
    return raw;
  } catch {
    return null;
  }
}
