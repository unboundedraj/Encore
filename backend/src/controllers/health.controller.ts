import { Request, Response } from "express";
import { supabase } from "../config/supabase";

type DependencyStatus = {
  status: "up" | "down";
  latencyMs: number;
  error?: string;
};

const PROBE_TIMEOUT_MS = 3000;

/**
 * Cheapest query that still proves the whole path works: the request is
 * authenticated, PostgREST is serving, Postgres answered, and our schema is
 * actually present.
 *
 * Deliberately NOT `{ head: true }`. A HEAD request has no response body, so
 * supabase-js has nothing to parse an error out of and reports
 * `status: 204, error: null` even when the table does not exist -- the probe
 * would pass against a completely empty database. `limit(1)` costs one row and
 * surfaces PGRST205 properly.
 */
async function probeSupabase(): Promise<DependencyStatus> {
  const startedAt = Date.now();
  try {
    const { error } = await supabase
      .from("encore_shows")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(PROBE_TIMEOUT_MS));

    if (error) {
      return { status: "down", latencyMs: Date.now() - startedAt, error: error.message };
    }
    return { status: "up", latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/**
 * Reports "degraded" rather than "ok" when a dependency is unreachable, so a
 * load balancer or uptime check sees the difference between "the process is
 * alive" and "the process can actually serve requests". Still returns 200 on
 * degraded -- the process is healthy and should not be restarted or pulled
 * from rotation just because the database is briefly unreachable. 503 is
 * reserved for the service being genuinely unable to serve.
 */
export async function getHealth(_req: Request, res: Response) {
  const supabaseStatus = await probeSupabase();
  const degraded = supabaseStatus.status !== "up";

  res.status(200).json({
    status: degraded ? "degraded" : "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    dependencies: { supabase: supabaseStatus },
  });
}
