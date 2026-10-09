"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type { BookingDetail, Content } from "shared";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { fetchBooking } from "@/lib/checkout-api";
import { fetchContentById } from "@/lib/content-api";
import { formatCurrency } from "@/lib/utils";

const TIME_ZONE = "Asia/Kolkata";
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** How long to poll before telling the user it is taking a while rather than failed. */
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 1500;

type Outcome =
  | { kind: "loading" }
  | { kind: "confirmed"; booking: BookingDetail; content: Content | null }
  | { kind: "seats_lost"; booking: BookingDetail }
  | { kind: "still_pending" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * Polls rather than trusting the redirect alone.
 *
 * Stripe sends the browser back here the instant its own checkout session
 * completes, which can arrive before -- or race -- the webhook that actually
 * confirms the booking in Postgres. Reading local state instead of the server
 * would risk showing "success" for a booking that a moment later loses the
 * seat race and gets refunded (see webhook.controller.ts). This page shows
 * nothing as confirmed until the backend says so.
 */
function useBookingOutcome(bookingId: string | null, enabled: boolean): Outcome {
  // Computed once, from the render that first mounts this hook, rather than
  // set synchronously inside the effect below -- that keeps the effect body
  // free of any setState call that isn't a response to something async.
  //
  // It depends on the URL alone, never on `enabled`. `enabled` is false while
  // Firebase is still restoring the session, which on a slow network is a real
  // window -- and since this initializer never runs again, gating it on auth
  // would freeze "not found" into the state for a booking that is simply
  // waiting for a sign-in to resolve, until the first poll finally answered.
  const [outcome, setOutcome] = useState<Outcome>(() =>
    bookingId ? { kind: "loading" } : { kind: "not_found" }
  );
  const attempts = useRef(0);

  useEffect(() => {
    if (!bookingId || !enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const booking = await fetchBooking(bookingId as string);
        if (cancelled) return;

        if (booking.status === "confirmed") {
          const content = await fetchContentById(booking.content_id).catch(() => null);
          if (!cancelled) setOutcome({ kind: "confirmed", booking, content });
          return;
        }
        if (booking.status === "cancelled") {
          // The specific outcome of losing the seat race after paying -- the
          // webhook already recorded the payment and started a refund.
          if (!cancelled) setOutcome({ kind: "seats_lost", booking });
          return;
        }

        attempts.current += 1;
        if (attempts.current >= POLL_ATTEMPTS) {
          if (!cancelled) setOutcome({ kind: "still_pending" });
          return;
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setOutcome({ kind: "not_found" });
        } else {
          setOutcome({ kind: "error", message: err instanceof Error ? err.message : "Something went wrong." });
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bookingId, enabled]);

  return outcome;
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function BookingSummary({ booking, content }: { booking: BookingDetail; content: Content | null }) {
  return (
    <div className="mt-6 rounded-lg bg-surface p-5 text-left shadow-sm">
      {content ? <p className="font-medium">{content.title}</p> : null}
      <SummaryRow
        label="When"
        value={dateTimeFormatter.format(new Date(booking.start_time))}
      />
      <SummaryRow
        label="Where"
        value={[booking.venue_name, booking.screen_name, booking.city].filter(Boolean).join(" · ")}
      />
      {booking.seats ? (
        <SummaryRow
          label={booking.seats.length === 1 ? "Seat" : "Seats"}
          value={booking.seats.map((s) => `${s.row_label}${s.seat_number}`).join(", ")}
        />
      ) : (
        <SummaryRow label="Tickets" value={booking.quantity} />
      )}
      <SummaryRow label="Paid" value={formatCurrency(booking.total_amount)} />
    </div>
  );
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  const { user, loading: authLoading } = useAuth();
  const outcome = useBookingOutcome(bookingId, Boolean(user));

  if (authLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (!user) {
    // A relative path, including its query string, is what AuthForm's `next`
    // accepts -- this is what lets a sign-in interruption still land back on
    // this exact confirmation afterwards, booking_id and all.
    const returnTo = `/checkout/success?${searchParams.toString()}`;
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to view your confirmation</h1>
        <p className="mt-2 text-sm text-muted">
          Your payment went through. Sign back in with the same account to see it.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(returnTo)}`}
          className="mt-6 inline-block rounded-md bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-dark"
        >
          Sign in
        </Link>
      </div>
    );
  }

  switch (outcome.kind) {
    case "loading":
      return (
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Confirming your booking…</h1>
          <p className="mt-2 text-sm text-muted">
            Payment received. This usually takes a couple of seconds.
          </p>
        </div>
      );

    case "confirmed":
      return (
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ok">
            You&rsquo;re booked!
          </h1>
          <p className="mt-2 text-sm text-muted">
            A confirmation is on your account. Enjoy the show.
          </p>
          <BookingSummary booking={outcome.booking} content={outcome.content} />
          <Link
            href="/browse"
            className="mt-6 inline-block text-sm underline underline-offset-4 hover:opacity-70"
          >
            Back to browse
          </Link>
        </div>
      );

    case "seats_lost":
      return (
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">We couldn&rsquo;t hold your seats</h1>
          <p className="mt-2 text-sm text-muted">
            Someone else completed their booking for the same seats moments before yours. Your payment
            of {formatCurrency(outcome.booking.total_amount)} is being refunded and should appear on your
            statement shortly.
          </p>
          <Link
            href={`/shows/${outcome.booking.show_id}`}
            className="mt-6 inline-block rounded-md bg-accent px-6 py-3 text-sm font-semibold text-white hover:bg-accent-dark"
          >
            Choose different seats
          </Link>
        </div>
      );

    case "still_pending":
      return (
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
          <p className="mt-2 text-sm text-muted">
            Your payment was received and we&rsquo;re still finalising the booking. This can occasionally
            take a minute -- refreshing this page will pick it up as soon as it&rsquo;s ready.
          </p>
        </div>
      );

    case "not_found":
      return (
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">We couldn&rsquo;t find that booking</h1>
          <p className="mt-2 text-sm text-muted">
            The link looks incomplete or belongs to a different account.
          </p>
        </div>
      );

    case "error":
      return (
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">{outcome.message}</p>
        </div>
      );
  }
}

export default function CheckoutSuccessPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-6 py-16">
      <Suspense fallback={null}>
        <SuccessContent />
      </Suspense>
    </main>
  );
}
