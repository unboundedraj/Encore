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
    <div className="mx-auto max-w-md">
      <div className="rounded-lg bg-surface p-6 shadow-sm">
        {soldOut ? (
          <p role="status" className="rounded-md bg-accent/10 px-3 py-3 text-center text-sm font-medium text-accent-dark">
            Sold out
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">General admission</span>
              <span className="text-sm font-semibold text-accent">
                {formatCurrency(pricePerTicket)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {availableCapacity.toLocaleString("en-IN")} ticket
              {availableCapacity === 1 ? "" : "s"} available
            </p>

            <div className="mt-5 flex items-center justify-center gap-5">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1 || submitting}
                aria-label="Decrease quantity"
                className="h-10 w-10 rounded-full border border-hairline text-xl leading-none text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-hairline disabled:hover:text-foreground"
              >
                &minus;
              </button>
              <span className="w-10 text-center text-2xl font-bold tabular-nums" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(maxSelectable, q + 1))}
                disabled={quantity >= maxSelectable || submitting}
                aria-label="Increase quantity"
                className="h-10 w-10 rounded-full border border-hairline text-xl leading-none text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-30 disabled:hover:border-hairline disabled:hover:text-foreground"
              >
                +
              </button>
            </div>

            {quantity >= maxSelectable && maxSelectable < availableCapacity ? (
              <p className="mt-3 text-center text-xs text-muted">
                Maximum {MAX_PER_ORDER} tickets per order
              </p>
            ) : null}
          </>
        )}

        {error ? (
          <p role="alert" className="mt-4 rounded-md bg-accent/10 px-3 py-2 text-sm text-accent-dark">
            {error}
          </p>
        ) : null}

        <div className="mt-6 border-t border-hairline pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">
              {quantity} ticket{quantity === 1 ? "" : "s"}
            </span>
            <span className="text-xl font-bold">{formatCurrency(total)}</span>
          </div>

          <button
            type="button"
            disabled={quantity < 1 || submitting}
            onClick={handleCheckout}
            className="mt-4 w-full rounded-md bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:bg-hairline disabled:text-muted"
          >
            {submitting ? "Starting checkout…" : `Pay ${formatCurrency(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
