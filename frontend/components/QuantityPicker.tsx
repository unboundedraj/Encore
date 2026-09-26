"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { checkoutQuantity, holdQuantity } from "@/lib/checkout-api";
import { formatCurrency } from "@/lib/utils";

interface QuantityPickerProps {
  /** total_capacity minus confirmed bookings and other people's live holds, computed server-side. */
  availableCapacity: number;
  pricePerTicket: number;
  showId: string;
}

/** Arbitrary per-order cap so one person can't select the entire remaining inventory. */
const MAX_PER_ORDER = 10;

/**
 * Unlike SeatMap, this never holds anything until the moment checkout is
 * requested. There is no discrete unit for a shopper to "try" the way there
 * is with an individual seat -- adjusting a quantity stepper is not a claim on
 * anything specific. Holding eagerly here would only mean every visitor who
 * so much as loads the page (or nudges the stepper) reserves real capacity for
 * up to seven minutes, silently starving concurrent shoppers for no reason.
 * hold and checkout are therefore requested back to back, right here, only
 * once the shopper has actually committed to buying.
 */
export function QuantityPicker({ availableCapacity, pricePerTicket, showId }: QuantityPickerProps) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const soldOut = availableCapacity <= 0;
  const maxSelectable = Math.min(MAX_PER_ORDER, availableCapacity);
  const [quantity, setQuantity] = useState(soldOut ? 0 : 1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const total = quantity * pricePerTicket;

  async function handleCheckout() {
    if (quantity < 1 || submitting) return;
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // Two calls, deliberately sequential: hold has to land in Redis before
      // checkout re-verifies against it, and checkout would otherwise reject
      // its own request with "you don't hold what you're claiming."
      await holdQuantity(showId, quantity);
      const session = await checkoutQuantity(showId, quantity);
      window.location.href = session.checkout_url;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // The hold call's own conflict message already names how many are
        // actually left ("Only 3 tickets left."), so it is shown verbatim
        // rather than replaced with something generic.
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div>
      {soldOut ? (
        <p
          role="status"
          className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          Sold out.
        </p>
      ) : (
        <>
          <p className="text-sm text-black/55 dark:text-white/55">
            {availableCapacity} ticket{availableCapacity === 1 ? "" : "s"} available
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1 || submitting}
              aria-label="Decrease quantity"
              className="h-9 w-9 rounded-md border border-black/15 text-lg leading-none disabled:opacity-30 dark:border-white/20"
            >
              &minus;
            </button>
            <span className="w-8 text-center text-sm font-medium" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(maxSelectable, q + 1))}
              disabled={quantity >= maxSelectable || submitting}
              aria-label="Increase quantity"
              className="h-9 w-9 rounded-md border border-black/15 text-lg leading-none disabled:opacity-30 dark:border-white/20"
            >
              +
            </button>
            {quantity >= maxSelectable && maxSelectable < availableCapacity ? (
              <span className="text-xs text-black/40 dark:text-white/40">
                Max {MAX_PER_ORDER} per order
              </span>
            ) : null}
          </div>
        </>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-between border-t border-black/10 pt-4 dark:border-white/15">
        <div>
          <p className="text-sm text-black/55 dark:text-white/55">
            {quantity} ticket{quantity === 1 ? "" : "s"}
          </p>
          <p className="text-lg font-semibold">{formatCurrency(total)}</p>
        </div>
        <button
          type="button"
          disabled={quantity < 1 || submitting}
          onClick={handleCheckout}
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Starting checkout…" : "Proceed to checkout"}
        </button>
      </div>
    </div>
  );
}
