/**
 * Firebase Admin SDK.
 *
 * Firebase owns identity. This process never issues tokens -- the frontend
 * signs in with the client SDK and sends the resulting ID token, and the only
 * thing we do here is verify that token's signature and claims.
 *
 * Verification is offline after the first call: the Admin SDK fetches Google's
 * public signing keys and caches them, so verifyIdToken is a local crypto
 * operation on the hot path, not a network round trip per request.
 */

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { env } from "./env";

function required(name: string, value: string | undefined): string {
  if (!value) {
    // Same rule as the Supabase and Mongo config: absent credentials are a
    // misconfiguration, not a degraded state, and should surface at boot.
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy backend/.env.example to backend/.env and fill it in.`
    );
  }
  return value;
}

/**
 * A PEM private key has to survive being carried in a single environment
 * variable, and how it arrives depends on how it was set:
 *
 *   - Double-quoted in a .env file, dotenv already expands \n to real newlines,
 *     so the value arrives ready to use.
 *   - Unquoted in .env, or injected by Docker/CI/a platform's secret manager,
 *     the backslash-n usually survives literally and must be expanded here.
 *
 * This replace is idempotent: it is a no-op on a key that already contains real
 * newlines, and fixes one that does not. Doing it unconditionally means the
 * same code works in every deployment without anyone having to know which case
 * they are in.
 */
function normalisePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n");
}

/**
 * Initialised on first verification rather than at import.
 *
 * Importing this module is then free of side effects, which matters twice
 * over: the server can still boot and answer /api/health when the Firebase
 * credentials are wrong (the failure shows up on auth routes, where it is
 * actionable, instead of preventing startup), and unit tests can import the
 * middleware without needing a service account.
 */
function initialise(): App {
  // Guard against double-initialisation: this module is imported from several
  // places, and a dev-server reload can re-run it in the same process.
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const projectId = required("FIREBASE_PROJECT_ID", env.firebaseProjectId);
  const clientEmail = required("FIREBASE_CLIENT_EMAIL", env.firebaseClientEmail);
  const privateKey = normalisePrivateKey(
    required("FIREBASE_PRIVATE_KEY", env.firebasePrivateKey)
  );

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

let app: App | null = null;

function getApp(): App {
  if (!app) app = initialise();
  return app;
}

/**
 * Verifies an ID token's signature, issuer, audience and expiry.
 *
 * Throws on anything wrong with the token. Callers are responsible for turning
 * that into a 401 without echoing the reason to the client -- see
 * middleware/auth.ts.
 */
export function verifyIdToken(idToken: string): Promise<DecodedIdToken> {
  return getAuth(getApp()).verifyIdToken(idToken);
}

export type { DecodedIdToken };
