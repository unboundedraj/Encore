/**
 * Turning a Redis hold into a paid booking.
 *
 * The hold is re-checked against Redis rather than trusted from the request
 * body. A client that says "I hold A1, A2" is making a claim about somebody
 * else's state; believing it would let anyone check out seats they never
 * reserved, which is the whole point of having a hold layer.
 */

import type { Request, Response } from "express";
import type Stripe from "stripe";
import { env } from "../config/env";
import { CHECKOUT_SESSION_TTL_MINUTES, getStripe } from "../config/stripe";
import {
  createPendingBooking,
  failBooking,
  findPendingBooking,
  recordPendingPayment,
} from "../services/bookingService";
import { getSeatHolders, readGeneralHolds } from "../services/lockService";
import { getShowDetail, isValidShowId } from "../services/showService";

const CURRENCY = "inr";

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
}

function isStripeMisconfigured(err: unknown): boolean {
  const message = (err as { message?: string }).message ?? "";
  return /STRIPE_SECRET_KEY|Refusing to use a live Stripe key/.test(message);
}

/**
 * POST /api/shows/:showId/checkout   (requireAuth + ensureUserRecord)
 *
 * ensureUserRecord is not optional here: encore_bookings.user_id is a foreign
 * key to encore_users, so a first-time buyer without a provisioned row would
 * fail on insert. The hold endpoints deliberately skip it, because a hold
 * touches no foreign key.
 */
export async function createCheckout(req: Request, res: Response) {
  const { showId } = req.params;
  const userId = req.user?.uid;

  if (!userId) {
    console.error("[checkout] reached without requireAuth");
    return res.status(500).json({ error: "Internal server error" });
  }
  if (!isValidShowId(showId)) return res.status(404).json({ error: "Show not found" });

  const body = req.body as { seatIds?: unknown; quantity?: unknown };
  const wantsSeats = body.seatIds !== undefined;
  const wantsQuantity = body.quantity !== undefined;
  if (wantsSeats === wantsQuantity) {
    return res.status(400).json({
      error: "Provide exactly one of seatIds (assigned seating) or quantity (general admission).",
    });
  }

  try {
    const show = await getShowDetail(showId, userId);
    if (!show) return res.status(404).json({ error: "Show not found" });

    if (show.seating_mode === "assigned" && !wantsSeats) {
      return res.status(400).json({ error: "This show uses assigned seating. Send seatIds." });
    }
    if (show.seating_mode === "general" && !wantsQuantity) {
      return res.status(400).json({ error: "This show is general admission. Send quantity." });
    }

    // --- verify the hold actually exists, in Redis, for this user ---
    let seatIds: string[] = [];
    let quantity: number | null = null;

    if (show.seating_mode === "assigned") {
      const raw = body.seatIds;
      if (!Array.isArray(raw) || raw.length === 0 || !raw.every((s) => typeof s === "string")) {
        return res.status(400).json({ error: "seatIds must be a non-empty array of seat ids." });
      }
      seatIds = [...new Set(raw as string[])];

      const holders = await getSeatHolders(showId, seatIds);
      const notHeld = seatIds.filter((id) => holders.get(id) !== userId);
      if (notHeld.length > 0) {
        return res.status(409).json({
          error:
            "Your hold on some of these seats has expired or belongs to someone else. Pick your seats again.",
          seat_ids: notHeld,
        });
      }
    } else {
      const raw = body.quantity;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
        return res.status(400).json({ error: "quantity must be a positive integer." });
      }
      quantity = raw;

      const holds = await readGeneralHolds(showId, userId);
      if (holds.heldByYou !== quantity) {
        return res.status(409).json({
          error:
            holds.heldByYou === 0
              ? "Your hold has expired. Choose your tickets again."
              : `You are holding ${holds.heldByYou} ticket(s), not ${quantity}. Re-select and try again.`,
          held: holds.heldByYou,
        });
      }
    }

    const unitCount = show.seating_mode === "assigned" ? seatIds.length : (quantity ?? 0);
    const totalAmount = unitCount * show.price;

    // --- double-click handling ---
    //
    // A second click must not produce a second pending booking for the same
    // seats. Three cases, and they want different answers:
    //   - same selection, session still open  -> hand back the same session
    //   - same selection, session gone        -> new session, same booking
    //   - different selection                 -> the old one is superseded
    // Rejecting outright would be the wrong call: a double-click is the user
    // being impatient, not making a mistake, and an error would be confusing.
    const existing = await findPendingBooking(userId, showId);
    let bookingId: string | null = null;

    if (existing) {
      const matches =
        show.seating_mode === "assigned"
          ? sameSet(existing.seatIds, seatIds)
          : existing.quantity === quantity;

      if (matches && existing.gatewayPaymentId) {
        const session = await getStripe()
          .checkout.sessions.retrieve(existing.gatewayPaymentId)
          .catch(() => null);
        if (session?.status === "open" && session.url) {
          return res.status(200).json({
            booking_id: existing.id,
            checkout_url: session.url,
            amount: existing.totalAmount,
            reused: true,
          });
        }
        if (session?.status === "complete") {
          return res.status(409).json({
            error: "This booking has already been paid for.",
            booking_id: existing.id,
          });
        }
      }

      if (matches) {
        bookingId = existing.id; // reuse the row, issue a fresh session
      } else {
        // The user changed their selection; the old pending booking is dead.
        await failBooking(existing.id, "cancelled");
      }
    }

    if (!bookingId) {
      const created = await createPendingBooking({
        userId,
        showId,
        seatingMode: show.seating_mode,
        seatIds,
        quantity: quantity ?? undefined,
        totalAmount,
        screenId: show.seating_mode === "assigned" ? show.screen.id : null,
      });
      bookingId = created.id;
    }

    // --- Stripe session ---
    const description =
      show.seating_mode === "assigned"
        ? `${unitCount} seat${unitCount === 1 ? "" : "s"} at ${show.venue.name}`
        : `${unitCount} ticket${unitCount === 1 ? "" : "s"} at ${show.venue.name}`;

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: unitCount,
          price_data: {
            currency: CURRENCY,
            unit_amount: show.price,
            product_data: { name: "Encore booking", description },
          },
        },
      ],
      // The webhook finds the booking by this. client_reference_id carries the
      // same value so it is visible in the Stripe dashboard without digging
      // into metadata.
      metadata: { bookingId, showId, userId },
      payment_intent_data: { metadata: { bookingId, showId, userId } },
      client_reference_id: bookingId,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_MINUTES * 60,
      // bookingId is embedded directly (known synchronously here) rather than
      // relying solely on Stripe's {CHECKOUT_SESSION_ID} templating, so the
      // success page can look up the booking without a round trip through
      // Stripe first.
      success_url: `${env.frontendUrl}/checkout/success?booking_id=${bookingId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.frontendUrl}/checkout/cancelled?booking_id=${bookingId}&show_id=${showId}`,
    });

    // Recorded after the session exists so gateway_payment_id is never a
    // placeholder. If this write fails the webhook can still find the booking
    // through metadata and will insert the payment row itself.
    await recordPendingPayment(bookingId, session.id, totalAmount);

    return res.status(200).json({
      booking_id: bookingId,
      checkout_url: session.url,
      amount: totalAmount,
      expires_at: new Date((session.expires_at ?? 0) * 1000).toISOString(),
      reused: false,
    });
  } catch (err) {
    if (isStripeMisconfigured(err)) {
      console.error("[checkout] Stripe is not configured:", err);
      return res.status(503).json({ error: "Payments are not configured. Please try again later." });
    }
    const stripeErr = err as Stripe.errors.StripeError;
    if (stripeErr?.type?.startsWith?.("Stripe")) {
      console.error(`[checkout] Stripe error (${stripeErr.type}): ${stripeErr.message}`);
      return res.status(502).json({ error: "Could not reach the payment provider. Please retry." });
    }
    console.error("[checkout] failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
