/**
 * SvelteKit server hooks — auth middleware.
 *
 * On every request:
 * 1. Validate the JWT from the access_token cookie.
 * 2. If the JWT is expired, attempt a refresh using the refresh_token cookie.
 * 3. Attach user info to event.locals for downstream use.
 * 4. Block /dev/* routes in production.
 */
import { dev } from "$app/environment";
import { error, type Handle } from "@sveltejs/kit";
import {
  validateAccessToken,
  refreshSession,
  hashRefreshToken,
  isRefreshTokenExpired,
} from "@local-first-kit/auth";
import {
  getAccessToken,
  getRefreshToken,
  setSessionCookies,
  clearSessionCookies,
} from "$lib/server/session.js";
import { findRefreshToken, rotateRefreshToken, deleteRefreshToken } from "$lib/server/users.js";
import { buildJwtConfig, SESSION_JWT_EXPIRY } from "$lib/server/config.js";

export const handle: Handle = async ({ event, resolve }) => {
  // Block /dev/* routes in production
  if (!dev && event.url.pathname.startsWith("/dev/")) {
    throw error(404, "Not found");
  }

  // Initialize user as null (unauthenticated)
  event.locals.user = null;

  // Skip auth for auth callback and logout routes (they handle their own logic)
  const authRoutes = ["/auth/callback"];
  const isAuthRoute = authRoutes.some((route) =>
    event.url.pathname.startsWith(route),
  );

  if (!isAuthRoute && event.platform?.env) {
    const secret = event.platform.env.JWT_SECRET as string | undefined;
    const jwtConfig = secret ? buildJwtConfig(secret, SESSION_JWT_EXPIRY) : null;

    if (jwtConfig) {
      const accessToken = getAccessToken(event.cookies);

      if (accessToken) {
        // Try to validate the access token
        const verified = validateAccessToken(jwtConfig, accessToken);

        if (verified) {
          // Token is valid — attach user info to locals
          event.locals.user = {
            id: verified.userId,
          };
        } else {
          // Access token expired or invalid — try refresh
          const refreshToken = getRefreshToken(event.cookies);

          if (refreshToken && event.platform.env.DB) {
            const d1 = event.platform.env.DB as D1Database;
            const tokenHash = hashRefreshToken(refreshToken);

            // Look up refresh token in D1
            const record = await findRefreshToken(d1, tokenHash);

            if (record) {
              const isExpired = isRefreshTokenExpired({
                tokenHash: record.token_hash,
                userId: record.user_id,
                issuedAt: record.issued_at,
                expiresAt: record.expires_at,
              });

              if (!isExpired) {
                // Token rotation: issue new access + refresh tokens
                const newSession = refreshSession(jwtConfig, record.user_id);

                // Rotate: delete old token, insert new one
                await rotateRefreshToken(
                  d1,
                  record.token_hash,
                  newSession.refreshTokenHash,
                  record.user_id,
                  new Date().toISOString(),
                  newSession.refreshTokenExpiresAt.toISOString(),
                );

                // Set new session cookies
                setSessionCookies(
                  event.cookies,
                  newSession.accessToken,
                  newSession.refreshToken,
                );

                // Attach user info from the refreshed session
                event.locals.user = {
                  id: record.user_id,
                };
              } else {
                // Refresh token expired — delete it and clear cookies
                await deleteRefreshToken(d1, record.token_hash);
                clearSessionCookies(event.cookies);
              }
            } else {
              // No matching refresh token found — clear stale cookies
              clearSessionCookies(event.cookies);
            }
          }
        }
      }
    }
  }

  const response = await resolve(event);
  // Prevent Cloudflare edge caching for auth routes
  if (event.url.pathname.startsWith('/auth/')) {
    response.headers.set('Cache-Control', 'no-store, no-cache');
  }
  return response;
};

export const handleError = ({ error, event }: { error: unknown; event: import('@sveltejs/kit').RequestEvent }) => {
  console.error('[handleError]', event.url.pathname, error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : '');
  return { message: 'Internal error' };
};