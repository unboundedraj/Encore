/**
 * Direct Postgres pool, used only where a real transaction is required.
 *
 * Everything else in the app talks to Postgres through supabase-js, which is
 * PostgREST -- one HTTP request per statement, with no way to hold a
 * transaction open across them. Confirming a booking has to mark the booking
 * and record the payment as a single atomic unit, so that path needs a real
 * connection.
 *
 * This is the same credential the migrations use, and is backend-only: it is
 * a superuser-equivalent connection that bypasses RLS entirely.
 */

import { Pool, type PoolClient } from "pg";
import { env } from "./env";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = env.supabaseDbUrl;
  if (!connectionString) {
    throw new Error(
      "Missing required environment variable SUPABASE_DB_URL. It is the direct " +
        "Postgres connection string, not SUPABASE_URL -- see backend/.env.example."
    );
  }

  pool = new Pool({
    connectionString,
    // Supabase requires TLS; its chain is not in Node's default store.
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (err) => console.error(`[postgres] idle client error: ${err.message}`));
  return pool;
}

/**
 * Runs `fn` inside a transaction, committing on success and rolling back on
 * any throw. The rollback is in a finally-style guard rather than a catch so
 * that a failure to roll back cannot mask the original error.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch((rollbackErr) => {
      console.error(`[postgres] rollback failed: ${(rollbackErr as Error).message}`);
    });
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}
