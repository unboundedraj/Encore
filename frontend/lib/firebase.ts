/**
 * Firebase client SDK.
 *
 * These values are public by design. Firebase enforces access through security
 * rules and the backend's own token verification, not by keeping the web config
 * secret -- it ships in the JavaScript bundle to every visitor either way. The
 * credential that must never appear here is the service account key, which
 * lives only in backend/.env.
 */

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";

/**
 * Each variable is read as a literal `process.env.NEXT_PUBLIC_...` expression
 * on purpose. Next.js inlines these at build time by static text substitution,
 * so a computed lookup like `process.env[name]` would silently evaluate to
 * undefined in the browser.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function assertConfigured(config: typeof firebaseConfig): asserts config is {
  [K in keyof typeof firebaseConfig]: string;
} {
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    // Without this, Firebase fails later with an opaque message about an
    // invalid API key. Name the actual problem instead.
    throw new Error(
      `Firebase is not configured: missing ${missing.join(", ")}. ` +
        `Copy frontend/.env.example to frontend/.env.local and fill it in, ` +
        `then restart the dev server -- NEXT_PUBLIC_ values are baked in at build time.`
    );
  }
}

function getFirebaseApp(): FirebaseApp {
  // Fast Refresh re-runs modules in the same browser context, so guard against
  // re-initialising an app that already exists.
  if (getApps().length > 0) return getApp();
  assertConfigured(firebaseConfig);
  return initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export const googleProvider = new GoogleAuthProvider();
