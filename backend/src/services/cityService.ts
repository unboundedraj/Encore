/**
 * City-scoped lookups that bridge the two databases.
 *
 * A city is a property of a venue, which lives in Postgres. The catalog a user
 * browses lives in Mongo and knows nothing about venues. So "what is on in
 * Mumbai" cannot be answered by either database alone: Postgres decides which
 * content_ids have upcoming shows there, and that set is then applied as a
 * filter to the Mongo query. This module owns the Postgres half.
 *
 * Only upcoming shows count. A city whose every show has already started is
 * not somewhere you can book, and listing it would produce an empty catalog
 * that reads as breakage rather than as "nothing on". "Upcoming" means inside
 * the same horizon the showtimes list uses, so a title is never listed in a
 * city whose showtimes page for it would then come up empty.
 *
 * Both questions are answered by the database (GROUP BY / DISTINCT) over a
 * direct connection rather than by pulling shows through PostgREST and
 * reducing them here. This used to read every upcoming show row, which was fine
 * for a week of fixtures -- but PostgREST silently caps a response at 1000 rows,
 * and with a rolling two-month schedule there are several times that. A capped
 * read does not fail; it quietly drops cities and titles, which is the worst
 * way for this to break.
 */

import type { CitySummary } from "shared";
import { getPool } from "../config/postgres";
import { SHOWTIME_HORIZON_DAYS } from "../config/showtimes";

/** Cities that currently have something on, most shows first. */
export async function listCities(): Promise<CitySummary[]> {
  const { rows } = await getPool().query<{ city: string; show_count: number; venue_count: number }>(
    `select v.city,
            count(*)::int as show_count,
            count(distinct s.venue_id)::int as venue_count
       from encore_shows s
       join encore_venues v on v.id = s.venue_id
      where s.start_time >= now()
        and s.start_time < now() + make_interval(days => $1)
      group by v.city
      order by show_count desc, v.city asc`,
    [SHOWTIME_HORIZON_DAYS]
  );
  return rows;
}

/**
 * content_ids with at least one upcoming show in `city`.
 *
 * Returns an empty array rather than null for an unknown city: "nothing is on
 * in Atlantis" and "nothing is on in Mumbai tonight" are the same answer to
 * the caller, and an empty catalog is the correct rendering of both.
 *
 * The match is case-insensitive so a city arriving from a URL or a stale
 * cookie does not silently miss -- `?city=mumbai` and `?city=Mumbai` are the
 * same request as far as a user is concerned.
 */
export async function contentIdsInCity(city: string): Promise<string[]> {
  const wanted = city.trim().toLowerCase();
  if (!wanted) return [];

  const { rows } = await getPool().query<{ content_id: string }>(
    `select distinct s.content_id
       from encore_shows s
       join encore_venues v on v.id = s.venue_id
      where s.start_time >= now()
        and s.start_time < now() + make_interval(days => $1)
        and lower(v.city) = $2`,
    [SHOWTIME_HORIZON_DAYS, wanted]
  );
  return rows.map((r) => r.content_id);
}
