/**
 * Webhook and confirmation tests.
 *
 * These run entirely offline. Stripe's SDK can sign a synthetic event with any
 * secret, so signature verification, idempotency and -- most importantly --
 * the commit-before-release ordering can all be exercised without calling
 * Stripe's API or holding a real key. Only creating an actual Checkout Session
 * needs live credentials, and that is a separate test.
 *
 * Postgres and Redis are real. Faking them would defeat the point: the
 * properties under test are about what survives a failure in one while the
 * other has already changed.
 *
 * Run with: npm run test:checkout -w backend
 */

import "dotenv/config";

// Set before anything reads env. The webhook secret has to be one we control
// in order to sign events; the secret key only needs to exist, since
// constructEvent is local crypto and never calls Stripe.
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_local_verification";
process.env.STRIPE_SECRET_KEY ||= "sk_test_placeholder_for_offline_tests";

import { randomUUID } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import Stripe from "stripe";
import { closePool, getPool } from "../config/postgres";
import { connectRedis, disconnectRedis } from "../config/redis";
import * as bookingService from "../services/bookingService";
import { getSeatHolders, holdSeats, releaseSeats } from "../services/lockService";
import webhookRoutes from "../routes/webhook.routes";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2026-08-26.dahlia" });

const SHOW_ID = "a4620294-915a-4671-be81-03e313c9df81"; // seeded assigned-seating show
const SCREEN_ID = "22222222-2222-2222-2222-222222222222";
const USER_A = `wh-test-a-${Date.now()}`;
const USER_B = `wh-test-b-${Date.now()}`;

let pass = 0;
let fail = 0;
const createdBookings: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${label}${detail ? ` -- ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

/** A checkout.session.completed event shaped like the real thing. */
function completedEvent(bookingId: string, sessionId: string, amount: number): Stripe.Event {
  return {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        amount_total: amount,
        currency: "inr",
        payment_status: "paid",
        status: "complete",
        client_reference_id: bookingId,
        metadata: { bookingId, showId: SHOW_ID },
        payment_intent: `pi_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      } as unknown as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event;
}

function expiredEvent(bookingId: string, sessionId: string): Stripe.Event {
  const base = completedEvent(bookingId, sessionId, 0);
  return {
    ...base,
    type: "checkout.session.expired",
    data: {
      object: { ...(base.data.object as object), status: "expired", payment_status: "unpaid" },
    },
  } as unknown as Stripe.Event;
}

async function post(url: string, event: Stripe.Event, opts: { signed?: boolean; tamper?: boolean } = {}) {
  const payload = JSON.stringify(event);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (opts.signed !== false) {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET as string });
    headers["stripe-signature"] = opts.tamper ? header.replace(/v1=[a-f0-9]+/, "v1=" + "0".repeat(64)) : header;
  }
  const res = await fetch(url, { method: "POST", headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function seedBooking(userId: string, seatId: string): Promise<string> {
  const booking = await bookingService.createPendingBooking({
    userId,
    showId: SHOW_ID,
    seatingMode: "assigned",
    seatIds: [seatId],
    totalAmount: 35000,
    screenId: SCREEN_ID,
  });
  createdBookings.push(booking.id);
  return booking.id;
}

async function bookingStatus(id: string): Promise<string | null> {
  const { rows } = await getPool().query<{ status: string }>(
    `select status from encore_bookings where id = $1`,
    [id]
  );
  return rows[0]?.status ?? null;
}

async function paymentRows(bookingId: string) {
  const { rows } = await getPool().query<{ status: string; gateway_payment_id: string }>(
    `select status, gateway_payment_id from encore_payments where booking_id = $1`,
    [bookingId]
  );
  return rows;
}

async function main() {
  await connectRedis();

  // Users must exist: encore_bookings.user_id is a foreign key.
  for (const uid of [USER_A, USER_B]) {
    await getPool().query(
      `insert into encore_users (id, email, name) values ($1, $2, 'Webhook Test')
       on conflict (id) do nothing`,
      [uid, `${uid}@example.invalid`]
    );
  }

  const { rows: seatRows } = await getPool().query<{ id: string }>(
    `select id from encore_seats where screen_id = $1 order by row_label, seat_number limit 6`,
    [SCREEN_ID]
  );
  const seats = seatRows.map((r) => r.id);

  const app = express();
  app.use("/api/webhooks", webhookRoutes);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/api/webhooks/stripe`;
  console.log(`test webhook listening on ${port}\n`);

  try {
    // -----------------------------------------------------------------
    console.log("=== signature verification ===");

    const unsigned = await post(url, completedEvent(randomUUID(), "cs_x", 100), { signed: false });
    check("an unsigned request is rejected", unsigned.status === 400, `got ${unsigned.status}`);

    const tampered = await post(url, completedEvent(randomUUID(), "cs_x", 100), { tamper: true });
    check("a bad signature is rejected", tampered.status === 400, `got ${tampered.status}`);

    const forged = new Stripe("sk_test_other", { apiVersion: "2026-08-26.dahlia" });
    const forgedPayload = JSON.stringify(completedEvent(randomUUID(), "cs_forged", 100));
    const forgedHeader = forged.webhooks.generateTestHeaderString({
      payload: forgedPayload,
      secret: "whsec_a_different_secret_entirely",
    });
    const forgedRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": forgedHeader },
      body: forgedPayload,
    });
    check(
      "an event signed with the wrong secret is rejected",
      forgedRes.status === 400,
      `got ${forgedRes.status}`
    );
    const forgedBody = (await forgedRes.json()) as { error?: string };
    check("and no detail is leaked about why", forgedBody.error === "Invalid signature");

    // -----------------------------------------------------------------
    console.log("\n=== successful confirmation ===");

    const bookingA = await seedBooking(USER_A, seats[0]);
    await holdSeats(SHOW_ID, [seats[0]], USER_A);
    const sessionA = `cs_test_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const eventA = completedEvent(bookingA, sessionA, 35000);

    const ok = await post(url, eventA);
    check("a valid event is accepted", ok.status === 200, `got ${ok.status}`);
    check("the booking is confirmed", (await bookingStatus(bookingA)) === "confirmed");

    const paymentsA = await paymentRows(bookingA);
    check("exactly one payment row exists", paymentsA.length === 1, `${paymentsA.length} rows`);
    check("and it is marked succeeded", paymentsA[0]?.status === "succeeded", paymentsA[0]?.status);

    const holdAfter = await getSeatHolders(SHOW_ID, [seats[0]]);
    check("the Redis hold is released after the commit", holdAfter.size === 0, `${holdAfter.size} holds remain`);

    // -----------------------------------------------------------------
    console.log("\n=== idempotency: the same event delivered twice ===");

    const replay = await post(url, eventA);
    check("the replay is accepted rather than erroring", replay.status === 200, `got ${replay.status}`);
    const paymentsAfterReplay = await paymentRows(bookingA);
    check(
      "still exactly one payment row",
      paymentsAfterReplay.length === 1,
      `${paymentsAfterReplay.length} rows`
    );
    check("booking still confirmed exactly once", (await bookingStatus(bookingA)) === "confirmed");

    const { rows: seatStatusRows } = await getPool().query<{ status: string; n: string }>(
      `select status, count(*) n from encore_booking_seats where booking_id = $1 group by status`,
      [bookingA]
    );
    check(
      "seat rows cascaded to confirmed, once",
      seatStatusRows.length === 1 && seatStatusRows[0].status === "confirmed" && seatStatusRows[0].n === "1",
      JSON.stringify(seatStatusRows)
    );

    // A *different* event id for the same session must also not double-apply.
    const secondEventSameSession = completedEvent(bookingA, sessionA, 35000);
    await post(url, secondEventSameSession);
    check(
      "a different event id for the same session still does not duplicate",
      (await paymentRows(bookingA)).length === 1
    );

    // -----------------------------------------------------------------
    console.log("\n=== the ordering guarantee: commit fails, hold must survive ===");

    const bookingB = await seedBooking(USER_B, seats[1]);
    await holdSeats(SHOW_ID, [seats[1]], USER_B);
    const heldBefore = await getSeatHolders(SHOW_ID, [seats[1]]);
    check("precondition: the seat is held", heldBefore.get(seats[1]) === USER_B);

    // Force the database step to fail. This is the one direction that would be
    // dangerous to get backwards, so it is tested by breaking it on purpose
    // rather than by reasoning about the code.
    const realConfirm = bookingService.confirmBooking;
    (bookingService as { confirmBooking: unknown }).confirmBooking = async () => {
      throw new Error("simulated Postgres failure during confirmation");
    };

    const failedRes = await post(url, completedEvent(bookingB, `cs_fail_${randomUUID().slice(0, 8)}`, 35000));
    (bookingService as { confirmBooking: unknown }).confirmBooking = realConfirm;

    check(
      "the webhook returns 5xx so Stripe will retry",
      failedRes.status >= 500,
      `got ${failedRes.status}`
    );
    const heldAfterFailure = await getSeatHolders(SHOW_ID, [seats[1]]);
    check(
      "THE HOLD IS NOT RELEASED when the commit failed",
      heldAfterFailure.get(seats[1]) === USER_B,
      heldAfterFailure.get(seats[1]) ?? "hold was released"
    );
    check("and the booking is still pending, not confirmed", (await bookingStatus(bookingB)) === "pending");

    // The retry Stripe would send must then succeed.
    const retryRes = await post(url, completedEvent(bookingB, `cs_retry_${randomUUID().slice(0, 8)}`, 35000));
    check("a retry after the failure succeeds", retryRes.status === 200, `got ${retryRes.status}`);
    check("and confirms the booking", (await bookingStatus(bookingB)) === "confirmed");
    const heldAfterRetry = await getSeatHolders(SHOW_ID, [seats[1]]);
    check("releasing the hold only now", heldAfterRetry.size === 0);

    // -----------------------------------------------------------------
    console.log("\n=== losing the seat race after paying ===");

    // Someone else already owns this seat, confirmed. A late payment for it
    // must not confirm, must not corrupt anything, and must be recorded so
    // the money can be traced.
    const winner = await seedBooking(USER_A, seats[2]);
    await getPool().query(`update encore_bookings set status = 'confirmed' where id = $1`, [winner]);

    const loser = await seedBooking(USER_B, seats[2]);
    await holdSeats(SHOW_ID, [seats[2]], USER_B);
    const lateRes = await post(url, completedEvent(loser, `cs_late_${randomUUID().slice(0, 8)}`, 35000));

    check("the webhook still returns 200 (retrying would not help)", lateRes.status === 200, `got ${lateRes.status}`);
    check("the losing booking is cancelled, not confirmed", (await bookingStatus(loser)) === "cancelled");
    check("the winning booking is untouched", (await bookingStatus(winner)) === "confirmed");
    const loserPayments = await paymentRows(loser);
    check(
      "the payment is still recorded so it can be refunded",
      loserPayments.length === 1 && loserPayments[0].status === "succeeded",
      JSON.stringify(loserPayments)
    );

    // -----------------------------------------------------------------
    console.log("\n=== expiry and failure events ===");

    const bookingC = await seedBooking(USER_A, seats[3]);
    await holdSeats(SHOW_ID, [seats[3]], USER_A);
    const expRes = await post(url, expiredEvent(bookingC, `cs_exp_${randomUUID().slice(0, 8)}`));
    check("an expired session is accepted", expRes.status === 200, `got ${expRes.status}`);
    check("the booking is marked expired", (await bookingStatus(bookingC)) === "expired");
    const holdAfterExpiry = await getSeatHolders(SHOW_ID, [seats[3]]);
    check(
      "and the hold is released immediately rather than waiting out the TTL",
      holdAfterExpiry.size === 0
    );

    // -----------------------------------------------------------------
    console.log("\n=== stale booking sweep ===");

    const stale = await seedBooking(USER_A, seats[4]);
    await getPool().query(
      `update encore_bookings set created_at = now() - interval '3 hours' where id = $1`,
      [stale]
    );
    const sweptCount = await bookingService.expireStaleBookings(60);
    check("the sweep expires an abandoned pending booking", sweptCount >= 1, `${sweptCount} swept`);
    check("and it is now expired", (await bookingStatus(stale)) === "expired");

    const fresh = await seedBooking(USER_A, seats[5]);
    await bookingService.expireStaleBookings(60);
    check(
      "but leaves a recent pending booking alone, since its session may still be payable",
      (await bookingStatus(fresh)) === "pending"
    );
  } finally {
    console.log("\n=== cleanup ===");
    server.close();

    await releaseSeats(SHOW_ID, seats, USER_A).catch(() => undefined);
    await releaseSeats(SHOW_ID, seats, USER_B).catch(() => undefined);

    if (createdBookings.length > 0) {
      // Foreign-key order: payments and seat rows reference the booking.
      await getPool().query(`delete from encore_payments where booking_id = any($1)`, [createdBookings]);
      await getPool().query(`delete from encore_booking_seats where booking_id = any($1)`, [createdBookings]);
      await getPool().query(`delete from encore_bookings where id = any($1)`, [createdBookings]);
    }
    await getPool().query(`delete from encore_users where id = any($1)`, [[USER_A, USER_B]]);

    const { rows: leftover } = await getPool().query<{ n: string }>(
      `select count(*) n from encore_bookings where user_id = any($1)`,
      [[USER_A, USER_B]]
    );
    console.log(`  removed ${createdBookings.length} booking(s); leftover: ${leftover[0].n}`);

    const holdsLeft = await getSeatHolders(SHOW_ID, seats).catch(() => new Map());
    console.log(`  leftover holds: ${holdsLeft.size}`);

    await disconnectRedis();
    await closePool();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`\nFailed: ${err.message}`);
  console.error(err.stack);
  await disconnectRedis().catch(() => undefined);
  await closePool().catch(() => undefined);
  process.exit(1);
});
