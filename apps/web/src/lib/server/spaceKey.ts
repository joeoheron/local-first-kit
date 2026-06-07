import { unwrapKey, deriveTokenWrappingKey } from '$lib/local/crypto';
import { createDomainCrypto, ENCRYPTED_FIELDS_BY_TABLE } from '@local-first-kit/domain';

/**
 * Thrown when a table has encrypted fields but no space key is available to
 * encrypt them. Callers translate this into their own transport error shape
 * (SvelteKit `error()` for REST, `mcpError()` for MCP) rather than ever storing
 * plaintext into an encrypted field.
 */
export class MissingSpaceKeyError extends Error {
  constructor(public readonly table: string) {
    super(`Cannot write encrypted field(s) for table "${table}": no space key available.`);
    this.name = 'MissingSpaceKeyError';
  }
}

/**
 * Unwrap the per-space key escrowed under a key derived from the raw bearer token.
 * Returns null when there is no wrapped key (tokens created without key escrow) or
 * when unwrap fails — matching MCP's prior swallow-and-continue read behaviour.
 */
export async function resolveSpaceKey(
  rawToken: string | null,
  wrappedSpaceKey: string | null,
): Promise<CryptoKey | null> {
  if (!rawToken || !wrappedSpaceKey) return null;
  try {
    const wk = await deriveTokenWrappingKey(rawToken);
    return await unwrapKey(wrappedSpaceKey, wk);
  } catch {
    return null;
  }
}

/**
 * Encrypt the `ENCRYPTED_FIELDS_BY_TABLE[table]` string fields of `fields` with the
 * space key; non-encrypted fields pass through unchanged.
 *
 * Fail closed: if the table declares encrypted fields but `spaceKey` is null, throws
 * `MissingSpaceKeyError` rather than silently storing plaintext. No-op (returns the
 * input unchanged) for tables with no encrypted fields.
 */
export async function encryptRowForTable<T extends Record<string, unknown>>(
  table: string,
  fields: T,
  spaceKey: CryptoKey | null,
): Promise<T> {
  const encFields = ENCRYPTED_FIELDS_BY_TABLE[table] ?? [];
  if (encFields.length === 0) return fields;
  if (!spaceKey) throw new MissingSpaceKeyError(table);

  const dc = createDomainCrypto(spaceKey);
  const out: Record<string, unknown> = { ...fields };
  for (const field of encFields) {
    const value = out[field];
    if (typeof value === 'string') {
      out[field] = await dc.encrypt(table, field, value);
    }
  }
  return out as T;
}
