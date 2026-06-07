/**
 * @oslojs/crypto random reader — adapter that uses Web Crypto getRandomValues
 * to satisfy the RandomReader interface from @oslojs/crypto/random.
 *
 * Cloudflare Workers and modern browsers both support crypto.getRandomValues.
 */
import type { RandomReader } from "@oslojs/crypto/random";

/** A RandomReader backed by Web Crypto's getRandomValues. */
export const webCryptoRandom: RandomReader = {
  read(bytes: Uint8Array): void {
    crypto.getRandomValues(bytes);
  },
};