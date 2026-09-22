/**
 * Supabase client for the backend.
 *
 * WHY THE SERVICE ROLE KEY
 *
 * The backend is the only thing that talks to Supabase. The Next.js frontend
 * never does -- it calls this Express API, which is what lets us keep one place
 * where authorization is decided.
 *
 * That choice is why the migrations enable RLS on every table and define zero
 * policies. RLS with no policies denies everything, which is exactly right
 * here: Supabase publishes every table over PostgREST to anyone holding the
 * anon key, and the anon key is public by design. With no policies, that key
 * opens nothing.
 *
 * The service role key bypasses RLS entirely, so this client can read and write
 * freely -- and that is precisely why it must never reach the browser. It is a
 * full-access credential:
 *
 *   - It is read from the environment, never hardcoded.
 *   - It must only ever appear in backend-only variables. Anything named
 *     NEXT_PUBLIC_* is inlined into the client bundle at build time, so the
 *     service role key must never be given such a name.
 *   - Auth is Firebase, not Supabase Auth, so auth.uid()-style policies would
 *     not apply even if we wrote them. Identity is verified from the Firebase
 *     token at the API edge, and every query below is issued on behalf of an
 *     already-authorized request.
 *
 * The practical consequence: authorization is this API's job. A query here is
 * unconstrained, so the route layer must scope by user_id itself -- the
 * database will not do it for us.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

function required(name: string, value: string | undefined): string {
  if (!value) {
    // Fail at boot rather than on the first query. A backend with no database
    // credential is misconfigured, not degraded, and should not accept traffic.
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy backend/.env.example to backend/.env and fill it in.`
    );
  }
  return value;
}

export const supabase: SupabaseClient = createClient(
  required("SUPABASE_URL", env.supabaseUrl),
  required("SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceRoleKey),
  {
    auth: {
      // No user sessions on the server: every request is authorized by the API
      // itself, and persisting or refreshing a session here would be state we
      // neither need nor want shared between requests.
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
