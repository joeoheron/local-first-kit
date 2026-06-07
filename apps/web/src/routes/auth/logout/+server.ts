/**
 * Logout handler.
 *
 * Clears session cookies and deletes the refresh token record from D1.
 * Works as both a GET and POST route so the logout link works from any page.
 *
 * hooks.server.ts runs before this, so locals.user is always available.
 */
import { clearSessionCookies } from "$lib/server/session.js";
import { deleteRefreshTokensByUser } from "$lib/server/users.js";
import type { RequestHandler } from "./$types.js";
import { redirect } from "@sveltejs/kit";

async function performLogout(
  event: import("@sveltejs/kit").RequestEvent,
): Promise<void> {
  const { cookies, locals, platform } = event;

  try {
    if (platform?.env && locals.user) {
      await deleteRefreshTokensByUser(platform.env.DB as D1Database, locals.user.id);
    }
  } catch (err) {
    console.error('[logout] failed to delete refresh tokens:', err);
  }

  clearSessionCookies(cookies);
}

/** GET /auth/logout — link-based logout (use data-sveltekit-reload on the anchor) */
export const GET: RequestHandler = async (event) => {
  await performLogout(event);
  return redirect(302, "/");
};

/** POST /auth/logout — form-based logout */
export const POST: RequestHandler = async (event) => {
  await performLogout(event);
  return redirect(302, "/");
};