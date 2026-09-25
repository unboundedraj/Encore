"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface QuantityPickerProps {
  /** total_capacity minus confirmed bookings, computed server-side. */
  availableCapacity: number;
  pricePerTicket: number;
}

/** Arbitrary per-order cap so one person can't select the entire remaining inventory. */
const MAX_PER_ORDER = 10;

export function QuantityPicker({ availableCapacity, pricePerTicket }: QuantityPickerProps) {
  const soldOut = availableCapacity <= 0;
  const maxSelectable = Math.min(MAX_PER_ORDER, availableCapacity);
  const [quantity, setQuantity] = useState(soldOut ? 0 : 1);

  const total = quantity * pricePerTicket;

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
              disabled={quantity <= 1}
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
              disabled={quantity >= maxSelectable}
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

      <div className="mt-6 flex items-center justify-between border-t border-black/10 pt-4 dark:border-white/15">
        <div>
          <p className="text-sm text-black/55 dark:text-white/55">
            {quantity} ticket{quantity === 1 ? "" : "s"}
          </p>
          <p className="text-lg font-semibold">{formatCurrency(total)}</p>
        </div>
        <button
          type="button"
          disabled
          title="Checkout needs the locking mechanism, which is the next step"
          className="cursor-not-allowed rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background opacity-40"
        >
          Proceed to checkout
        </button>
      </div>
    </div>
  );
}
