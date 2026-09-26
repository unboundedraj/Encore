"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SeatStatus, SeatWithStatus } from "shared";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { checkoutSeats, fetchSeatMapAsViewer, holdSeats, releaseSeats } from "@/lib/checkout-api";
import { formatCurrency } from "@/lib/utils";

interface SeatMapProps {
  /** Fetched server-side alongside the show; this component never refetches on mount for its own sake. */
  seats: SeatWithStatus[];
  pricePerSeat: number;
  showId: string;
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

function statusLabel(status: SeatStatus): string {
  switch (status) {
    case "booked":
      return "booked";
    case "held_by_other":
      return "temporarily held by another customer";
    case "held_by_you":
      return "selected";
    default:
      return "available";
  }
}

function seatClassName(status: SeatStatus, seatType: "standard" | "premium", isPending: boolean): string {
  const base = "aspect-square rounded-t-md text-[10px] font-medium transition-colors";
  if (isPending) return `${base} cursor-wait bg-black/10 text-black/30 dark:bg-white/10 dark:text-white/25`;
  switch (status) {
    case "booked":
      return `${base} cursor-not-allowed bg-black/10 text-black/25 dark:bg-white/10 dark:text-white/20`;
    case "held_by_other":
      // Distinct from booked and animated, so it reads as "temporary, might
      // free up" rather than permanently gone.
      return `${base} cursor-not-allowed animate-pulse bg-orange-400/25 text-orange-700/70 dark:bg-orange-400/15 dark:text-orange-300/70`;
    case "held_by_you":
      return `${base} bg-foreground text-background shadow-sm`;
    default:
      return seatType === "premium"
        ? `${base} bg-amber-400/30 text-amber-900 hover:bg-amber-400/50 dark:text-amber-200`
        : `${base} bg-black/5 text-black/70 hover:bg-black/15 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20`;
  }
}

function Legend({ swatchClassName, label }: { swatchClassName: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded ${swatchClassName}`} />
      {label}
    </span>
  );
}

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SeatMap({ seats: initialSeats, pricePerSeat, showId }: SeatMapProps) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [seatList, setSeatList] = useState(initialSeats);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<Date | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Corrects the anonymous SSR view once we know who is signed in.
   *
   * The server render carries no Firebase token -- there is no such thing as
   * an authenticated SSR fetch in this app -- so it can never attribute a hold
   * to "you" specifically. Without this, reloading the page mid-selection
   * would show your own held seats as taken by a stranger. This runs once,
   * not on a poll: it is correcting a structural blind spot in the initial
   * render, not keeping the view live.
   */
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    fetchSeatMapAsViewer(showId)
      .then(({ items }) => {
        if (cancelled) return;
        setSeatList(items);
        const mine = new Set(items.filter((s) => s.status === "held_by_you").map((s) => s.id));
        if (mine.size > 0) setSelected(mine);
        // We do not know the true remaining TTL of a hold acquired before this
        // page load, so no countdown is started for it. It becomes accurate
        // the moment the user touches any seat, which re-holds (and so
        // refreshes) everything currently selected -- see toggle() below.
      })
      .catch(() => {
        // Non-fatal: the SSR view stands. Worst case a reload briefly
        // mislabels the user's own holds, which self-corrects on interaction.
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, showId]);

  /**
   * Ticks the hold countdown, and clears the selection when it actually runs
   * out. The effect body itself does nothing synchronous -- it only sets up
   * (and tears down) the interval; every state update happens inside the
   * interval's own callback. The starting value is set by whoever calls
   * setHoldExpiresAt in the first place (see toggle() below), not by this
   * effect reacting to it after the fact.
   */
  useEffect(() => {
    if (!holdExpiresAt) return;
    const interval = setInterval(() => {
      const secs = Math.max(0, Math.round((holdExpiresAt.getTime() - Date.now()) / 1000));
      setRemainingSeconds(secs);
      if (secs <= 0) {
        setSelected(new Set());
        setHoldExpiresAt(null);
        setRemainingSeconds(null);
        setError("Your seat hold expired. Please select your seats again.");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [holdExpiresAt]);

  const rows = useMemo(() => groupByRow(seatList), [seatList]);
  // Sized from the data rather than assumed, so a screen with a different
  // layout still lines seats up into columns correctly.
  const columns = useMemo(() => Math.max(1, ...seatList.map((s) => s.seat_number)), [seatList]);
  // A visual centre aisle, purely presentational -- it has no effect on which
  // seats exist or can be booked, only where the gap in the row renders.
  const aisleAfter = columns >= 4 ? Math.ceil(columns / 2) : null;
  const rowCenter = (columns + 1) / 2;

  const displayStatus = useCallback(
    (seat: SeatWithStatus): SeatStatus => (selected.has(seat.id) ? "held_by_you" : seat.status),
    [selected]
  );

  /**
   * Per-seat, immediate hold/release on click -- not batched, and not only at
   * final checkout. Real-time "someone just took that seat" feedback while
   * still browsing is the entire reason the hold layer exists; general
   * admission does not get the same treatment because there is no discrete
   * unit to click, only a quantity (see QuantityPicker).
   */
  const toggle = useCallback(async (seat: SeatWithStatus) => {
    const status = displayStatus(seat);
    if (status === "booked" || status === "held_by_other" || pending.has(seat.id)) return;

    if (!user) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    setError(null);
    setPending((prev) => new Set(prev).add(seat.id));

    if (selected.has(seat.id)) {
      const next = new Set(selected);
      next.delete(seat.id);
      setSelected(next);
      if (next.size === 0) {
        // Nothing left to hold, so the countdown showing time on a hold that
        // no longer exists would be actively misleading -- stop it rather
        // than let it keep ticking down toward an expiry that already
        // stopped mattering.
        setHoldExpiresAt(null);
        setRemainingSeconds(null);
      }
      try {
        await releaseSeats(showId, [seat.id]);
      } catch {
        // Non-fatal: releasing is a courtesy to other shoppers, not a safety
        // requirement. Worst case the hold outlives the deselection by up to
        // its TTL -- see lockService's failure-mode notes for why that is safe.
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(seat.id);
          return next;
        });
      }
      return;
    }

    try {
      const result = await holdSeats(showId, [seat.id]);
      setSelected((prev) => new Set(prev).add(seat.id));
      const expiresAt = new Date(result.expires_at);
      setHoldExpiresAt(expiresAt);
      // Set directly here rather than left for the ticking effect to fill in:
      // that effect intentionally does nothing synchronous, so the display
      // would otherwise sit blank for up to a second before its first tick.
      setRemainingSeconds(Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSeatList((prev) =>
          prev.map((s) => (s.id === seat.id ? { ...s, status: "held_by_other" } : s))
        );
        setError(`Row ${seat.row_label} seat ${seat.seat_number} was just taken by someone else.`);
      } else {
        setError(err instanceof Error ? err.message : "Could not hold that seat. Please try again.");
      }
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(seat.id);
        return next;
      });
    }
  }, [showId, user, router, pathname, selected, pending, displayStatus]);

  async function handleCheckout() {
    if (selected.size === 0 || submitting) return;
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const session = await checkoutSeats(showId, [...selected]);
      // Full navigation, not a router push: Stripe Checkout is hosted on
      // Stripe's own domain.
      window.location.href = session.checkout_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      setSubmitting(false);
    }
  }

  const total = selected.size * pricePerSeat;

  return (
    <div>
      {/* Curved screen indicator. A wide arc with only the top corners rounded
          via an elliptical border-radius reads as a cinema screen without SVG
          path math to get wrong. */}
      <div className="mx-auto mb-9 flex max-w-lg flex-col items-center px-4">
        <div
          className="h-7 w-full border border-b-0 border-black/15 bg-gradient-to-b from-black/[.04] to-transparent dark:border-white/20 dark:from-white/[.06]"
          style={{ borderRadius: "50% 50% 0 0 / 100% 100% 0 0" }}
          aria-hidden="true"
        />
        <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.35em] text-black/35 dark:text-white/35">
          Screen
        </span>
      </div>

      <div className="flex flex-col items-center gap-2 overflow-x-auto pb-2">
        {rows.map(([rowLabel, rowSeats]) => (
          <div key={rowLabel} className="flex items-start gap-3">
            <span className="w-4 shrink-0 pt-1 text-right text-[10px] font-medium text-black/40 dark:text-white/40">
              {rowLabel}
            </span>

            <div className="flex items-start gap-1.5">
              {rowSeats.map((seat) => {
                const status = displayStatus(seat);
                const isPending = pending.has(seat.id);
                const isAisleGap = aisleAfter !== null && seat.seat_number === aisleAfter;
                // A shallow parabola: seats near the row's centre sit closer to
                // the screen, seats at the edges sit further back -- the same
                // curvature stadium seating actually has, at a scale subtle
                // enough to read as intentional rather than broken alignment.
                const distanceFromCenter = Math.abs(seat.seat_number - rowCenter);
                const curveOffsetPx = Math.round(distanceFromCenter * distanceFromCenter * 0.55);

                return (
                  <div
                    key={seat.id}
                    style={{ marginRight: isAisleGap ? "0.85rem" : undefined }}
                  >
                    <button
                      type="button"
                      disabled={status === "booked" || status === "held_by_other" || isPending}
                      aria-busy={isPending}
                      onClick={() => toggle(seat)}
                      style={{ marginTop: `${curveOffsetPx}px`, width: "1.65rem" }}
                      aria-pressed={status === "held_by_you"}
                      aria-label={`Row ${seat.row_label} seat ${seat.seat_number}, ${seat.seat_type}, ${statusLabel(status)}`}
                      className={seatClassName(status, seat.seat_type, isPending)}
                    >
                      {seat.seat_number}
                    </button>
                  </div>
                );
              })}
            </div>

            <span className="w-4 shrink-0 pt-1 text-left text-[10px] font-medium text-black/40 dark:text-white/40">
              {rowLabel}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-black/55 dark:text-white/55">
        <Legend swatchClassName="bg-black/5 dark:bg-white/10" label="Standard" />
        <Legend swatchClassName="bg-amber-400/30" label="Premium" />
        <Legend swatchClassName="bg-foreground" label="Selected" />
        <Legend swatchClassName="animate-pulse bg-orange-400/25" label="Being checked out" />
        <Legend swatchClassName="bg-black/10 dark:bg-white/10" label="Booked" />
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-center text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-between border-t border-black/10 pt-4 dark:border-white/15">
        <div>
          <p className="text-sm text-black/55 dark:text-white/55">
            {selected.size} seat{selected.size === 1 ? "" : "s"} selected
            {remainingSeconds !== null ? (
              <span className="ml-2 tabular-nums text-black/40 dark:text-white/40">
                &middot; hold expires in {formatCountdown(remainingSeconds)}
              </span>
            ) : null}
          </p>
          <p className="text-lg font-semibold">{formatCurrency(total)}</p>
        </div>
        <button
          type="button"
          disabled={selected.size === 0 || submitting}
          onClick={handleCheckout}
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Starting checkout…" : "Proceed to checkout"}
        </button>
      </div>
    </div>
  );
}
