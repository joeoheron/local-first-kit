import type { JwtConfig } from '@local-first-kit/auth';
import { JWT_ISSUER } from '@local-first-kit/config';

export const APP_ISSUER = JWT_ISSUER;
export const SESSION_JWT_EXPIRY = 15 * 60; // 15 min — session tokens
export const SYNC_JWT_EXPIRY = 60;         // 60 sec — sync service access tokens

export function buildJwtConfig(secret: string, expiresInSeconds = SESSION_JWT_EXPIRY): JwtConfig {
  return {
    secret: new TextEncoder().encode(secret),
    issuer: APP_ISSUER,
    expiresInSeconds,
  };
}
