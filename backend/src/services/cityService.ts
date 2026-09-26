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
 * that reads as breakage rather than as "nothing on".
 */

import type { CitySummary } from "shared";
import { supabase } from "../config/supabase";

/** Rows PostgREST returns for the joined show -> venue read below. */
interface ShowCityRow {
  content_id: string;
  venue_id: string;
  encore_venues: { city: string } | null;
}

/**
 * Every upcoming show, reduced to the three fields the city questions need.
 *
 * One query serves both callers here. The alternative -- a distinct-city query
 * and a separate content_ids-by-city query -- would be two round trips to
 * answer two halves of the same question, and PostgREST cannot express
 * SELECT DISTINCT or a GROUP BY without a database view or RPC. At seed and
 * demo scale the row count is trivial; if this ever grew, a view would be the
 * place to put it rather than more round trips.
 */
async function upcomingShowCities(): Promise<ShowCityRow[]> {
  const { data, error } = await supabase
    .from("encore_shows")
    .select("content_id, venue_id, encore_venues(city)")
    .gte("start_time", new Date().toISOString());

  if (error) throw new Error(`Failed to read show cities: ${error.message}`);
  return (data ?? []) as unknown as ShowCityRow[];
}

/** Cities that currently have something on, most shows first. */
export async function listCities(): Promise<CitySummary[]> {
  const rows = await upcomingShowCities();

  const byCity = new Map<string, { shows: number; venues: Set<string> }>();
  for (const row of rows) {
    const city = row.encore_venues?.city;
    if (!city) continue;
    const entry = byCity.get(city) ?? { shows: 0, venues: new Set<string>() };
    entry.shows += 1;
    entry.venues.add(row.venue_id);
    byCity.set(city, entry);
  }

  return [...byCity.entries()]
    .map(([city, { shows, venues }]) => ({
      city,
      show_count: shows,
      venue_count: venues.size,
    }))
    .sort((a, b) => b.show_count - a.show_count || a.city.localeCompare(b.city));
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

  const rows = await upcomingShowCities();
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.encore_venues?.city?.toLowerCase() === wanted) ids.add(row.content_id);
  }
  return [...ids];
}
