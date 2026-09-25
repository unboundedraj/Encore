/**
 * Turns Firebase error codes into messages a person can act on.
 *
 * Raw Firebase errors are not shown to users: they read like
 * "Firebase: Error (auth/invalid-credential)." and describe the SDK's problem
 * rather than the person's.
 *
 * SIGN-IN FAILURES ARE DELIBERATELY INDISTINGUISHABLE
 *
 * "No account with that email" and "wrong password" map to the same string.
 * Telling them apart turns the login form into an account-existence oracle:
 * anyone can check whether a given address is registered here. Modern Firebase
 * takes the same position -- with email enumeration protection on (the default
 * for new projects) it returns a single `auth/invalid-credential` for both
 * cases rather than the older, more specific codes. The legacy codes are still
 * mapped for older projects, to the same generic message.
 *
 * This mirrors the backend, which returns one "Invalid or expired token" for
 * every rejection reason and logs the specific cause server-side.
 */

const MESSAGES: Record<string, string> = {
  // --- sign in ---
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/invalid-email": "That doesn't look like a valid email address.",
  "auth/user-disabled": "This account has been disabled.",

  // --- sign up ---
  "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
  "auth/weak-password": "Password is too weak. Use at least 6 characters.",
  "auth/operation-not-allowed":
    "Email and password sign-in isn't enabled for this project yet.",

  // --- Google popup ---
  "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups and try again.",
  "auth/account-exists-with-different-credential":
    "An account with this email already exists using a different sign-in method.",
  "auth/unauthorized-domain":
    "This domain isn't authorised for sign-in. Add it in the Firebase console.",

  // --- transport / abuse ---
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/network-request-failed": "Couldn't reach the server. Check your connection.",
};

/**
 * Codes that mean "the user changed their mind", not "something went wrong".
 * Closing a popup should leave the form untouched rather than flash an error.
 */
const SILENT_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

export function isSilentAuthError(error: unknown): boolean {
  return SILENT_CODES.has(getCode(error));
}

function getCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

export function toAuthErrorMessage(error: unknown): string {
  const code = getCode(error);
  if (code in MESSAGES) return MESSAGES[code];

  // Unmapped code: log the real one so it can be added, show a neutral message.
  if (code) console.error(`[auth] unmapped Firebase error code: ${code}`, error);
  else console.error("[auth] non-Firebase error during authentication", error);

  return "Something went wrong. Please try again.";
}
