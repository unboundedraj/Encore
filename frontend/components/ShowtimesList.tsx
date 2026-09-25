import Link from "next/link";
import type { ShowListItem } from "shared";
import { formatCurrency } from "@/lib/utils";

// All seed venues are in Bangalore. Hardcoding the zone is wrong the moment a
// second region exists -- this should become per-venue once one does.
const TIME_ZONE = "Asia/Kolkata";

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateHeadingFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Groups by calendar date in TIME_ZONE. en-CA formats as YYYY-MM-DD, which
 * sorts correctly as a plain string -- convenient for a Map key, though the
 * shows themselves are already chronological from the API, so grouping
 * preserves that order without a separate sort.
 */
function groupByDate(shows: ShowListItem[]): Map<string, ShowListItem[]> {
  const groups = new Map<string, ShowListItem[]>();
  for (const show of shows) {
    const key = dateKeyFormatter.format(new Date(show.start_time));
    const list = groups.get(key);
    if (list) list.push(show);
    else groups.set(key, [show]);
  }
  return groups;
}

export function ShowtimesList({ shows }: { shows: ShowListItem[] }) {
  if (shows.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">No upcoming showtimes.</p>;
  }

  const groups = groupByDate(shows);

  return (
    <div className="flex flex-col gap-6">
      {[...groups.values()].map((dayShows) => (
        <div key={dayShows[0].id}>
          <h3 className="text-sm font-medium text-black/70 dark:text-white/70">
            {dateHeadingFormatter.format(new Date(dayShows[0].start_time))}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {dayShows.map((show) => (
              <Link
                key={show.id}
                href={`/shows/${show.id}`}
                className="flex flex-col items-start rounded-md border border-black/10 px-3 py-2 text-left transition-colors hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
              >
                <span className="text-sm font-medium">{timeFormatter.format(new Date(show.start_time))}</span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {show.venue_name}
                  {show.screen_name ? ` · ${show.screen_name}` : ""}
                </span>
                <span className="mt-1 text-xs font-medium text-black/70 dark:text-white/70">
                  {formatCurrency(show.price)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
