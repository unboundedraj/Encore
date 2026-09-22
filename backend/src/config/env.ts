import "dotenv/config";

export const env = {
  port: process.env.PORT ?? 4000,
  nodeEnv: process.env.NODE_ENV ?? "development",
  supabaseUrl: process.env.SUPABASE_URL,
  // Backend-only. Never expose this to the frontend, and never give it a
  // NEXT_PUBLIC_ name -- see the comment in config/supabase.ts.
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
