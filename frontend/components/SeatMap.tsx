"use client";

import { useMemo, useState } from "react";
import type { SeatWithStatus } from "shared";
import { formatCurrency } from "@/lib/utils";

interface SeatMapProps {
  /** Fetched server-side alongside the show; this component never refetches on mount. */
  seats: SeatWithStatus[];
  pricePerSeat: number;
}

/**
 * Seats arrive from the API already ordered by row_label, seat_number, but
 * grouping and re-sorting here means this component's correctness does not
 * quietly depend on that ordering holding forever.
 */
function groupByRow(seats: SeatWithStatus[]): [string, SeatWithStatus[]][] {
  const map = new Map<string, SeatWithStatus[]>();
  for (const seat of seats) {
    const list = map.get(seat.row_label);
    if (list) list.push(seat);
    else map.set(seat.row_label, [seat]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([row, list]) => [row, [...list].sort((a, b) => a.seat_number - b.seat_number)]);
}

function Legend({ swatchClassName, label }: { swatchClassName: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded ${swatchClassName}`} />
      {label}
    </span>
  );
}

export function SeatMap({ seats, pricePerSeat }: SeatMapProps) {
  const rows = useMemo(() => groupByRow(seats), [seats]);
  // Sized from the data rather than assumed, so a screen with a different
  // layout still lines seats up into columns correctly.
  const columns = useMemo(() => Math.max(1, ...seats.map((s) => s.seat_number)), [seats]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(seat: SeatWithStatus) {
    if (seat.status !== "available") return; // booked seats are inert, not just styled that way
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seat.id)) next.delete(seat.id);
      else next.add(seat.id);
      return next;
    });
  }

  const total = selected.size * pricePerSeat;

  return (
    <div>
      <div className="flex flex-col gap-2 overflow-x-auto pb-2">
        {rows.map(([rowLabel, rowSeats]) => (
          <div key={rowLabel} className="flex items-center gap-3">
            <span className="w-5 shrink-0 text-xs font-medium text-black/50 dark:text-white/50">
              {rowLabel}
            </span>
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(1.75rem, 1.75rem))` }}
            >
              {rowSeats.map((seat) => {
                const isBooked = seat.status === "booked";
                const isSelected = selected.has(seat.id);
                return (
                  <button
                    key={seat.id}
                    type="button"
                    disabled={isBooked}
                    onClick={() => toggle(seat)}
                    style={{ gridColumnStart: seat.seat_number }}
                    aria-pressed={isSelected}
                    aria-label={`Row ${seat.row_label} seat ${seat.seat_number}, ${seat.seat_type}, ${
                      isBooked ? "booked" : isSelected ? "selected" : "available"
                    }`}
                    className={[
                      "aspect-square rounded text-[10px] font-medium transition-colors",
                      isBooked
                        ? "cursor-not-allowed bg-black/10 text-black/25 dark:bg-white/10 dark:text-white/20"
                        : isSelected
                          ? "bg-foreground text-background"
                          : seat.seat_type === "premium"
                            ? "bg-amber-400/30 text-amber-900 hover:bg-amber-400/50 dark:text-amber-200"
                            : "bg-black/5 text-black/70 hover:bg-black/15 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20",
                    ].join(" ")}
                  >
                    {seat.seat_number}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-black/55 dark:text-white/55">
        <Legend swatchClassName="bg-black/5 dark:bg-white/10" label="Standard" />
        <Legend swatchClassName="bg-amber-400/30" label="Premium" />
        <Legend swatchClassName="bg-foreground" label="Selected" />
        <Legend swatchClassName="bg-black/10 dark:bg-white/10" label="Booked" />
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-black/10 pt-4 dark:border-white/15">
        <div>
          <p className="text-sm text-black/55 dark:text-white/55">
            {selected.size} seat{selected.size === 1 ? "" : "s"} selected
          </p>
          <p className="text-lg font-semibold">{formatCurrency(total)}</p>
        </div>
        <button
          type="button"
          disabled
          title="Checkout needs seat locking, which is the next step"
          className="cursor-not-allowed rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background opacity-40"
        >
          Proceed to checkout
        </button>
      </div>
    </div>
  );
}
