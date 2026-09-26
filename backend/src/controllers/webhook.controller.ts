/**
 * Stripe webhook.
 *
 * This endpoint is public by necessity -- Stripe has to be able to reach it
 * without a token -- so the signature check is the only thing standing between
 * "Stripe says this was paid" and "anyone on the internet says this was paid".
 * It runs before anything else touches the body, and a failure is a flat 400
 * with no detail, because a probe should learn nothing about why it failed.
 *
 * THE ORDER OF OPERATIONS IS THE POINT
 *
 * Postgres commits first; the Redis hold is released only afterwards, and only
 * when the commit actually succeeded. Reversed, a failed commit would leave
 * seats released in Redis with no confirmed booking behind them -- capacity
 * nobody owns, which is how a seat gets sold twice. In the order used here the
 * worst case is a hold that outlives its booking by up to seven minutes, which
 * costs nothing but a slightly pessimistic seat map.
 */

import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe, getWebhookSecret } from "../config/stripe";
import {
  confirmBooking,
  failBooking,
  getBookingForWebhook,
  getBookingSeatIds,
} from "../services/bookingService";
import { releaseGeneralAdmission, releaseSeats } from "../services/lockService";

/**
 * Releases whatever hold backs this booking.
 *
 * Only ever called after a successful database outcome. Failures are logged
 * and swallowed: the hold expires on its own, so a failed release costs a few
 * minutes of inventory, and throwing here would make Stripe retry an event
 * that was already applied.
 */
async function releaseHoldFor(bookingId: string): Promise<void> {
  try {
    const booking = await getBookingForWebhook(bookingId);
    if (!booking) return;

    if (booking.seatingMode === "assigned") {
      const seatIds = await getBookingSeatIds(bookingId);
      await releaseSeats(booking.showId, seatIds, booking.userId);
    } else {
      await releaseGeneralAdmission(booking.showId, booking.userId);
    }
  } catch (err) {
    console.error(
      `[webhook] could not release hold for booking ${bookingId}; it will expire on its own:`,
      err
    );
  }
}

function bookingIdFrom(object: { metadata?: Stripe.Metadata | null; client_reference_id?: string | null }): string | null {
  return object.metadata?.bookingId ?? object.client_reference_id ?? null;
}

/** POST /api/webhooks/stripe -- mounted with a raw body parser, before express.json(). */
export async function handleStripeWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") {
    return res.status(400).json({ error: "Missing stripe-signature header" });
  }
  if (!Buffer.isBuffer(req.body)) {
    // Means the raw-body middleware is not in front of this route. Worth
    // shouting about: signature verification silently cannot work without it.
    console.error("[webhook] body is not raw; the express.raw middleware is missing or out of order");
    return res.status(500).json({ error: "Internal server error" });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, getWebhookSecret());
  } catch (err) {
    console.warn(`[webhook] rejected: ${(err as Error).message}`);
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = bookingIdFrom(session);
        if (!bookingId) {
          console.error(`[webhook] ${event.id} has no bookingId in metadata; ignoring`);
          break;
        }

        // An asynchronous method can complete the session before the money
        // clears. Only a paid session is a confirmation.
        if (session.payment_status !== "paid") {
          console.log(`[webhook] ${event.id} session not yet paid (${session.payment_status}); waiting`);
          break;
        }

        const result = await confirmBooking(bookingId, {
          gatewayPaymentId: session.id,
          amount: session.amount_total ?? 0,
          rawPayload: event,
        });

        // The commit succeeded, so the hold can go. Note this is reached only
        // on these outcomes -- a thrown error skips it entirely, which is the
        // safe direction.
        if (result.outcome === "confirmed" || result.outcome === "already_processed") {
          await releaseHoldFor(bookingId);
          console.log(`[webhook] booking ${bookingId} ${result.outcome}`);
        } else if (result.outcome === "seat_taken") {
          // Paid for seats somebody else confirmed first. The booking is
          // cancelled and the payment recorded; the money must go back.
          await releaseHoldFor(bookingId);
          await refund(session, bookingId);
        } else {
          console.warn(
            `[webhook] booking ${bookingId} was ${result.status}, not confirmable; payment may need review`
          );
        }
        break;
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = bookingIdFrom(session);
        if (!bookingId) break;

        const status = event.type === "checkout.session.expired" ? "expired" : "cancelled";
        await failBooking(bookingId, status, event);
        // Safe to release: no money was taken, so the seats should go back
        // immediately rather than waiting out the TTL.
        await releaseHoldFor(bookingId);
        console.log(`[webhook] booking ${bookingId} marked ${status}`);
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const bookingId = bookingIdFrom(intent);
        if (!bookingId) break;
        await failBooking(bookingId, "cancelled", event);
        await releaseHoldFor(bookingId);
        console.log(`[webhook] booking ${bookingId} cancelled after payment failure`);
        break;
      }

      default:
        // Stripe sends far more than we subscribe to; acknowledging keeps it
        // from retrying events we simply do not act on.
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    // A non-2xx makes Stripe retry with backoff, which is what we want for a
    // transient database failure. Nothing was released, so a retry is safe.
    console.error(`[webhook] handling ${event.id} (${event.type}) failed:`, err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

/**
 * Best-effort refund for money taken against seats we could not deliver.
 *
 * Deliberately never throws: the booking is already cancelled and the payment
 * recorded, so a failed refund is a finance problem to be picked up from the
 * logs, not a reason to make Stripe redeliver an event that was already
 * applied.
 */
async function refund(session: Stripe.Checkout.Session, bookingId: string): Promise<void> {
  const paymentIntent =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  if (!paymentIntent) {
    console.error(
      `[webhook] REFUND REQUIRED for booking ${bookingId}: seats were taken and no payment_intent was present on session ${session.id}`
    );
    return;
  }

  try {
    const created = await getStripe().refunds.create({
      payment_intent: paymentIntent,
      reason: "requested_by_customer",
      metadata: { bookingId, reason: "seats_taken_before_confirmation" },
    });
    console.warn(
      `[webhook] booking ${bookingId}: seats were taken before confirmation; refunded ${created.id}`
    );
  } catch (err) {
    console.error(
      `[webhook] REFUND FAILED for booking ${bookingId} (payment_intent ${paymentIntent}) -- needs manual action:`,
      err
    );
  }
}
