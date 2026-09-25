/**
 * Calls the Encore backend with the signed-in user's Firebase ID token.
 *
 * The token is what the backend's requireAuth middleware verifies. Nothing here
 * decides whether a request is allowed -- that is the API's job. This only
 * carries the credential.
 */

import { getFirebaseAuth } from "./firebase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Thrown for any non-2xx response, carrying the status for callers to branch on. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotAuthenticatedError";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Non-JSON body (a proxy error page, say). Fall through.
  }
  return `Request failed with status ${response.status}`;
}

/**
 * Fetches a backend route as the current user.
 *
 * `getIdToken()` returns the cached token and refreshes it only when it has
 * expired or is close to expiring, so this is not a network round trip per
 * call. The retry below covers the cases that slip past that check -- notably
 * clock skew between this machine and Google's servers, which can make a token
 * the SDK still considers fresh arrive already expired.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new NotAuthenticatedError();

  const request = async (forceRefresh: boolean): Promise<Response> => {
    const token = await user.getIdToken(forceRefresh);
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  };

  let response = await request(false);

  // One retry with a forced refresh. If it still 401s the token is genuinely
  // not acceptable -- revoked, or the account is gone -- and retrying again
  // would just loop.
  if (response.status === 401) {
    response = await request(true);
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

  // 204 and friends have no body to parse.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
