import "dotenv/config";

export const env = {
  port: process.env.PORT ?? 4000,
  nodeEnv: process.env.NODE_ENV ?? "development",
  supabaseUrl: process.env.SUPABASE_URL,
  // Backend-only. Never expose this to the frontend, and never give it a
  // NEXT_PUBLIC_ name -- see the comment in config/supabase.ts.
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Backend-only: the URI embeds the cluster password.
  mongodbUri: process.env.MONGODB_URI,
  // Firebase service account. Backend-only -- the private key signs on behalf
  // of the whole project, so it must never reach the frontend. The client SDK
  // config (NEXT_PUBLIC_FIREBASE_*) is a different, public set of values.
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY,
};
