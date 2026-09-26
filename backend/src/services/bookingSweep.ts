/**
 * Periodic cleanup of abandoned pending bookings.
 *
 * See the note on expireStaleBookings for why this is hygiene rather than a
 * correctness mechanism: a stale pending booking reserves nothing, because the
 * unique index only covers confirmed rows and its Redis hold is long gone.
 * Nothing breaks if this never runs; rows just accumulate and a user's history
 * shows checkouts that are permanently "pending".
 *
 * That is precisely why the implementation is a plain interval and not a job
 * queue. The UPDATE is idempotent and scoped by age, so several instances
 * running it at once is harmless, and a missed run is caught by the next one.
 */

import { expireStaleBookings } from "./bookingService";

const SWEEP_INTERVAL_MS = 10 * 60_000;

/**
 * Safe to run on multiple instances at the same time, on this plain a
 * schedule, for three reasons that all have to hold together:
 *   1. The partial unique index that prevents double-booking only covers
 *      `status = 'confirmed'` rows, so a pending row this sweep touches was
 *      never part of that guarantee in the first place.
 *   2. Its Redis hold has already expired well before the 60-minute cutoff
 *      (holds last 7 minutes), so the seats are already free regardless of
 *      what this job does.
 *   3. The UPDATE itself is idempotent -- `WHERE status = 'pending'` means a
 *      second instance racing the same row just updates zero rows instead of
 *      erroring, so there is nothing to lock or coordinate.
 */
export function startBookingSweep(intervalMs = SWEEP_INTERVAL_MS): NodeJS.Timeout {
  const run = () => {
    expireStaleBookings()
      .then((count) => {
        if (count > 0) console.log(`[sweep] expired ${count} abandoned pending booking(s)`);
      })
      .catch((err) => console.error("[sweep] failed:", err));
  };

  // unref so a pending timer never holds the process open on shutdown.
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}
