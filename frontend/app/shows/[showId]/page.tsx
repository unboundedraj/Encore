import Link from "next/link";
import { notFound } from "next/navigation";
import { QuantityPicker } from "@/components/QuantityPicker";
import { SeatMap } from "@/components/SeatMap";
import { fetchSeatMap, fetchShowDetail } from "@/lib/show-api";
import { formatCurrency } from "@/lib/utils";

type Params = Promise<{ showId: string }>;

// Matches ShowtimesList -- see the note there about this being hardcoded.
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

export async function generateMetadata({ params }: { params: Params }) {
  const { showId } = await params;
  const show = await fetchShowDetail(showId);
  if (!show) return { title: "Not found · Encore" };
  return { title: `${dateTimeFormatter.format(new Date(show.start_time))} · ${show.venue.name} · Encore` };
}

/**
 * Server component: fetches show + (for assigned seating) the seat map, then
 * hands both to a client component as props. The seat map needs to be a
 * client component for interactive selection, but it starts with real data
 * from this request rather than fetching again after mount.
 */
export default async function ShowDetailPage({ params }: { params: Params }) {
  const { showId } = await params;
  const show = await fetchShowDetail(showId);
  if (!show) notFound();

  const seats = show.seating_mode === "assigned" ? await fetchSeatMap(showId) : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <Link
        href={`/content/${show.content_id}`}
        className="text-sm text-black/55 underline underline-offset-4 hover:text-foreground dark:text-white/55"
      >
        &larr; Back to details
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {dateTimeFormatter.format(new Date(show.start_time))}
      </h1>
      <p className="mt-1 text-sm text-black/55 dark:text-white/55">
        {[
          show.venue.name,
          show.seating_mode === "assigned" ? show.screen.name : null,
          show.venue.city,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="mt-1 text-sm text-black/55 dark:text-white/55">
        {formatCurrency(show.price)} {show.seating_mode === "assigned" ? "per seat" : "per ticket"}
      </p>

      <div className="mt-8">
        {show.seating_mode === "assigned" ? (
          <SeatMap seats={seats ?? []} pricePerSeat={show.price} />
        ) : (
          <QuantityPicker availableCapacity={show.available_capacity} pricePerTicket={show.price} />
        )}
      </div>
    </main>
  );
}
