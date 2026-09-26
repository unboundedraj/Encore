/**
 * Authentication and local user provisioning, kept as two separate middlewares.
 *
 * WHY THE UPSERT IS NOT IN requireAuth
 *
 * The brief asked for the encore_users row to appear on first successful auth,
 * with no separate "create profile" call from the client. It does -- but the
 * write lives in its own middleware rather than inside requireAuth, for three
 * reasons.
 *
 * 1. Authentication would otherwise depend on Postgres being up. Verifying a
 *    token is pure local cryptography. If the upsert lived in requireAuth, a
 *    database blip would turn every authenticated request into a failure,
 *    including GET routes that never touch encore_users. Browsing showtimes
 *    should not break because a write path is unavailable.
 *
 * 2. "Should the request still proceed if the upsert fails?" has no single
 *    answer -- it depends on the route. For a booking, no: encore_bookings has
 *    a foreign key to encore_users, so continuing just moves the failure to a
 *    confusing FK violation further in. For a catalog read, yes: the row is
 *    irrelevant. One middleware cannot be right for both, so the route decides
 *    by composing `requireAuth` alone or `requireAuth, ensureUserRecord`.
 *
 * 3. A write on every authenticated request is pure overhead. Against
 *    PostgREST that is an HTTP round trip per call, for a row that changes
 *    almost never.
 *
 * The client still does nothing special: it signs in, sends the token, and the
 * row exists by the time any route that needs it runs.
 */

import type { NextFunction, Request, Response } from "express";
import { verifyIdToken as realVerifyIdToken, type DecodedIdToken } from "../config/firebase";
import {
  EmailConflictError,
  MissingEmailError,
  upsertUserFromIdentity,
} from "../services/userService";
import type { User } from "shared";

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      userRecord?: User;
    }
  }
}

type TokenVerifier = (idToken: string) => Promise<DecodedIdToken>;

function toAuthenticatedUser(decoded: DecodedIdToken): AuthenticatedUser {
  return {
    uid: decoded.uid,
    email: decoded.email ?? null,
    // `name` is a standard OIDC claim Firebase populates from displayName. It
    // is not on the DecodedIdToken interface, so it comes off the index
    // signature and needs narrowing.
    name: typeof decoded.name === "string" ? decoded.name : null,
    emailVerified: decoded.email_verified === true,
  };
}

/**
 * Factory so tests can inject a fake verifier. The exported `requireAuth` below
 * is this wired to the real Firebase Admin call.
 */
export function createRequireAuth(verify: TokenVerifier) {
  return async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;

    if (!header) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    // Split on the first space only; a JWT contains no spaces, but being strict
    // about the scheme keeps "Bearer" from matching "Bearertoken".
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ error: "Authorization header must be 'Bearer <token>'" });
    }

    try {
      const decoded = await verify(token);
      req.user = toAuthenticatedUser(decoded);
      return next();
    } catch (err) {
      // Log the real reason -- expired, revoked, wrong project, bad signature --
      // because that is what makes an auth problem diagnosable. Do not return
      // it: the distinction between "signature invalid" and "expired" is useful
      // to an attacker probing tokens, and useless to an honest client, which
      // should just re-authenticate either way.
      const code = (err as { code?: string }).code ?? "unknown";
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[auth] token rejected (${code}): ${message}`);
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

export const requireAuth = createRequireAuth(realVerifyIdToken);

/**
 * Populates req.user when a valid token is present, and carries on regardless
 * when it is not.
 *
 * For routes that are public but render differently for a signed-in caller --
 * the seat map needs to mark which holds are yours, without making browsing
 * require an account.
 *
 * A malformed or expired token is treated as anonymous rather than rejected.
 * The caller asked for a public resource; refusing it because a stale token
 * happened to be attached would be a worse answer than serving the public
 * view. Routes that actually need identity use requireAuth instead.
 */
export function createOptionalAuth(verify: TokenVerifier) {
  return async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme !== "Bearer" || !token) return next();

    try {
      req.user = toAuthenticatedUser(await verify(token));
    } catch {
      // Intentionally silent: an anonymous view is a valid outcome here, not
      // an error worth logging on every crawler request.
    }
    return next();
  };
}

export const optionalAuth = createOptionalAuth(realVerifyIdToken);

/**
 * How long a uid is treated as already-provisioned before we write again.
 * Bounds the redundant-write rate to one per uid per window per process; the
 * cost of being wrong is a single harmless extra upsert.
 */
const PROVISION_TTL_MS = 5 * 60_000;
const MAX_TRACKED_UIDS = 10_000;
const provisionedAt = new Map<string, number>();

function markProvisioned(uid: string): void {
  if (provisionedAt.size >= MAX_TRACKED_UIDS) {
    const cutoff = Date.now() - PROVISION_TTL_MS;
    for (const [key, at] of provisionedAt) {
      if (at < cutoff) provisionedAt.delete(key);
    }
    // Still full of live entries: drop the oldest rather than grow without
    // bound. Eviction only costs a redundant upsert later.
    if (provisionedAt.size >= MAX_TRACKED_UIDS) {
      const oldest = provisionedAt.keys().next().value;
      if (oldest !== undefined) provisionedAt.delete(oldest);
    }
  }
  provisionedAt.set(uid, Date.now());
}

function isRecentlyProvisioned(uid: string): boolean {
  const at = provisionedAt.get(uid);
  return at !== undefined && Date.now() - at < PROVISION_TTL_MS;
}

/** Exposed for tests; provisioning state is process-local, not shared. */
export function resetProvisioningCache(): void {
  provisionedAt.clear();
}

/**
 * Ensures the caller has a row in encore_users. Compose after requireAuth on
 * any route that writes rows referencing the user.
 *
 * This guarantees *existence*, not freshness. `req.userRecord` is populated
 * only on the request that actually performed the upsert; within the TTL the
 * write is skipped entirely and the property is left unset. A route that needs
 * the row's contents should fall back to findUserById rather than assume it is
 * there -- which also keeps that read fresh instead of serving a cached copy
 * that could be minutes stale.
 *
 * Failure here is fatal to the request by design. A route that asked for the
 * record needs it, so proceeding would only defer the error to an FK violation
 * with a worse message. 503 rather than 500: the caller's token was fine and
 * retrying is the correct response.
 */
export async function ensureUserRecord(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    // Programming error: this middleware was mounted without requireAuth.
    console.error("[auth] ensureUserRecord ran without requireAuth");
    return res.status(500).json({ error: "Internal server error" });
  }

  try {
    if (!isRecentlyProvisioned(req.user.uid)) {
      req.userRecord = await upsertUserFromIdentity({
        uid: req.user.uid,
        email: req.user.email,
        name: req.user.name,
      });
      markProvisioned(req.user.uid);
    }
    return next();
  } catch (err) {
    if (err instanceof MissingEmailError) {
      // The token is valid; the identity is just unusable for our schema.
      return res.status(403).json({
        error: "An email address is required. Sign in with a method that provides one.",
      });
    }
    if (err instanceof EmailConflictError) {
      return res.status(409).json({
        error: "That email address is already associated with another account.",
      });
    }
    console.error(`[auth] provisioning failed for ${req.user.uid}:`, err);
    return res.status(503).json({ error: "User provisioning temporarily unavailable" });
  }
}
