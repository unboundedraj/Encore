/**
 * Stripe client.
 *
 * Initialised lazily, like the Firebase Admin SDK: importing this module must
 * not require credentials, so the server still boots and answers /api/health
 * when Stripe is misconfigured. The failure then surfaces on checkout, where
 * it is actionable, rather than as a process that will not start.
 */

import Stripe from "stripe";
import { env } from "./env";

/**
 * Stripe Checkout Sessions cannot expire sooner than 30 minutes, while a
 * Redis hold lasts 7. The gap is real and deliberate: see the note in
 * services/bookingService.ts on what happens when someone pays after their
 * hold has lapsed.
 */
export const CHECKOUT_SESSION_TTL_MINUTES = 30;

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;

  const key = env.stripeSecretKey;
  if (!key) {
    throw new Error(
      "Missing required environment variable STRIPE_SECRET_KEY. " +
        "Copy backend/.env.example to backend/.env and fill it in."
    );
  }
  if (key.startsWith("sk_live_") && env.nodeEnv !== "production") {
    // A live key outside production is almost always a mistake, and the
    // failure mode is charging real cards from a dev machine.
    throw new Error(
      "Refusing to use a live Stripe key (sk_live_) outside production. Use a test-mode key."
    );
  }

  client = new Stripe(key, {
    // Pinned so a Stripe-side API change cannot alter behaviour without a
    // deliberate bump here. Must match the version this SDK release was built
    // against; the types enforce that, which is how a silent drift gets caught.
    apiVersion: "2026-08-26.dahlia",
    typescript: true,
    maxNetworkRetries: 2,
  });
  return client;
}

export function getWebhookSecret(): string {
  const secret = env.stripeWebhookSecret;
  if (!secret) {
    throw new Error(
      "Missing required environment variable STRIPE_WEBHOOK_SECRET. Without it the " +
        "webhook cannot tell a real Stripe callback from a forged one."
    );
  }
  return secret;
}

/** Exposed so tests can reset the memoised client between key changes. */
export function resetStripeClient(): void {
  client = null;
}
