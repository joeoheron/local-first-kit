export const STORAGE_KEYS = {
  storageKey: '_stk',                      // sessionStorage: PRF-derived AES-256-GCM storage key (base64)
  deviceKey: '_dk',                        // sessionStorage: device key (base64), unwrapped from D1
  identityKey: '_ik',                      // sessionStorage: ECDSA P-256 private key (pkcs8, base64)
  encPrivKey: '_enc_priv',                 // sessionStorage: long-term ECDH P-256 private key for invite key exchange
  ecdhPrivateKey: '_ecdh_priv',            // sessionStorage: ephemeral ECDH private key for device-link ceremony
  trustedDevice: '_td',                    // sessionStorage: '1' if user chose to keep data on logout
  credentialId: 'passkey:credential-id',   // localStorage: last-used passkey credential ID
} as const;

/** Returns the sessionStorage key for a space's encryption key. */
export function spaceKeyStorageKey(spaceId: string): string {
  return `_sk:${spaceId}`;
}

/** Returns the localStorage key for a user's passkey credential ID. */
export function credentialIdStorageKey(userId: string): string {
  return `passkey:credential-id:${userId}`;
}
