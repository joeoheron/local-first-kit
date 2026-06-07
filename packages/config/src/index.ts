// THE ONE VALUE TO CHANGE when adopting this template.
// Use a short, lowercase, hyphenated identifier for your app.
export const APP_ID = 'local-first-kit';

// ── FROZEN AFTER FIRST DEPLOYMENT ─────────────────────────────────────────────
// Derived from APP_ID. Once any user has registered or stored data, these must
// not change — doing so causes data loss or auth failures.
// The :v1 suffix is intentional: if a forced migration ever becomes necessary,
// bump to :v2 rather than changing the base string. Do not remove it.

export const PRF_SALT_STRING = `${APP_ID}:storage-key:v1`;
export const STORAGE_PREFIX = `${APP_ID}:app-store:v1`;
export const OPFS_FILE_PREFIX = `${APP_ID}-app-store-v1`;
export const TOKEN_WRAP_SALT = `${APP_ID}:api-token-space-key:v1`;

// ── SAFE TO CHANGE ─────────────────────────────────────────────────────────────
// These can be updated without breaking user data.

// JWT issuer claim — changing this logs all users out but does not lose data.
export const JWT_ISSUER = APP_ID;

// Human-readable name shown in passkey registration dialogs and MCP serverInfo.
export const APP_DISPLAY_NAME = APP_ID;
