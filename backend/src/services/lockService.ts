/**
 * Pre-confirmation holds on seats and general-admission capacity.
 *
 * WHY THIS EXISTS
 *
 * Postgres already makes double-booking impossible: the partial unique index
 * on encore_booking_seats rejects a second confirmed booking for the same
 * (show_id, seat_id). But it only rejects it at confirmation, which is after
 * payment. Without this layer, two people can both select seat A3, both pay,
 * and the loser gets a constraint violation for money already taken.
 *
 * Redis moves that collision earlier: to the moment of selection, where it
 * costs nothing and can be explained ("someone just took A3"). It does not
 * replace the database guarantee, and nothing here is consulted at
 * confirmation time.
 *
 * WHY EVERY WRITE IS A LUA SCRIPT
 *
 * Every operation below is check-then-act: "is this seat free, and if so take
 * it", "is there capacity, and if so consume it". Split across two commands
 * that is a race, and the race is precisely the bug this module exists to
 * prevent. Redis runs a Lua script single-threaded to completion, so nothing
 * interleaves between the check and the act. Pipelines and MULTI do not give
 * this -- they batch commands but cannot branch on what they read.
 *
 * FAILURE MODES, AND WHY THEY ARE ALL SAFE
 *
 * Redis restarts and loses everything, a key is evicted under memory
 * pressure, a TTL fires early, the network partitions -- every one of these
 * ends with a hold disappearing. A vanished hold makes a seat *more*
 * available, never more exclusive. The worst case is two people reaching
 * checkout for the same seat, which is exactly the behaviour before this
 * module existed, and Postgres still refuses the second confirmation. There
 * is no failure mode in which losing Redis state permits two confirmed
 * bookings, because correctness does not depend on Redis being right -- only
 * the quality of the error message does.
 *
 * The one configuration worth getting right: these keys all carry TTLs, so
 * a `volatile-*` maxmemory policy is appropriate. Under `noeviction` a full
 * Redis would start refusing holds (a clean 503), which is also safe.
 */

import type Redis from "ioredis";
import { getRedis, HOLD_TTL_SECONDS } from "../config/redis";

/** Ceiling on how many seats one request may hold, so nobody reserves a theatre. */
export const MAX_SEATS_PER_HOLD = 10;

/**
 * All-or-nothing acquisition of every requested seat.
 *
 * Two passes inside one script: check every seat, and only if all are free
 * (or already ours) take them. A per-seat loop in application code would
 * need to roll back partial acquisitions on conflict, and the rollback
 * itself would race. Here a conflict means nothing was written at all.
 *
 * A seat we already hold is a success, not a conflict: a double-click or a
 * page refresh must not fail. It also refreshes the TTL, so a refresh at
 * 6:59 does not leave the user with one second.
 *
 * Returns an empty array on success, or the 1-based indices of the seats
 * held by somebody else.
 */
export const LOCK_SEATS_SCRIPT = `
local userId = ARGV[1]
local ttl = tonumber(ARGV[2])
local conflicts = {}

for i = 1, #KEYS do
  local holder = redis.call('GET', KEYS[i])
  if holder and holder ~= userId then
    conflicts[#conflicts + 1] = i
  end
end

if #conflicts > 0 then
  return conflicts
end

for i = 1, #KEYS do
  redis.call('SET', KEYS[i], userId, 'EX', ttl)
end

return {}
`;

/**
 * Releases only the seats this user actually holds.
 *
 * The comparison is not optional. An unconditional DEL would let a user whose
 * hold has already expired delete the lock of whoever acquired the seat
 * after them -- the classic distributed-lock footgun, and it turns a safe
 * expiry into a stolen seat.
 */
const UNLOCK_SEATS = `
local released = 0
for i = 1, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
    released = released + 1
  end
end
return released
`;

/**
 * General admission: reap expired holds, sum what everyone else still holds,
 * and take the requested quantity only if it fits.
 *
 * WHY NOT A SIMPLE COUNTER
 *
 * An INCRBY counter fails on two counts. First, expiry: a counter is one key
 * with one TTL, but holds belong to different people and must expire
 * independently -- expiring the key would release everybody at once, and
 * never expiring it would leak capacity permanently every time someone
 * abandoned a checkout. Second, contention: "INCRBY then DECRBY if over" is
 * atomic per command but overshoots in between, so concurrent requests see a
 * momentarily over-capacity counter and reject each other spuriously.
 *
 * So each hold is its own entry: a hash field for the quantity and a sorted
 * set scored by expiry. The sorted set is what makes per-hold expiry possible
 * at all, since hash fields cannot carry a TTL. Expiry is therefore lazy --
 * an expired hold stops counting the next time anyone touches this show,
 * which is guaranteed to be before it could affect an answer, because every
 * read and write reaps first.
 *
 * A user's existing hold is replaced rather than added to: the quantity
 * picker sends the total it wants, not a delta.
 */
const HOLD_GENERAL = `
local qtyKey, expKey = KEYS[1], KEYS[2]
local now = tonumber(ARGV[1])
local userId = ARGV[2]
local quantity = tonumber(ARGV[3])
local capacity = tonumber(ARGV[4])
local expiresAt = tonumber(ARGV[5])
local containerTtl = tonumber(ARGV[6])

local expired = redis.call('ZRANGEBYSCORE', expKey, '-inf', '(' .. now)
for i = 1, #expired do
  redis.call('ZREM', expKey, expired[i])
  redis.call('HDEL', qtyKey, expired[i])
end

local all = redis.call('HGETALL', qtyKey)
local others = 0
for i = 1, #all, 2 do
  if all[i] ~= userId then
    others = others + tonumber(all[i + 1])
  end
end

local available = capacity - others
if available < 0 then available = 0 end

if quantity > available then
  return {0, available}
end

redis.call('HSET', qtyKey, userId, quantity)
redis.call('ZADD', expKey, expiresAt, userId)
redis.call('EXPIRE', qtyKey, containerTtl)
redis.call('EXPIRE', expKey, containerTtl)

return {1, available - quantity}
`;

const RELEASE_GENERAL = `
local removed = redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return removed
`;

/** Reaps expired holds, then reports what others hold and what this user holds. */
const READ_GENERAL = `
local qtyKey, expKey = KEYS[1], KEYS[2]
local now = tonumber(ARGV[1])
local userId = ARGV[2]

local expired = redis.call('ZRANGEBYSCORE', expKey, '-inf', '(' .. now)
for i = 1, #expired do
  redis.call('ZREM', expKey, expired[i])
  redis.call('HDEL', qtyKey, expired[i])
end

local all = redis.call('HGETALL', qtyKey)
local others, mine = 0, 0
for i = 1, #all, 2 do
  if all[i] == userId then
    mine = mine + tonumber(all[i + 1])
  else
    others = others + tonumber(all[i + 1])
  end
end
return {others, mine}
`;

type ScriptClient = Redis & {
  lockSeats(...args: Array<string | number>): Promise<number[]>;
  unlockSeats(...args: Array<string | number>): Promise<number>;
  holdGeneral(...args: Array<string | number>): Promise<[number, number]>;
  releaseGeneral(...args: Array<string | number>): Promise<number>;
  readGeneral(...args: Array<string | number>): Promise<[number, number]>;
};

let registered = false;

function scripts(): ScriptClient {
  const redis = getRedis() as ScriptClient;
  if (!registered) {
    // defineCommand uses EVALSHA with an automatic EVAL fallback, so the
    // script body crosses the wire once rather than on every hold.
    redis.defineCommand("lockSeats", { lua: LOCK_SEATS_SCRIPT });
    redis.defineCommand("unlockSeats", { lua: UNLOCK_SEATS });
    redis.defineCommand("holdGeneral", { numberOfKeys: 2, lua: HOLD_GENERAL });
    redis.defineCommand("releaseGeneral", { numberOfKeys: 2, lua: RELEASE_GENERAL });
    redis.defineCommand("readGeneral", { numberOfKeys: 2, lua: READ_GENERAL });
    registered = true;
  }
  return redis;
}

/** Exposed so tests can reset script registration against a fresh client. */
export function resetScriptRegistration(): void {
  registered = false;
}

export function seatKey(showId: string, seatId: string): string {
  return `lock:show:${showId}:seat:${seatId}`;
}

function generalKeys(showId: string): [string, string] {
  return [`hold:show:${showId}:qty`, `hold:show:${showId}:exp`];
}

export interface SeatHoldResult {
  ok: boolean;
  /** Seat ids held by someone else. Empty when ok. */
  conflicts: string[];
  expiresAt: Date;
}

export async function holdSeats(
  showId: string,
  seatIds: string[],
  userId: string
): Promise<SeatHoldResult> {
  const keys = seatIds.map((id) => seatKey(showId, id));
  const conflictIndices = await scripts().lockSeats(
    keys.length,
    ...keys,
    userId,
    HOLD_TTL_SECONDS
  );

  return {
    ok: conflictIndices.length === 0,
    // Lua indices are 1-based.
    conflicts: conflictIndices.map((i) => seatIds[i - 1]),
    expiresAt: new Date(Date.now() + HOLD_TTL_SECONDS * 1000),
  };
}

/** Returns how many of the given seats were actually released. */
export async function releaseSeats(
  showId: string,
  seatIds: string[],
  userId: string
): Promise<number> {
  if (seatIds.length === 0) return 0;
  const keys = seatIds.map((id) => seatKey(showId, id));
  return scripts().unlockSeats(keys.length, ...keys, userId);
}

/** Maps seat id -> holder user id, for seats currently held. */
export async function getSeatHolders(
  showId: string,
  seatIds: string[]
): Promise<Map<string, string>> {
  const holders = new Map<string, string>();
  if (seatIds.length === 0) return holders;

  // A plain read: staleness here only affects display, so it does not need
  // the atomicity the write paths do.
  const values = await getRedis().mget(seatIds.map((id) => seatKey(showId, id)));
  values.forEach((holder, i) => {
    if (holder) holders.set(seatIds[i], holder);
  });
  return holders;
}

export interface GeneralHoldResult {
  ok: boolean;
  /** Requested quantity when ok; otherwise how many were actually free. */
  available: number;
  expiresAt: Date;
}

/**
 * @param capacityForHolds total_capacity minus quantity already confirmed in
 * Postgres. Computed by the caller, since Redis has no view of bookings.
 */
export async function holdGeneralAdmission(
  showId: string,
  quantity: number,
  userId: string,
  capacityForHolds: number
): Promise<GeneralHoldResult> {
  const [qtyKey, expKey] = generalKeys(showId);
  const now = Date.now();
  const expiresAt = now + HOLD_TTL_SECONDS * 1000;

  const [ok, remaining] = await scripts().holdGeneral(
    qtyKey,
    expKey,
    now,
    userId,
    quantity,
    capacityForHolds,
    expiresAt,
    // Outlive the longest possible hold so a quiet show's keys expire on
    // their own instead of accumulating.
    HOLD_TTL_SECONDS + 60
  );

  return { ok: ok === 1, available: remaining, expiresAt: new Date(expiresAt) };
}

export async function releaseGeneralAdmission(showId: string, userId: string): Promise<number> {
  const [qtyKey, expKey] = generalKeys(showId);
  return scripts().releaseGeneral(qtyKey, expKey, userId);
}

/** Live hold totals for a general-admission show, expired entries excluded. */
export async function readGeneralHolds(
  showId: string,
  userId: string | null
): Promise<{ heldByOthers: number; heldByYou: number }> {
  const [qtyKey, expKey] = generalKeys(showId);
  const [others, mine] = await scripts().readGeneral(
    qtyKey,
    expKey,
    Date.now(),
    // An empty string matches no real Firebase uid, so an anonymous reader
    // simply sees every hold as somebody else's.
    userId ?? ""
  );
  return { heldByOthers: others, heldByYou: mine };
}
