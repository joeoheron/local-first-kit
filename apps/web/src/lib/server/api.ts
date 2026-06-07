import { error } from '@sveltejs/kit';
import { verifyApiToken, type TokenScope } from './apiTokens.js';

export interface AccessContext {
  userId: string;
  scope: TokenScope;
  /** Raw bearer token, or null on the session-cookie path. */
  rawToken: string | null;
  /** Escrowed wrapped space key from the token, or null when absent / on the session path. */
  wrappedSpaceKey: string | null;
  /** Current role in the token's bound space; null on the session path (not space-scoped). */
  role: string | null;
}

export async function requireAccess(
  request: Request,
  locals: App.Locals,
  platform: App.Platform | undefined,
): Promise<AccessContext> {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (bearerToken) {
    if (!platform?.env?.DB) throw error(503, 'Service unavailable');
    const auth = await verifyApiToken(platform.env.DB, bearerToken);
    if (!auth) throw error(401, 'Invalid or expired token');
    return {
      userId: auth.userId,
      scope: auth.scope,
      rawToken: bearerToken,
      wrappedSpaceKey: auth.wrappedSpaceKey,
      role: auth.role,
    };
  }

  if (locals.user) {
    return { userId: locals.user.id, scope: 'readwrite', rawToken: null, wrappedSpaceKey: null, role: null };
  }

  throw error(401, 'Authentication required');
}

export async function requireWriteAccess(
  request: Request,
  locals: App.Locals,
  platform: App.Platform | undefined,
): Promise<AccessContext> {
  const auth = await requireAccess(request, locals, platform);
  if (auth.scope === 'read') throw error(403, 'Read-only token');
  return auth;
}
