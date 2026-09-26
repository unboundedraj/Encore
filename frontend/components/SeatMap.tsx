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

/**
 * Contiguous blocks of rows that share a seat type, top to bottom.
 *
 * The seat map renders the screen at the bottom, so row A is the back of the
 * hall -- which is where the expensive block sits in an Indian multiplex.
 * There are only two seat types in the schema, so there are at most two zones;
 * this groups rather than hardcodes that, so a layout with the premium rows
 * somewhere else still renders correctly.
 */
function toZones(rows: [string, SeatWithStatus[]][]): {
  seatType: "standard" | "premium";
  rows: [string, SeatWithStatus[]][];
}[] {
  const zones: { seatType: "standard" | "premium"; rows: [string, SeatWithStatus[]][] }[] = [];
  for (const row of rows) {
    const seatType = row[1][0]?.seat_type ?? "standard";
    const last = zones[zones.length - 1];
    if (last && last.seatType === seatType) last.rows.push(row);
    else zones.push({ seatType, rows: [row] });
  }
  return zones;
}

const ZONE_LABELS: Record<"standard" | "premium", string> = {
  premium: "Premium",
  standard: "Classic",
};

function statusLabel(status: SeatStatus): string {
  switch (status) {
    case "booked":
      return "sold";
    case "held_by_other":
      return "temporarily held by another customer";
    case "held_by_you":
      return "selected";
    default:
      return "available";
  }
}

function seatClassName(status: SeatStatus, isPending: boolean): string {
  const base =
    "flex h-6 w-6 items-center justify-center rounded-[4px] border text-[9px] font-medium transition-colors sm:h-7 sm:w-7 sm:text-[10px]";
  if (isPending) return `${base} cursor-wait border-hairline bg-hairline text-muted/50`;
  switch (status) {
    case "booked":
      return `${base} cursor-not-allowed border-transparent bg-hairline text-muted/40`;
    case "held_by_other":
      // Distinct from sold and animated, so it reads as "temporary, might free
      // up" rather than permanently gone.
      return `${base} animate-pulse cursor-not-allowed border-warn/40 bg-warn/20 text-warn`;
    case "held_by_you":
      return `${base} border-ok bg-ok text-white`;
    default:
      return `${base} border-ok/50 bg-white text-ok hover:bg-ok/10`;
  }
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-3.5 w-3.5 rounded-[3px] border ${swatch}`} />
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
  const zones = useMemo(() => toZones(rows), [rows]);
  // Sized from the data rather than assumed, so a screen with a different
  // layout still lines seats up into columns correctly.
  const columns = useMemo(() => Math.max(1, ...seatList.map((s) => s.seat_number)), [seatList]);
  // A visual centre aisle, purely presentational -- it has no effect on which
  // seats exist or can be booked, only where the gap in the row renders.
  const aisleAfter = columns >= 8 ? Math.ceil(columns / 2) : null;

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
  const toggle = useCallback(
    async (seat: SeatWithStatus) => {
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
            const next2 = new Set(prev);
            next2.delete(seat.id);
            return next2;
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
          setError(`Seat ${seat.row_label}${seat.seat_number} was just taken by someone else.`);
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
    },
    [displayStatus, pending, selected, user, router, pathname, showId]
  );

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
  const selectedLabels = useMemo(
    () =>
      seatList
        .filter((s) => selected.has(s.id))
        .sort((a, b) => a.row_label.localeCompare(b.row_label) || a.seat_number - b.seat_number)
        .map((s) => `${s.row_label}${s.seat_number}`),
    [seatList, selected]
  );

  return (
    <div className="pb-28">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pb-5">
        <Legend swatch="border-ok/50 bg-white" label="Available" />
        <Legend swatch="border-ok bg-ok" label="Selected" />
        <Legend swatch="border-warn/40 bg-warn/20" label="Being booked" />
        <Legend swatch="border-transparent bg-hairline" label="Sold" />
      </div>

      {/* The hall. Horizontally scrollable, because a 20-seat row does not fit
          a phone and squeezing it would make the seats untappable. */}
      {/* w-max, not min-w-full: the block must size to its own content so the
          auto margins can centre it when the hall is narrower than the page,
          while still overflowing into a scroll when it is wider. */}
      <div className="overflow-x-auto pb-4 no-scrollbar">
        <div className="mx-auto w-max px-2">
          {zones.map((zone, zoneIndex) => (
            <div key={`${zone.seatType}-${zoneIndex}`} className="mb-5">
              <div className="mb-2 flex items-center gap-3">
                <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {ZONE_LABELS[zone.seatType]} — {formatCurrency(pricePerSeat)}
                </span>
                <span className="h-px flex-1 bg-hairline" />
              </div>

              <div className="flex flex-col items-center gap-1.5">
                {zone.rows.map(([rowLabel, rowSeats]) => (
                  <div key={rowLabel} className="flex items-center gap-2">
                    <span className="w-4 shrink-0 text-right text-[10px] font-medium text-muted">
                      {rowLabel}
                    </span>

                    <div className="flex items-center gap-1">
                      {rowSeats.map((seat) => {
                        const status = displayStatus(seat);
                        const isPending = pending.has(seat.id);
                        const isAisle = aisleAfter !== null && seat.seat_number === aisleAfter;
                        return (
                          <div key={seat.id} style={{ marginRight: isAisle ? "1.25rem" : undefined }}>
                            <button
                              type="button"
                              disabled={status === "booked" || status === "held_by_other" || isPending}
                              aria-busy={isPending}
                              onClick={() => toggle(seat)}
                              aria-pressed={status === "held_by_you"}
                              aria-label={`Row ${seat.row_label} seat ${seat.seat_number}, ${seat.seat_type}, ${statusLabel(status)}`}
                              className={seatClassName(status, isPending)}
                            >
                              {seat.seat_number}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <span className="w-4 shrink-0 text-left text-[10px] font-medium text-muted">
                      {rowLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Screen, at the bottom -- which is where a cinema booking flow puts
              it, so row A reads as the back of the hall. */}
          <div className="mx-auto mt-8 flex max-w-xl flex-col items-center px-4">
            <div
              className="h-2.5 w-full bg-linear-to-b from-foreground/25 to-transparent"
              style={{ borderRadius: "50% 50% 0 0 / 100% 100% 0 0" }}
              aria-hidden="true"
            />
            <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-muted">
              All eyes this way please
            </span>
          </div>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mx-auto mt-4 max-w-xl rounded-md bg-accent/10 px-3 py-2 text-center text-sm text-accent-dark"
        >
          {error}
        </p>
      ) : null}

      {/* Sticky summary bar. A 280-seat hall means the top of the page is far
          away by the time you have picked, so the total and the CTA follow. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {selected.size === 0
                ? "Select your seats"
                : `${selected.size} seat${selected.size === 1 ? "" : "s"} · ${selectedLabels.join(", ")}`}
            </p>
            <p className="text-xs text-muted">
              {selected.size > 0 ? (
                <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
              ) : (
                <span>{formatCurrency(pricePerSeat)} per seat</span>
              )}
              {remainingSeconds !== null ? (
                <span className="ml-2 tabular-nums">
                  · held for {formatCountdown(remainingSeconds)}
                </span>
              ) : null}
            </p>
          </div>

          <button
            type="button"
            disabled={selected.size === 0 || submitting}
            onClick={handleCheckout}
            className="shrink-0 rounded-md bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:bg-hairline disabled:text-muted"
          >
            {submitting ? "Starting checkout…" : selected.size === 0 ? "Pay" : `Pay ${formatCurrency(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
