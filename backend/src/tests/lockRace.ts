/**
 * Concurrency tests for the hold layer, against a real Redis.
 *
 * These deliberately fire requests simultaneously rather than in sequence. A
 * sequential test passes against a non-atomic implementation, so it would
 * prove nothing about the property that actually matters: that N people
 * racing for one seat produce exactly one winner.
 *
 * Two flavours of race are exercised. The first uses the service's shared
 * connection with Promise.all, so every command is in flight before any reply
 * comes back. The second gives each simulated user its own connection, which
 * removes any chance that a single client's command ordering is what produces
 * the right answer rather than the script's atomicity.
 *
 * Keys are namespaced under a per-run show id, so this never touches real
 * holds and cleans up exactly what it made.
 *
 * Run with: npm run test:locks -w backend
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { connectRedis, disconnectRedis, getRedis, HOLD_TTL_SECONDS } from "../config/redis";
import {
  getSeatHolders,
  holdGeneralAdmission,
  holdSeats,
  LOCK_SEATS_SCRIPT,
  readGeneralHolds,
  releaseGeneralAdmission,
  releaseSeats,
  seatKey,
} from "../services/lockService";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${label}${detail ? ` -- ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

const SHOW = `race-${randomUUID()}`;
const GA_SHOW = `race-ga-${randomUUID()}`;
const seat = (n: number) => `seat-${n}`;
const user = (n: number) => `user-${n}`;

async function main() {
  await connectRedis();
  const redis = getRedis();
  await redis.ping();
  console.log(`connected to Redis, run namespace ${SHOW}\n`);

  try {
    // ---------------------------------------------------------------
    console.log("=== assigned seating: the core race ===");

    const CONTENDERS = 20;
    const results = await Promise.all(
      Array.from({ length: CONTENDERS }, (_, i) => holdSeats(SHOW, [seat(1)], user(i)))
    );
    const winners = results.filter((r) => r.ok);
    check(
      `${CONTENDERS} users race for one seat, exactly 1 wins`,
      winners.length === 1,
      `${winners.length} winners`
    );
    check(
      "every loser is told which seat was contested",
      results.filter((r) => !r.ok).every((r) => r.conflicts.length === 1 && r.conflicts[0] === seat(1))
    );

    // Same race, but each user on its own connection, so Redis -- not one
    // client's send order -- is what serialises them.
    const clients: Redis[] = [];
    try {
      const raceSeat = seat(2);
      const key = seatKey(SHOW, raceSeat);
      for (let i = 0; i < CONTENDERS; i++) {
        clients.push(new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 2 }));
      }
      await Promise.all(clients.map((c) => c.ping()));

      const rawResults = await Promise.all(
        clients.map((c, i) =>
          c.eval(LOCK_SEATS_SCRIPT, 1, key, user(100 + i), HOLD_TTL_SECONDS) as Promise<number[]>
        )
      );
      const rawWinners = rawResults.filter((conflicts) => conflicts.length === 0);
      check(
        `${CONTENDERS} independent connections race, exactly 1 wins`,
        rawWinners.length === 1,
        `${rawWinners.length} winners`
      );
    } finally {
      await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
    }

    // ---------------------------------------------------------------
    console.log("\n=== assigned seating: identity and idempotency ===");

    const holder = winners.length === 1 ? await redis.get(seatKey(SHOW, seat(1))) : null;
    const again = await holdSeats(SHOW, [seat(1)], holder as string);
    check("the same user re-holding their own seat succeeds", again.ok);

    const other = await holdSeats(SHOW, [seat(1)], "someone-else");
    check("a different user is refused", !other.ok && other.conflicts[0] === seat(1));

    const ttlBefore = await redis.ttl(seatKey(SHOW, seat(3)));
    await holdSeats(SHOW, [seat(3)], user(0));
    await redis.expire(seatKey(SHOW, seat(3)), 5);
    await holdSeats(SHOW, [seat(3)], user(0));
    const ttlAfter = await redis.ttl(seatKey(SHOW, seat(3)));
    check(
      "re-holding refreshes the TTL, so a page refresh does not shorten the window",
      ttlAfter > 5,
      `ttl went ${ttlBefore} -> 5 -> ${ttlAfter}`
    );

    // ---------------------------------------------------------------
    console.log("\n=== assigned seating: all-or-nothing ===");

    await holdSeats(SHOW, [seat(10)], user(1));
    const straddle = await holdSeats(SHOW, [seat(10), seat(11), seat(12)], user(2));
    check("a multi-seat hold overlapping someone else's fails", !straddle.ok);
    const afterStraddle = await getSeatHolders(SHOW, [seat(11), seat(12)]);
    check(
      "and takes none of the free seats it asked for",
      afterStraddle.size === 0,
      `${afterStraddle.size} seats were taken anyway`
    );

    const partiallyOwned = await holdSeats(SHOW, [seat(10), seat(13)], user(1));
    check("a user extending their own hold succeeds", partiallyOwned.ok);

    // ---------------------------------------------------------------
    console.log("\n=== release ===");

    const stolen = await releaseSeats(SHOW, [seat(10)], "not-the-holder");
    const stillHeld = await getSeatHolders(SHOW, [seat(10)]);
    check("releasing a seat you do not hold releases nothing", stolen === 0);
    check("and the real holder keeps it", stillHeld.get(seat(10)) === user(1));

    const released = await releaseSeats(SHOW, [seat(10)], user(1));
    check("releasing your own seat works", released === 1);
    const reacquired = await holdSeats(SHOW, [seat(10)], "next-user");
    check("and the seat is immediately available to someone else", reacquired.ok);

    const noop = await releaseSeats(SHOW, [seat(99)], user(1));
    check("releasing a seat nobody holds is a no-op, not an error", noop === 0);

    // ---------------------------------------------------------------
    console.log("\n=== TTL expiry behaves exactly like an explicit release ===");

    const expiringSeat = seat(20);
    await holdSeats(SHOW, [expiringSeat], user(5));
    await redis.expire(seatKey(SHOW, expiringSeat), 1);
    await new Promise((r) => setTimeout(r, 1300));
    const afterExpiry = await getSeatHolders(SHOW, [expiringSeat]);
    check("an expired hold leaves no trace", afterExpiry.size === 0);
    const afterExpiryHold = await holdSeats(SHOW, [expiringSeat], user(6));
    check("and the seat is acquirable by anyone, same as after a release", afterExpiryHold.ok);

    // ---------------------------------------------------------------
    console.log("\n=== general admission: the oversell race ===");

    const CAPACITY = 10;
    const gaResults = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        holdGeneralAdmission(GA_SHOW, 1, user(i), CAPACITY)
      )
    );
    const gaWinners = gaResults.filter((r) => r.ok);
    check(
      `25 users each want 1 ticket of ${CAPACITY}, exactly ${CAPACITY} succeed`,
      gaWinners.length === CAPACITY,
      `${gaWinners.length} succeeded`
    );

    const totals = await readGeneralHolds(GA_SHOW, null);
    check(
      "held total never exceeds capacity",
      totals.heldByOthers <= CAPACITY,
      `${totals.heldByOthers} held`
    );

    // Chunky requests are the harder case: a naive counter overshoots and
    // rejects requests that should have fit.
    const CHUNK_SHOW = `race-chunk-${randomUUID()}`;
    const chunkResults = await Promise.all(
      Array.from({ length: 12 }, (_, i) => holdGeneralAdmission(CHUNK_SHOW, 3, user(i), CAPACITY))
    );
    const chunkWinners = chunkResults.filter((r) => r.ok);
    const chunkTotals = await readGeneralHolds(CHUNK_SHOW, null);
    check(
      `12 users each want 3 tickets of ${CAPACITY}, exactly 3 succeed`,
      chunkWinners.length === 3,
      `${chunkWinners.length} succeeded`
    );
    check(
      "and the total held is 9, never over capacity",
      chunkTotals.heldByOthers === 9,
      `${chunkTotals.heldByOthers} held`
    );
    check(
      "a rejected request is told how many are actually left",
      chunkResults.filter((r) => !r.ok).every((r) => r.available === 1),
      `available values: ${[...new Set(chunkResults.filter((r) => !r.ok).map((r) => r.available))]}`
    );
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => releaseGeneralAdmission(CHUNK_SHOW, user(i)))
    );

    // ---------------------------------------------------------------
    console.log("\n=== general admission: semantics ===");

    const REPLACE_SHOW = `race-replace-${randomUUID()}`;
    await holdGeneralAdmission(REPLACE_SHOW, 2, "repeat-user", CAPACITY);
    await holdGeneralAdmission(REPLACE_SHOW, 5, "repeat-user", CAPACITY);
    const replaced = await readGeneralHolds(REPLACE_SHOW, "repeat-user");
    check(
      "re-holding replaces the quantity rather than adding to it",
      replaced.heldByYou === 5,
      `holds ${replaced.heldByYou}`
    );

    const mine = await readGeneralHolds(REPLACE_SHOW, "repeat-user");
    const theirs = await readGeneralHolds(REPLACE_SHOW, "somebody-else");
    check("your own hold is reported as yours", mine.heldByYou === 5 && mine.heldByOthers === 0);
    check("and as someone else's to everybody else", theirs.heldByOthers === 5 && theirs.heldByYou === 0);

    await releaseGeneralAdmission(REPLACE_SHOW, "repeat-user");
    const afterRelease = await readGeneralHolds(REPLACE_SHOW, null);
    check("releasing frees the capacity", afterRelease.heldByOthers === 0);

    // Expiry for general admission is lazy -- sorted set members carry no TTL,
    // so an expired hold stops counting the next time anyone touches the show.
    // Verify a stale entry cannot consume capacity.
    const EXPIRY_SHOW = `race-exp-${randomUUID()}`;
    await getRedis().hset(`hold:show:${EXPIRY_SHOW}:qty`, "ghost-user", "8");
    await getRedis().zadd(`hold:show:${EXPIRY_SHOW}:exp`, Date.now() - 60_000, "ghost-user");
    const ghostRead = await readGeneralHolds(EXPIRY_SHOW, null);
    check(
      "an expired general-admission hold is reaped on read and consumes nothing",
      ghostRead.heldByOthers === 0,
      `${ghostRead.heldByOthers} still counted`
    );
    const afterGhost = await holdGeneralAdmission(EXPIRY_SHOW, CAPACITY, "real-user", CAPACITY);
    check("so the full capacity is available again", afterGhost.ok);
    await releaseGeneralAdmission(EXPIRY_SHOW, "real-user");
  } finally {
    console.log("\n=== cleanup ===");
    const redis = getRedis();
    let removed = 0;
    // Scoped scan: only keys this run created.
    for (const pattern of [`lock:show:race-*`, `hold:show:race-*`]) {
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
        cursor = next;
        if (keys.length > 0) removed += await redis.del(...keys);
      } while (cursor !== "0");
    }
    console.log(`  deleted ${removed} test key(s)`);
    await disconnectRedis();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`\nFailed: ${err.message}`);
  await disconnectRedis().catch(() => undefined);
  process.exit(1);
});
