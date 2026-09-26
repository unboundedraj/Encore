import { Request, Response } from "express";
import mongoose from "mongoose";
import { getRedis } from "../config/redis";
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
 * Runs a real command against the server rather than reading
 * `connection.readyState`. readyState is a local cached flag: it still says
 * "connected" while the network is gone, right up until the driver notices.
 *
 * One honest caveat, unlike the Supabase probe: Mongo creates collections
 * lazily, so querying a missing collection succeeds and returns nothing. This
 * proves reachability, authentication and that the named database is usable --
 * it cannot prove the catalog has been populated.
 */
async function probeMongo(): Promise<DependencyStatus> {
  const startedAt = Date.now();
  try {
    const db = mongoose.connection.db;
    if (!db) {
      return {
        status: "down",
        latencyMs: Date.now() - startedAt,
        error: "no active connection",
      };
    }
    // ping is a genuine round-trip to the server and is authenticated against
    // this connection's database.
    await Promise.race([
      db.command({ ping: 1 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("probe timed out")), PROBE_TIMEOUT_MS)
      ),
    ]);
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
 * PING is a real command round-trip, not a read of client.status. status is a
 * local field that still says "ready" for as long as it takes the socket to
 * notice it is gone -- the same trap as Mongo's readyState.
 */
async function probeRedis(): Promise<DependencyStatus> {
  const startedAt = Date.now();
  try {
    const pong = await Promise.race([
      getRedis().ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe timed out")), PROBE_TIMEOUT_MS)
      ),
    ]);
    if (pong !== "PONG") {
      return { status: "down", latencyMs: Date.now() - startedAt, error: `unexpected reply: ${pong}` };
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
 * from rotation just because a database is briefly unreachable. 503 is
 * reserved for the service being genuinely unable to serve.
 *
 * The probes run concurrently and are reported independently: one dependency
 * being down must not hide the state of the others.
 */
export async function getHealth(_req: Request, res: Response) {
  const [supabaseStatus, mongodbStatus, redisStatus] = await Promise.all([
    probeSupabase(),
    probeMongo(),
    probeRedis(),
  ]);
  const degraded =
    supabaseStatus.status !== "up" ||
    mongodbStatus.status !== "up" ||
    redisStatus.status !== "up";

  res.status(200).json({
    status: degraded ? "degraded" : "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    dependencies: { supabase: supabaseStatus, mongodb: mongodbStatus, redis: redisStatus },
  });
}
