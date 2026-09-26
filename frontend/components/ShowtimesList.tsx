import Link from "next/link";
import type { ShowListItem } from "shared";
import { formatCurrency } from "@/lib/utils";

// Every venue in the catalog is in India, and India has a single zone with no
// DST, so one fixed zone is correct here. This becomes per-venue the moment a
// venue exists outside it.
const TIME_ZONE = "Asia/Kolkata";

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayNameFormatter = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, weekday: "short" });
const dayNumFormatter = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, day: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, month: "short" });
const timeFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

interface ShowtimesListProps {
  shows: ShowListItem[];
  city: string;
  /** Other cities this title is playing in, used only when `shows` is empty. */
  otherCities?: string[];
  /**
   * Which date to show. Omitted means the earliest available -- the list is a
   * server component, so switching dates is a link, not client state.
   */
  selectedDate?: string;
  /** Builds the href for a date chip. Omitted renders the strip as static. */
  dateHref?: (dateKey: string) => string;
}

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

function groupByVenue(shows: ShowListItem[]): Map<string, ShowListItem[]> {
  const groups = new Map<string, ShowListItem[]>();
  for (const show of shows) {
    const list = groups.get(show.venue_name);
    if (list) list.push(show);
    else groups.set(show.venue_name, [show]);
  }
  return groups;
}

/**
 * Date strip plus venue-grouped showtimes.
 *
 * Grouping by venue rather than listing every show flat is what makes a busy
 * title readable: a film on four screens across five days is 80 showtimes, and
 * a flat list of those is unusable. The date strip narrows to one day, and the
 * venue rows then hold a handful of chips each.
 */
export function ShowtimesList({
  shows,
  city,
  otherCities = [],
  selectedDate,
  dateHref,
}: ShowtimesListProps) {
  if (shows.length === 0) {
    return (
      <div className="rounded-lg bg-surface p-8 text-center shadow-sm">
        <p className="font-medium">No showtimes in {city}</p>
        {otherCities.length > 0 ? (
          <p className="mt-2 text-sm text-muted">
            This one is playing in {otherCities.slice(0, 3).join(", ")}
            {otherCities.length > 3 ? ` and ${otherCities.length - 3} more` : ""}. Change your city
            from the header to book it.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Check back soon.</p>
        )}
      </div>
    );
  }

  const byDate = groupByDate(shows);
  const dateKeys = [...byDate.keys()].sort();
  const activeDate = selectedDate && byDate.has(selectedDate) ? selectedDate : dateKeys[0];
  const dayShows = byDate.get(activeDate) ?? [];
  const byVenue = groupByVenue(dayShows);

  return (
    <div>
      {/* Date strip */}
      <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
        {dateKeys.map((key) => {
          const when = new Date(byDate.get(key)![0].start_time);
          const active = key === activeDate;
          const content = (
            <>
              <span className="text-[10px] font-medium uppercase tracking-wider">
                {dayNameFormatter.format(when)}
              </span>
              <span className="text-lg font-bold leading-none">{dayNumFormatter.format(when)}</span>
              <span className="text-[10px] uppercase tracking-wider">
                {monthFormatter.format(when)}
              </span>
            </>
          );
          const className = `flex w-14 shrink-0 flex-col items-center gap-0.5 rounded-lg px-2 py-2.5 transition-colors ${
            active ? "bg-accent text-white" : "bg-surface text-muted hover:bg-white"
          }`;
          return dateHref ? (
            <Link key={key} href={dateHref(key)} className={className} aria-current={active ? "date" : undefined}>
              {content}
            </Link>
          ) : (
            <div key={key} className={className}>
              {content}
            </div>
          );
        })}
      </div>

      {/* Venue rows for the active date */}
      <div className="mt-4 flex flex-col gap-3">
        {[...byVenue.entries()].map(([venueName, venueShows]) => (
          <div key={venueName} className="rounded-lg bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{venueName}</h3>
              <span className="text-xs text-muted">{venueShows[0].venue_city}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {venueShows.map((show) => (
                <Link
                  key={show.id}
                  href={`/shows/${show.id}`}
                  className="group flex min-w-22 flex-col items-center rounded-md border border-ok/40 px-3 py-2 text-center transition-colors hover:border-ok hover:bg-ok/5"
                  title={`${show.screen_name ?? "General admission"} · ${formatCurrency(show.price)}`}
                >
                  <span className="text-sm font-semibold text-ok">
                    {timeFormatter.format(new Date(show.start_time))}
                  </span>
                  <span className="mt-0.5 text-[10px] text-muted">
                    {show.screen_name ?? "General"}
                  </span>
                  <span className="text-[10px] font-medium text-muted">
                    {formatCurrency(show.price)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
