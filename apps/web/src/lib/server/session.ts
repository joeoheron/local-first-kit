/**
 * Cookie management for session tokens.
 *
 * Pattern B auth:
 * - Access token (JWT) stored in an HttpOnly cookie — short-lived (15 min).
 * - Refresh token stored in a separate HttpOnly cookie — longer-lived (30 days).
 * - Both cookies use SameSite=Lax, Secure in production.
 */
import type { Cookies } from "@sveltejs/kit";

/** Cookie names */
const ACCESS_TOKEN_COOKIE = "access_token";
const REFRESH_TOKEN_COOKIE = "refresh_token";

/** Cookie options for access token */
function accessTokenOptions(maxAge: number): CookieOptions {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !import.meta.env.DEV,
    maxAge,
  };
}

/** Cookie options for refresh token */
function refreshTokenOptions(maxAge: number): CookieOptions {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !import.meta.env.DEV,
    maxAge,
  };
}

/** Subset of CookieOptions we actually use. */
interface CookieOptions {
  path: string;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  maxAge: number;
}

/**
 * Set both access and refresh token cookies.
 * Called after a successful login or token refresh.
 */
export function setSessionCookies(
  cookies: Cookies,
  accessToken: string,
  refreshToken: string,
  accessTokenMaxAge: number = 15 * 60, // 15 minutes
  refreshTokenMaxAge: number = 30 * 24 * 60 * 60, // 30 days
): void {
  cookies.set(ACCESS_TOKEN_COOKIE, accessToken, accessTokenOptions(accessTokenMaxAge));
  cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, refreshTokenOptions(refreshTokenMaxAge));
}

/**
 * Read the access token from cookies.
 * Returns null if not present.
 */
export function getAccessToken(cookies: Cookies): string | null {
  return cookies.get(ACCESS_TOKEN_COOKIE) ?? null;
}

/**
 * Read the refresh token from cookies.
 * Returns null if not present.
 */
export function getRefreshToken(cookies: Cookies): string | null {
  return cookies.get(REFRESH_TOKEN_COOKIE) ?? null;
}

/**
 * Clear all session cookies (logout).
 * Sets maxAge=0 to delete them immediately.
 */
export function clearSessionCookies(cookies: Cookies): void {
  cookies.set(ACCESS_TOKEN_COOKIE, "", { ...accessTokenOptions(0), maxAge: 0 });
  cookies.set(REFRESH_TOKEN_COOKIE, "", { ...refreshTokenOptions(0), maxAge: 0 });
}