import Link from "next/link";
import { notFound } from "next/navigation";
import { QuantityPicker } from "@/components/QuantityPicker";
import { SeatMap } from "@/components/SeatMap";
import { fetchContentById } from "@/lib/content-api";
import { fetchSeatMap, fetchShowDetail } from "@/lib/show-api";

type Params = Promise<{ showId: string }>;

// Matches ShowtimesList -- see the note there about this being a single zone.
const TIME_ZONE = "Asia/Kolkata";
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export async function generateMetadata({ params }: { params: Params }) {
  const { showId } = await params;
  const show = await fetchShowDetail(showId);
  if (!show) return { title: "Not found · Encore" };
  const content = await fetchContentById(show.content_id);
  const title = content?.title ?? "Show";
  return { title: `${title} · ${show.venue.name} · Encore` };
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

  // The title lives in Mongo and the show in Postgres, joined by content_id
  // only at read time. Fetched together with the seat map rather than in
  // series -- neither depends on the other.
  const [content, seats] = await Promise.all([
    fetchContentById(show.content_id),
    show.seating_mode === "assigned" ? fetchSeatMap(showId) : Promise.resolve(null),
  ]);

  return (
    <main className="flex-1">
      {/* Compact dark bar: what you are booking, always visible above the hall. */}
      <div className="bg-ink-2 text-white">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
          <Link
            href={`/content/${show.content_id}`}
            className="text-xs text-white/60 transition-colors hover:text-white"
          >
            &larr; Back to {content?.title ?? "details"}
          </Link>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h1 className="text-lg font-bold tracking-tight sm:text-xl">
              {content?.title ?? "Show"}
            </h1>
            <p className="text-sm text-white/70">
              {dateTimeFormatter.format(new Date(show.start_time))}
            </p>
          </div>
          <p className="mt-0.5 text-xs text-white/60">
            {[
              show.venue.name,
              show.seating_mode === "assigned" ? show.screen.name : null,
              show.venue.city,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {show.seating_mode === "assigned" ? (
          <SeatMap seats={seats ?? []} pricePerSeat={show.price} showId={show.id} />
        ) : (
          <QuantityPicker
            availableCapacity={show.available_capacity}
            pricePerTicket={show.price}
            showId={show.id}
          />
        )}
      </div>
    </main>
  );
}
