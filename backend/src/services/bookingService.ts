/**
 * Booking writes. Every function here uses a real Postgres transaction rather
 * than supabase-js, because confirming a booking and recording its payment
 * must either both happen or neither -- and PostgREST cannot express that.
 *
 * THE ORDERING THAT MATTERS
 *
 * Confirmation commits in Postgres *before* the Redis hold is released, and
 * that direction is not interchangeable. If the hold were released first and
 * the commit then failed, the seats would be free in Redis while no confirmed
 * booking existed -- capacity nobody is holding, which is how you oversell.
 * Committing first means the two systems briefly both count the same seats,
 * which only under-reports availability for a moment. One direction is a bug;
 * the other is a rounding error.
 *
 * Releasing the hold is therefore the caller's job, done only after one of
 * these functions has returned successfully. None of them touch Redis.
 */

import type { PoolClient } from "pg";
import { getPool, withTransaction } from "../config/postgres";

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";
/** The partial index that stops two confirmed bookings holding one seat. */
const DOUBLE_BOOK_INDEX = "encore_booking_seats_confirmed_show_id_seat_id_key";
const PAYMENT_GATEWAY_INDEX = "encore_payments_gateway_gateway_payment_id_key";
const PAYMENT_BOOKING_INDEX = "encore_payments_booking_id_key";

export interface PendingBookingInput {
  userId: string;
  showId: string;
  seatingMode: "assigned" | "general";
  /** Assigned seating only. */
  seatIds?: string[];
  /** General admission only. */
  quantity?: number;
  totalAmount: number;
  screenId?: string | null;
}

export interface PendingBooking {
  id: string;
  seatIds: string[];
  quantity: number | null;
  totalAmount: number;
}

/**
 * Creates the booking and, for assigned seating, its seat rows -- all pending.
 *
 * Pending seat rows do not reserve anything: the unique index is scoped to
 * `confirmed`, so two pending bookings may name the same seat. That is
 * deliberate, and it is exactly why the Redis hold exists. This function
 * assumes the caller has already verified the hold.
 */
export async function createPendingBooking(input: PendingBookingInput): Promise<PendingBooking> {
  return withTransaction(async (client) => {
    const booking = await client.query<{ id: string }>(
      `insert into encore_bookings (user_id, show_id, seating_mode, status, quantity, total_amount)
       values ($1, $2, $3, 'pending', $4, $5)
       returning id`,
      [
        input.userId,
        input.showId,
        input.seatingMode,
        input.seatingMode === "general" ? (input.quantity ?? null) : null,
        input.totalAmount,
      ]
    );
    const bookingId = booking.rows[0].id;

    if (input.seatingMode === "assigned") {
      for (const seatId of input.seatIds ?? []) {
        await client.query(
          `insert into encore_booking_seats (booking_id, show_id, screen_id, seat_id)
           values ($1, $2, $3, $4)`,
          [bookingId, input.showId, input.screenId, seatId]
        );
      }
    }

    return {
      id: bookingId,
      seatIds: input.seatIds ?? [],
      quantity: input.seatingMode === "general" ? (input.quantity ?? null) : null,
      totalAmount: input.totalAmount,
    };
  });
}

export interface ExistingPendingBooking {
  id: string;
  seatIds: string[];
  quantity: number | null;
  totalAmount: number;
  gatewayPaymentId: string | null;
  createdAt: Date;
}

/**
 * The caller's live pending booking for this show, if any.
 *
 * Used to make a double-clicked checkout idempotent rather than producing two
 * pending bookings for the same seats.
 */
export async function findPendingBooking(
  userId: string,
  showId: string
): Promise<ExistingPendingBooking | null> {
  const { rows } = await getPool().query<{
    id: string;
    quantity: number | null;
    total_amount: number;
    created_at: Date;
    gateway_payment_id: string | null;
    seat_ids: string[] | null;
  }>(
    `select b.id, b.quantity, b.total_amount, b.created_at,
            p.gateway_payment_id,
            array_remove(array_agg(bs.seat_id), null) as seat_ids
     from encore_bookings b
     left join encore_payments p on p.booking_id = b.id
     left join encore_booking_seats bs on bs.booking_id = b.id
     where b.user_id = $1 and b.show_id = $2 and b.status = 'pending'
     group by b.id, p.gateway_payment_id
     order by b.created_at desc
     limit 1`,
    [userId, showId]
  );

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    seatIds: row.seat_ids ?? [],
    quantity: row.quantity,
    totalAmount: row.total_amount,
    gatewayPaymentId: row.gateway_payment_id,
    createdAt: row.created_at,
  };
}

/**
 * Records the Stripe session against the booking, as a pending payment.
 *
 * gateway_payment_id holds the Checkout Session id rather than the
 * PaymentIntent id. The session id exists at checkout time, before any
 * payment has been attempted, which is what makes it usable both as the
 * idempotency key for webhook delivery and as the handle for resuming a
 * double-clicked checkout. The PaymentIntent is recoverable from
 * raw_webhook_payload when a refund needs one.
 */
export async function recordPendingPayment(
  bookingId: string,
  sessionId: string,
  amount: number
): Promise<void> {
  await getPool().query(
    `insert into encore_payments (booking_id, gateway, gateway_payment_id, status, amount)
     values ($1, 'stripe', $2, 'pending', $3)
     on conflict (booking_id) do update
       set gateway_payment_id = excluded.gateway_payment_id,
           amount = excluded.amount`,
    [bookingId, sessionId, amount]
  );
}

export type ConfirmOutcome =
  /** Booking moved to confirmed and the payment recorded. Safe to release the hold. */
  | { outcome: "confirmed"; bookingId: string }
  /** This event was already applied. Replaying it changed nothing. */
  | { outcome: "already_processed"; bookingId: string }
  /** Someone else confirmed these seats first. Money was taken and needs refunding. */
  | { outcome: "seat_taken"; bookingId: string }
  /** The booking was cancelled or expired before payment landed. */
  | { outcome: "not_confirmable"; bookingId: string; status: string };

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e.code !== UNIQUE_VIOLATION) return false;
  return constraint ? e.constraint === constraint : true;
}

/**
 * Confirms a paid booking and records its payment, atomically.
 *
 * Throwing means the database did not commit, and the caller must NOT release
 * the Redis hold -- leaving a hold to expire on its own costs seven minutes of
 * inventory, whereas releasing one for a payment that was never recorded
 * hands the seat to somebody else while the first buyer's money is gone.
 */
export async function confirmBooking(
  bookingId: string,
  payment: { gatewayPaymentId: string; amount: number; rawPayload: unknown }
): Promise<ConfirmOutcome> {
  try {
    return await withTransaction(async (client) => {
      // Idempotency, checked inside the transaction so two concurrent
      // deliveries of the same event cannot both pass it.
      const existing = await client.query<{ status: string }>(
        `select status from encore_payments
         where gateway = 'stripe' and gateway_payment_id = $1 and status = 'succeeded'`,
        [payment.gatewayPaymentId]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        return { outcome: "already_processed", bookingId } as ConfirmOutcome;
      }

      // FOR UPDATE so a concurrent delivery waits here rather than racing the
      // status transition below.
      const booking = await client.query<{ status: string }>(
        `select status from encore_bookings where id = $1 for update`,
        [bookingId]
      );
      if (booking.rowCount === 0) {
        throw new Error(`Booking ${bookingId} does not exist`);
      }
      const status = booking.rows[0].status;

      if (status === "confirmed") {
        // Already confirmed but the payment row is not marked succeeded --
        // a previous delivery committed the status and died before the
        // payment write. Finish the job rather than treating it as done.
        await upsertSucceededPayment(client, bookingId, payment);
        return { outcome: "already_processed", bookingId } as ConfirmOutcome;
      }
      if (status !== "pending") {
        return { outcome: "not_confirmable", bookingId, status } as ConfirmOutcome;
      }

      // This is where the partial unique index fires: the cascade rewrites
      // every encore_booking_seats row to 'confirmed', and if another
      // confirmed booking already holds one of these seats, it fails here.
      await client.query(`update encore_bookings set status = 'confirmed' where id = $1`, [
        bookingId,
      ]);

      await upsertSucceededPayment(client, bookingId, payment);

      return { outcome: "confirmed", bookingId } as ConfirmOutcome;
    });
  } catch (err) {
    if (isUniqueViolation(err, DOUBLE_BOOK_INDEX)) {
      // Lost the race: the hold lapsed and someone else confirmed these seats
      // while this session was still open. The transaction rolled back, so
      // record the money separately and let the caller refund it.
      await markSeatTaken(bookingId, payment);
      return { outcome: "seat_taken", bookingId };
    }
    if (isUniqueViolation(err, PAYMENT_GATEWAY_INDEX)) {
      // Two deliveries raced past the idempotency check; the index caught the
      // loser. Nothing was double-applied.
      return { outcome: "already_processed", bookingId };
    }
    throw err;
  }
}

async function upsertSucceededPayment(
  client: PoolClient,
  bookingId: string,
  payment: { gatewayPaymentId: string; amount: number; rawPayload: unknown }
): Promise<void> {
  await client.query(
    `insert into encore_payments (booking_id, gateway, gateway_payment_id, status, amount, raw_webhook_payload)
     values ($1, 'stripe', $2, 'succeeded', $3, $4)
     on conflict (booking_id) do update
       set status = 'succeeded',
           gateway_payment_id = excluded.gateway_payment_id,
           amount = excluded.amount,
           raw_webhook_payload = excluded.raw_webhook_payload`,
    [bookingId, payment.gatewayPaymentId, payment.amount, JSON.stringify(payment.rawPayload)]
  );
}

/**
 * Money was taken for seats we could not deliver. Cancel the booking but keep
 * the payment record, because a refund needs something to reconcile against.
 */
async function markSeatTaken(
  bookingId: string,
  payment: { gatewayPaymentId: string; amount: number; rawPayload: unknown }
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`update encore_bookings set status = 'cancelled' where id = $1`, [bookingId]);
    await client.query(
      `insert into encore_payments (booking_id, gateway, gateway_payment_id, status, amount, raw_webhook_payload)
       values ($1, 'stripe', $2, 'succeeded', $3, $4)
       on conflict (booking_id) do update
         set status = 'succeeded',
             raw_webhook_payload = excluded.raw_webhook_payload`,
      [bookingId, payment.gatewayPaymentId, payment.amount, JSON.stringify(payment.rawPayload)]
    );
  }).catch((err) => {
    // Already cancelled, or a payment row conflict -- the booking is not
    // confirmed either way, which is the part that matters.
    if (!isUniqueViolation(err, PAYMENT_BOOKING_INDEX)) throw err;
  });
}

/** Marks a booking cancelled or expired. Idempotent: re-running changes nothing. */
export async function failBooking(
  bookingId: string,
  status: "cancelled" | "expired",
  payload?: unknown
): Promise<boolean> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `update encore_bookings set status = $2 where id = $1 and status = 'pending'`,
      [bookingId, status]
    );

    if (payload !== undefined) {
      await client.query(
        `update encore_payments
         set status = 'failed', raw_webhook_payload = $2
         where booking_id = $1 and status <> 'succeeded'`,
        [bookingId, JSON.stringify(payload)]
      );
    }
    return (result.rowCount ?? 0) > 0;
  });
}

/**
 * Marks long-abandoned pending bookings as expired.
 *
 * WHY A SWEEP AND NOT SOMETHING CLEVERER
 *
 * Correctness does not depend on this running at all. A stale pending booking
 * reserves nothing: the unique index only applies to confirmed rows, and its
 * Redis hold expired long ago, so the seats are already available to
 * everybody. This is hygiene -- it stops abandoned rows sitting in a user's
 * history as permanently "pending" -- not a safety mechanism. That is exactly
 * why a plain periodic UPDATE is enough, and why no locking or coordination
 * between instances is needed: the statement is idempotent, so several
 * instances running it concurrently is harmless.
 *
 * The cutoff is deliberately generous. Stripe Checkout Sessions cannot expire
 * in under 30 minutes, so a booking younger than that may still be legitimately
 * paid. Expiring one early would mean rejecting a payment the customer had
 * every reason to think would work, so the sweep waits well past the point
 * where Stripe itself would have sent `checkout.session.expired`. It is a
 * backstop for webhooks that never arrived, and a backstop must be more
 * conservative than the thing it backs up.
 */
export async function expireStaleBookings(olderThanMinutes = 60): Promise<number> {
  const { rowCount } = await getPool().query(
    `update encore_bookings
     set status = 'expired'
     where status = 'pending'
       and created_at < now() - ($1 || ' minutes')::interval`,
    [String(olderThanMinutes)]
  );
  return rowCount ?? 0;
}

/** Seat ids attached to a booking, for releasing its hold. */
export async function getBookingSeatIds(bookingId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ seat_id: string }>(
    `select seat_id from encore_booking_seats where booking_id = $1`,
    [bookingId]
  );
  return rows.map((r) => r.seat_id);
}

export async function getBookingForWebhook(
  bookingId: string
): Promise<{ id: string; showId: string; userId: string; seatingMode: string } | null> {
  const { rows } = await getPool().query<{
    id: string;
    show_id: string;
    user_id: string;
    seating_mode: string;
  }>(`select id, show_id, user_id, seating_mode from encore_bookings where id = $1`, [bookingId]);

  const row = rows[0];
  if (!row) return null;
  return { id: row.id, showId: row.show_id, userId: row.user_id, seatingMode: row.seating_mode };
}
