/**
 * Auth & Crypto Primitives — stateless functions only.
 * Covers: JWT sign/verify, passkey registration/authentication,
 * session token helpers, password hashing, random.
 * No database access, no cookies, no side effects.
 */

export { hashPassword, verifyPassword } from "./password.js";
export {
  createJwt,
  verifyJwt,
  createSpaceJwt,
  verifySpaceJwt,
  generateTokenId,
  type JwtConfig,
  type AuthJwtPayload,
  type VerifiedJwt,
  type SpaceJwtPayload,
  type VerifiedSpaceJwt,
} from "./jwt.js";
export {
  createSession,
  validateAccessToken,
  refreshSession,
  hashRefreshToken,
  verifyRefreshToken,
  isRefreshTokenExpired,
  createRefreshTokenRecord,
  type SessionTokens,
  type RefreshTokenRecord,
} from "./session.js";
export { webCryptoRandom } from "./random.js";
export {
  generateWebAuthnChallenge,
  verifyPasskeyRegistration,
  verifyPasskeyAuthentication,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorAttestationResponseJSON,
  type AuthenticatorAssertionResponseJSON,
  type VerifiedRegistration,
  type VerifiedAuthentication,
} from "./webauthn.js";