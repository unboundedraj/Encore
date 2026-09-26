/**
 * Redis, used for pre-confirmation seat and capacity holds.
 *
 * WHAT REDIS IS AND IS NOT AUTHORITATIVE FOR
 *
 * Redis holds are advisory. They exist so that two people selecting the same
 * seat collide *before* payment, with a clear message, instead of after it
 * with a constraint violation. They are not the thing that makes
 * double-booking impossible -- that is the partial unique index on
 * encore_booking_seats, which is enforced by Postgres and cannot be bypassed.
 *
 * That split is what makes the failure modes safe. Every way Redis can fail
 * (restart, eviction, network partition, an expired TTL) results in a hold
 * disappearing, which makes a seat *more* available, never less exclusive.
 * The worst outcome is two people reaching checkout for the same seat and one
 * of them losing at confirmation -- the exact behaviour we had before Redis
 * existed. There is no failure mode where losing Redis state allows two
 * confirmed bookings on one seat, because Redis is not consulted at
 * confirmation time.
 */

import Redis from "ioredis";
import { env } from "./env";

/** How long a hold survives without being confirmed or renewed. */
export const HOLD_TTL_SECONDS = 7 * 60;

let client: Redis | null = null;
let closing = false;

export function getRedis(): Redis {
  if (client) return client;

  const url = env.redisUrl;
  if (!url) {
    throw new Error(
      "Missing required environment variable REDIS_URL. " +
        "Copy backend/.env.example to backend/.env and fill it in."
    );
  }

  client = new Redis(url, {
    // Fail a command rather than queueing it forever when Redis is down. The
    // hold endpoints turn that into a 503, which is the honest answer: we
    // cannot make the exclusivity promise this endpoint exists to make.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
    connectTimeout: 5000,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });

  client.on("error", (err: Error) => {
    // ioredis emits on every reconnect attempt; log without crashing the
    // process, since an unreachable cache must not take the API down.
    console.error(`[redis] ${err.message}`);
  });
  client.on("connect", () => console.log("[redis] connected"));
  client.on("reconnecting", () => {
    if (!closing) console.warn("[redis] reconnecting");
  });

  return client;
}

export function isRedisReady(): boolean {
  return client?.status === "ready";
}

/**
 * Resolves once the connection is usable.
 *
 * Necessary because enableOfflineQueue is false: that makes a command fail
 * fast when Redis is genuinely down, which is what the hold endpoints want,
 * but it also means a command issued during the initial connect window is
 * rejected outright rather than waiting a few milliseconds. Awaiting this at
 * startup moves that window before the server accepts traffic, so the first
 * hold request does not lose a race with the handshake.
 */
export function connectRedis(): Promise<void> {
  const redis = getRedis();
  if (redis.status === "ready") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      console.log("[redis] ready");
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      redis.off("ready", onReady);
      redis.off("error", onError);
    };
    redis.once("ready", onReady);
    redis.once("error", onError);
  });
}

export async function disconnectRedis(): Promise<void> {
  closing = true;
  try {
    await client?.quit();
  } catch {
    client?.disconnect();
  } finally {
    client = null;
    closing = false;
  }
}
