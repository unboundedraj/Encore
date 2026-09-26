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
  redisUrl: process.env.REDIS_URL,
  /** Direct Postgres connection, for the transactional paths PostgREST cannot express. */
  supabaseDbUrl: process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL,
  // Must match the pinned frontend dev port (frontend/package.json), not
  // Next's default 3000 -- this drives Stripe's success/cancel redirect.
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3002",
  // Backend-only. The secret key can create charges; the webhook secret is the
  // only thing distinguishing a real Stripe callback from anyone's POST.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
};
